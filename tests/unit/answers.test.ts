import { beforeAll, describe, expect, it } from "vitest";
import type { Field } from "@/features/documents/contracts/fields";
import { outstandingFields } from "@/features/documents/progress";
import { applyExtraction, type Extraction } from "@/server/ai/extraction";
import { replyPrompt } from "@/server/ai/reply";
import { detectMarkers } from "@/server/docx/detect";
import { loadDocxPackage } from "@/server/docx/package";
import { indexBlocks } from "@/server/docx/render";
import { buildFields } from "@/server/fields/build-fields";
import { parseMoney, renderAt } from "@/server/fields/normalize";
import { resolveField } from "@/server/fields/resolve";
import { loadManifest, score } from "../manifest-score";

type Update = Extraction["updates"][number];

const up = (
  fieldId: string,
  value: string,
  evidence: string,
  extra: Partial<Update> = {},
): Update => {
  return {
    fieldId,
    value,
    evidence,
    currency: null,
    ...extra,
  };
};

async function fixture(name: string) {
  const { manifest, bytes } = loadManifest(name);
  const blocks = await indexBlocks(await loadDocxPackage(bytes));
  const fields = buildFields(blocks, detectMarkers(blocks), null).fields;
  const s = score(manifest, fields);

  const id = (expected: string) => {
    const f = s.matched.get(expected);

    if (!f) {
      throw new Error(`no field for ${expected}`);
    }

    return f.id;
  };

  return {
    fields,
    id,
  };
}

const apply = (
  fields: Field[],
  message: string,
  updates: Update[],
  lang: "en" | "fr" = "en",
) => {
  return applyExtraction(
    fields,
    {
      updates,
      clauseBlockIds: [],
    },
    message,
    null,
    lang,
  );
};

const byId = (fields: Field[], id: string) => {
  const f = fields.find((x) => x.id === id);

  if (!f) {
    throw new Error(id);
  }

  return f;
};

describe("NDA answers", () => {
  let nda: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => {
    nda = await fixture("01_Mutual_NDA");
  });

  it("fills several fields from one message and keeps company suffixes", () => {
    const msg =
      "Party A is Acme Holdings Ltd., 1 Main Street, Port Louis, and Party B is Beta Conseil SARL.";
    const r = apply(nda.fields, msg, [
      up(nda.id("party_a_name"), "Acme Holdings Ltd.", "Acme Holdings Ltd."),
      up(
        nda.id("party_a_address"),
        "1 Main Street, Port Louis",
        "1 Main Street, Port Louis",
      ),
      up(nda.id("party_b_name"), "Beta Conseil SARL", "Beta Conseil SARL"),
    ]);

    expect(r.changed).toHaveLength(3);

    expect(byId(r.fields, nda.id("party_a_name")).displayValue).toBe(
      "Acme Holdings Ltd.",
    );

    expect(byId(r.fields, nda.id("party_b_name")).displayValue).toBe(
      "Beta Conseil SARL",
    );

    expect(byId(r.fields, nda.id("party_b_name")).evidence).toBe(
      "Beta Conseil SARL",
    );
  });

  it("does not take a contact person as the signatory", () => {
    const msg = "Jane Doe is Party A's contact for notices.";
    const r = apply(nda.fields, msg, [
      up(
        nda.id("party_a_contact"),
        "Jane Doe",
        "Jane Doe is Party A's contact",
      ),
      up(
        nda.id("party_a_signatory_name"),
        "Jane Doe",
        "Jane Doe is Party A's contact",
      ),
    ]);

    expect(byId(r.fields, nda.id("party_a_contact")).status).toBe("confirmed");

    expect(byId(r.fields, nda.id("party_a_signatory_name")).status).toBe(
      "missing",
    );

    expect(r.rejected.join()).toMatch(/signatory not stated/);
  });

  it("never stores a value the user only asked about", () => {
    const msg = "Is a 30 day return period usual for an NDA?";
    const r = apply(nda.fields, msg, [
      up(nda.id("return_period_days"), "30", "30 day return period"),
    ]);

    expect(r.changed).toEqual([]);

    expect(byId(r.fields, nda.id("return_period_days")).status).toBe("missing");
  });

  it("rejects a value that does not appear in the message", () => {
    const r = apply(nda.fields, "Party A is Acme.", [
      up(nda.id("party_a_address"), "10 Downing Street", "Party A is Acme"),
    ]);

    expect(r.changed).toEqual([]);
    expect(r.rejected.join()).toMatch(/not in the message/);
  });

  it("checks email syntax without claiming the address exists", () => {
    const r = apply(nda.fields, "Party A's email is jane(at)acme", [
      up(nda.id("party_a_email"), "jane(at)acme", "jane(at)acme"),
    ]);
    const f = byId(r.fields, nda.id("party_a_email"));

    expect(f.status).toBe("needs_clarification");
    expect(f.issue?.code).toBe("invalid_email");
  });

  it("asks for the unit the template uses instead of converting", () => {
    const r = apply(nda.fields, "Return within 2 weeks", [
      up(nda.id("return_period_days"), "2 weeks", "2 weeks"),
    ]);
    const f = byId(r.fields, nda.id("return_period_days"));

    expect(f.status).toBe("needs_clarification");

    expect(f.issue).toMatchObject({
      code: "unit_mismatch",
      params: { unit: "days" },
    });
  });
});

describe("lease answers", () => {
  let lease: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => {
    lease = await fixture("02_Residential_Lease_Mixed_Placeholders");
  });

  it("accepts 'no additional occupants' as a resolution, distinct from zero", () => {
    const r = apply(
      lease.fields,
      "There are no additional occupants, and the tenant gets 0 keys.",
      [
        up(lease.id("additional_occupants"), "", "no additional occupants", {
          resolution: "none",
        }),
        up(lease.id("key_count"), "0", "0 keys"),
      ],
    );
    const none = byId(r.fields, lease.id("additional_occupants"));
    const zero = byId(r.fields, lease.id("key_count"));

    expect(none).toMatchObject({
      status: "confirmed",
      resolution: "none",
      displayValue: null,
    });

    expect(renderAt(none, "en", "en")).toBe("None");

    expect(zero).toMatchObject({
      status: "confirmed",
      resolution: "value",
      displayValue: "0",
    });
  });

  it("refuses a resolution the message does not state", () => {
    const r = apply(lease.fields, "The tenant is Mary Major.", [
      up(lease.id("additional_occupants"), "", "The tenant is Mary Major", {
        resolution: "none",
      }),
    ]);

    expect(r.changed).toEqual([]);
  });

  it("puts an unknown detail aside until the end, still blocking the draft", () => {
    const r = apply(lease.fields, "I don't know the meter reading yet.", [
      up(lease.id("electricity_meter_reading"), "", "I don't know", {
        resolution: "unknown",
      }),
    ]);
    const f = byId(r.fields, lease.id("electricity_meter_reading"));
    const open = outstandingFields(r.fields);

    expect(f).toMatchObject({
      status: "missing",
      resolution: "unknown",
    });

    expect(open.at(-1)?.id).toBe(f.id);
  });

  it("leaves an optional blank empty on request, but not a required one", () => {
    const optional = lease.fields.map((f) =>
      f.id === lease.id("internet_payer")
        ? {
            ...f,
            required: false,
          }
        : f,
    );
    const r = apply(optional, "Leave the internet line blank.", [
      up(lease.id("internet_payer"), "", "Leave the internet line blank", {
        resolution: "left_blank",
      }),
      up(lease.id("water_payer"), "", "Leave the internet line blank", {
        resolution: "left_blank",
      }),
    ]);

    expect(byId(r.fields, lease.id("internet_payer"))).toMatchObject({
      status: "confirmed",
      resolution: "left_blank",
    });

    expect(
      renderAt(byId(r.fields, lease.id("internet_payer")), "en", "en"),
    ).toBe(null);

    expect(byId(r.fields, lease.id("water_payer")).issue?.code).toBe(
      "required_field",
    );
  });

  it("writes 'Not applicable' when the user says a detail does not apply", () => {
    const r = apply(lease.fields, "The landlord email is not applicable.", [
      up(lease.id("landlord_email"), "", "not applicable", {
        resolution: "not_applicable",
      }),
    ]);

    expect(
      renderAt(byId(r.fields, lease.id("landlord_email")), "en", "en"),
    ).toBe("Not applicable");
  });

  it("copies 'same address' only when it is clear which address", () => {
    const first = apply(lease.fields, "The landlord lives at 5 Rue Royale.", [
      up(lease.id("landlord_address"), "5 Rue Royale", "5 Rue Royale"),
    ]);
    const clear = apply(
      first.fields,
      "The tenant address is the same as the landlord's.",
      [
        up(
          lease.id("tenant_address"),
          "5 Rue Royale",
          "the same as the landlord's",
          { sameAs: lease.id("landlord_address") },
        ),
      ],
    );

    expect(byId(clear.fields, lease.id("tenant_address")).displayValue).toBe(
      "5 Rue Royale",
    );

    const two = apply(first.fields, "The premises are at 9 Avenue Victoria.", [
      up(
        lease.id("property_address"),
        "9 Avenue Victoria",
        "9 Avenue Victoria",
      ),
    ]);
    const vague = apply(two.fields, "Tenant address: same address.", [
      up(lease.id("tenant_address"), "5 Rue Royale", "same address", {
        sameAs: lease.id("landlord_address"),
      }),
    ]);
    const f = byId(vague.fields, lease.id("tenant_address"));

    expect(f.status).toBe("needs_clarification");
    expect(f.issue?.code).toBe("ambiguous_reference");
  });

  it("keeps access notice hours apart from termination notice days", () => {
    const r = apply(
      lease.fields,
      "Visits need 48 hours notice and termination needs 30 calendar days.",
      [
        up(lease.id("access_notice_hours"), "48 hours", "48 hours"),
        up(
          lease.id("termination_notice_days"),
          "30 calendar days",
          "30 calendar days",
        ),
      ],
    );

    expect(byId(r.fields, lease.id("access_notice_hours")).displayValue).toBe(
      "48",
    );

    expect(
      byId(r.fields, lease.id("termination_notice_days")).displayValue,
    ).toBe("30");
  });

  it("flags an end date before the start date", () => {
    const r = apply(
      lease.fields,
      "The lease starts on 1 October 2026 and ends on 1 September 2026.",
      [
        up(lease.id("lease_start_date"), "1 October 2026", "1 October 2026"),
        up(lease.id("lease_end_date"), "1 September 2026", "1 September 2026"),
      ],
    );

    expect(byId(r.fields, lease.id("lease_end_date")).issue?.code).toBe(
      "date_order",
    );
  });

  it("asks which value is right when one message gives two", () => {
    const r = apply(lease.fields, "Rent is EUR 1,200, no wait, EUR 1,300.", [
      up(lease.id("monthly_rent"), "EUR 1,200", "EUR 1,200"),
      up(lease.id("monthly_rent"), "EUR 1,300", "EUR 1,300"),
    ]);

    expect(byId(r.fields, lease.id("monthly_rent")).issue?.code).toBe(
      "conflicting_values",
    );
  });

  it("corrects an earlier answer and keeps unrelated answers", () => {
    const first = apply(
      lease.fields,
      "Rent is EUR 1,200 and the tenant is Mary Major.",
      [
        up(lease.id("monthly_rent"), "EUR 1,200", "EUR 1,200"),
        up(lease.id("tenant_name"), "Mary Major", "Mary Major"),
      ],
    );
    const second = apply(first.fields, "Actually the rent is EUR 1,250.", [
      up(lease.id("monthly_rent"), "EUR 1,250", "EUR 1,250"),
    ]);

    expect(second.changed).toEqual([lease.id("monthly_rent")]);

    expect(
      byId(second.fields, lease.id("monthly_rent")).normalized,
    ).toMatchObject({ amount: "1250" });

    expect(byId(second.fields, lease.id("tenant_name")).displayValue).toBe(
      "Mary Major",
    );
  });

  it("asks about ambiguous dates and currencies instead of guessing", () => {
    const r = apply(lease.fields, "Start 03/04/2026, rent $5,000", [
      up(lease.id("lease_start_date"), "03/04/2026", "03/04/2026"),
      up(lease.id("monthly_rent"), "$5,000", "$5,000"),
    ]);

    expect(byId(r.fields, lease.id("lease_start_date")).issue?.code).toBe(
      "ambiguous_date",
    );

    expect(byId(r.fields, lease.id("monthly_rent")).issue?.code).toBe(
      "ambiguous_currency",
    );

    expect(parseMoney("25 000,50 EUR", null, "fr").normalized).toEqual({
      kind: "money",
      amount: "25000.50",
      currency: "EUR",
    });
  });

  it("describes only accepted values in the reply prompt", () => {
    const r = apply(
      lease.fields,
      "No additional occupants. The tenant's email is not-an-email.",
      [
        up(lease.id("additional_occupants"), "", "No additional occupants", {
          resolution: "none",
        }),
        up(lease.id("tenant_email"), "not-an-email", "not-an-email"),
      ],
    );
    const prompt = replyPrompt(r.fields, r.changed, "", "", [], "en");

    expect(prompt).toMatch(/JUST RECORDED: [^\n]*none \(the user said/);
    expect(prompt).not.toMatch(/JUST RECORDED: [^\n]*not-an-email/);
    expect(prompt).toMatch(/NEEDS CLARIFICATION: [^\n]*not a valid email/);
  });

  it("asks the landlord's details together, parties first", () => {
    const prompt = replyPrompt(lease.fields, [], "", "", [], "en");
    const next = /NEXT TO ASK: ([^\n]*)/.exec(prompt)?.[1] ?? "";

    expect(next).toMatch(/Landlord name/);
    expect(next).toMatch(/Landlord address/);
    expect(next).not.toMatch(/email|signatory/i);
  });
});

describe("bilingual answers", () => {
  let services: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => {
    services = await fixture("03_Bilingual_Services_Agreement");
  });

  it("asks the services once and writes each language in its own paragraph", () => {
    const id = services.id("services_description");
    const r = apply(
      services.fields,
      "The services are a website redesign and hosting for 12 months.",
      [
        up(
          id,
          "a website redesign and hosting for 12 months",
          "a website redesign and hosting for 12 months",
          {
            translation: {
              lang: "fr",
              value:
                "une refonte du site web et un hébergement pendant 12 mois",
            },
          },
        ),
      ],
    );
    const f = byId(r.fields, id);
    const [en, fr] = f.occurrences;

    expect(f.status).toBe("confirmed");

    expect(en && renderAt(f, en.lang, "mixed")).toBe(
      "a website redesign and hosting for 12 months",
    );

    expect(fr && renderAt(f, fr.lang, "mixed")).toBe(
      "une refonte du site web et un hébergement pendant 12 mois",
    );
  });

  it("refuses a translation that changes a number, and asks for the French wording", () => {
    const id = services.id("services_description");
    const r = apply(services.fields, "Hosting for 12 months.", [
      up(id, "Hosting for 12 months", "Hosting for 12 months", {
        translation: {
          lang: "fr",
          value: "Hébergement pendant 6 mois",
        },
      }),
    ]);
    const f = byId(r.fields, id);

    expect(f.status).toBe("needs_clarification");

    expect(f.issue).toMatchObject({
      code: "translation_needed",
      params: { missing: "fr" },
    });

    const fixed = resolveField(
      f,
      {
        resolution: "value",
        value: "Hébergement pendant 12 mois",
        onlyLang: "fr",
      },
      {
        currencyHint: null,
        lang: "fr",
      },
    );

    expect(fixed.status).toBe("confirmed");
    expect(fixed.displayValue).toBe("Hosting for 12 months");
  });

  it("does not translate identifiers written in both languages", () => {
    const id = services.id("project_reference");
    const r = apply(services.fields, "The reference is PRJ-2026-014.", [
      up(id, "PRJ-2026-014", "PRJ-2026-014"),
    ]);

    expect(byId(r.fields, id)).toMatchObject({
      status: "confirmed",
      variants: [],
    });
  });
});
