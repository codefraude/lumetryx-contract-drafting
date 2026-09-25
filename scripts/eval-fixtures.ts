import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Field } from "@/features/documents/contracts/fields";
import { analyzeTemplate } from "@/server/ai/analyze";
import { applyExtraction, extract } from "@/server/ai/extraction";
import { classifyAiError, currentModel, modelId } from "@/server/ai/model";
import { replyPrompt, streamReply } from "@/server/ai/reply";
import { setStoreForTests } from "@/server/cache/redis";
import { detectMarkers } from "@/server/docx/detect";
import { loadDocxPackage, sha256Hex } from "@/server/docx/package";
import { indexBlocks } from "@/server/docx/render";
import { env } from "@/server/env";
import { buildFields } from "@/server/fields/build-fields";
import { messageLanguage } from "@/server/fields/lang";
import {
  loadManifest,
  MANIFESTS,
  score,
  type Score,
} from "../tests/manifest-score";

type Expect = (get: (id: string) => Field) => string | null;

interface Turn {
  say: string;
  expect: Expect[];
}

const value = (id: string, re: RegExp): Expect => {
  return (get) => {
    const f = get(id);

    return f.status === "confirmed" && re.test(f.displayValue ?? "")
      ? null
      : `${id}: expected ${re} confirmed, got ${f.status} "${f.displayValue ?? ""}"`;
  };
};

const status = (id: string, s: Field["status"]): Expect => {
  return (get) => {
    return get(id).status === s
      ? null
      : `${id}: expected ${s}, got ${get(id).status}`;
  };
};

const resolution = (id: string, r: Field["resolution"]): Expect => {
  return (get) => {
    return get(id).resolution === r
      ? null
      : `${id}: expected resolution ${r}, got ${get(id).resolution}`;
  };
};

const frenchWording = (id: string): Expect => {
  return (get) => {
    const fr = get(id).variants.find((v) => v.lang === "fr");

    return fr && messageLanguage(fr.value) !== "en"
      ? null
      : `${id}: expected a French wording, got ${JSON.stringify(get(id).variants)}`;
  };
};

const TURNS: Record<(typeof MANIFESTS)[number], Turn[]> = {
  "01_Mutual_NDA": [
    {
      say: "Party A is Acme Holdings Ltd. at 1 Main Street, Port Louis; Party B is Beta Conseil SARL.",
      expect: [
        value("party_a_name", /^Acme Holdings Ltd\.$/),
        value("party_a_address", /1 Main Street/),
        value("party_b_name", /^Beta Conseil SARL$/),
      ],
    },
    {
      say: "Jane Doe is Party A's contact for notices, and her email is jane@acme.example.",
      expect: [
        value("party_a_contact", /Jane Doe/),
        status("party_a_signatory_name", "missing"),
        value("party_a_email", /^jane@acme\.example$/),
      ],
    },
    {
      say: "Is a 30 day return period usual for this kind of agreement?",
      expect: [status("return_period_days", "missing")],
    },
    {
      say: "The agreement takes effect on 03/04/2026.",
      expect: [status("effective_date", "needs_clarification")],
    },
    {
      say: "Actually, Party B is Beta Conseil SAS, not SARL.",
      expect: [value("party_b_name", /^Beta Conseil SAS$/)],
    },
  ],
  "02_Residential_Lease_Mixed_Placeholders": [
    {
      say: "The landlord is Paul Martin of 12 Royal Road, Curepipe. The tenant, Mary Major, currently lives at 8 Sea View Lane, Flic en Flac. The flat is at 3 Palm Court, Quatre Bornes.",
      expect: [
        value("tenant_address", /8 Sea View Lane/),
        value("landlord_address", /12 Royal Road/),
        value("property_address", /3 Palm Court/),
      ],
    },
    {
      say: "There will be no additional occupants, two people in total.",
      expect: [
        resolution("additional_occupants", "none"),
        value("occupant_count", /^2$/),
      ],
    },
    {
      say: "The rent is $1,500 a month.",
      expect: [status("monthly_rent", "needs_clarification")],
    },
    {
      say: "I don't know the electricity meter reading yet.",
      expect: [resolution("electricity_meter_reading", "unknown")],
    },
    {
      say: "Routine visits need 24 hours notice and ending the tenancy needs 60 calendar days.",
      expect: [
        value("access_notice_hours", /^24$/),
        value("termination_notice_days", /^60$/),
      ],
    },
  ],
  "03_Bilingual_Services_Agreement": [
    {
      say: "The services are a full website redesign and twelve months of hosting.",
      expect: [
        status("services_description", "confirmed"),
        frenchWording("services_description"),
      ],
    },
    {
      say: "The total fee is 25 000,50 EUR and invoices are paid within 30 days.",
      expect: [
        value("total_fee", /25,000\.50/),
        value("payment_deadline_days", /^30$/),
      ],
    },
    {
      say: "Le client est Blue Ocean Ltd et le prestataire est Studio Lumière SARL.",
      expect: [
        value("client_name", /^Blue Ocean Ltd$/),
        value("provider_name", /^Studio Lumière SARL$/),
      ],
    },
    {
      say: "What does the clause about working materials mean?",
      expect: [status("working_materials", "missing")],
    },
  ],
};

const arg = (name: string) => {
  const i = process.argv.indexOf(name);

  return i >= 0 ? process.argv[i + 1] : undefined;
};

const runs = Math.max(1, Math.min(3, Number(arg("--runs") ?? 1)));
const usage = {
  inputTokens: 0,
  outputTokens: 0,
  calls: 0,
};

const add = (
  u:
    | {
        inputTokens?: number | undefined;
        outputTokens?: number | undefined;
      }
    | undefined,
) => {
  usage.calls += 1;
  usage.inputTokens += u?.inputTokens ?? 0;
  usage.outputTokens += u?.outputTokens ?? 0;
};

const counts = (s: Score) => {
  return Object.fromEntries(
    Object.entries(s)
      .filter(([k]) => k !== "matched")
      .map(([k, v]) => [k, Array.isArray(v) ? v : []]),
  );
};

async function evaluate(name: (typeof MANIFESTS)[number], run: number) {
  const { manifest, bytes } = loadManifest(name);
  const blocks = await indexBlocks(await loadDocxPackage(bytes));
  const markers = detectMarkers(blocks);
  const model = currentModel();
  const analysed = await analyzeTemplate({
    model,
    modelName: modelId(),
    sessionId: randomUUID(),
    templateHash: await sha256Hex(bytes),
    blocks,
    markers,
  });

  add(analysed.usage);

  let fields = buildFields(blocks, markers, analysed.analysis).fields;
  const detection = score(manifest, fields);

  const idOf = (x: string) => {
    return detection.matched.get(x)?.id ?? x;
  };

  const turns: {
    say: string;
    failures: string[];
    rejected: string[];
    providerError: string | null;
  }[] = [];
  const history: {
    role: "user" | "assistant";
    content: string;
  }[] = [];

  for (const turn of TURNS[name]) {
    const failures: string[] = [];
    let rejected: string[] = [];
    let providerError: string | null = null;

    try {
      const { extraction, usage: u } = await extract({
        model,
        fields,
        blocks,
        history,
        userMessage: turn.say,
      });

      add(u);

      const applied = applyExtraction(
        fields,
        extraction,
        turn.say,
        null,
        messageLanguage(turn.say),
      );

      fields = applied.fields;
      rejected = applied.rejected;

      const get = (x: string) => {
        const f = fields.find((g) => g.id === idOf(x));

        if (!f) {
          throw new Error(`no field ${x}`);
        }

        return f;
      };

      for (const e of turn.expect) {
        const problem = e(get);

        if (problem) {
          failures.push(problem);
        }
      }
    } catch (err) {
      providerError = classifyAiError(err).message;
    }

    history.push({
      role: "user",
      content: turn.say,
    });

    turns.push({
      say: turn.say,
      failures,
      rejected,
      providerError,
    });
  }

  const last = TURNS[name].at(-1)?.say ?? "";
  const lang = messageLanguage(last) === "fr" ? "fr" : "en";
  let deltas = 0;
  let text = "";
  let replyError: string | null = null;

  try {
    const reply = streamReply(
      model,
      replyPrompt(fields, [], "", last, history, lang),
    );

    for await (const d of reply.stream.textStream) {
      deltas += 1;
      text += d;
    }

    add(await reply.stream.usage);
  } catch (err) {
    replyError = classifyAiError(err).message;
  }

  return {
    fixture: name,
    run,
    detection: counts(detection),
    turns,
    reply: {
      deltas,
      characters: text.length,
      language: messageLanguage(text),
      expectedLanguage: lang,
      error: replyError,
    },
  };
}

async function main() {
  setStoreForTests(null);

  const results = [];

  for (let run = 1; run <= runs; run++) {
    for (const name of MANIFESTS) {
      const r = await evaluate(name, run);
      const detectionErrors = Object.values(r.detection).reduce(
        (n, v) => n + v.length,
        0,
      );
      const turnFailures = r.turns.flatMap((t) => t.failures);
      const outages = r.turns.filter((t) => t.providerError).length;

      console.log(
        `run ${run} ${name}: detection issues ${detectionErrors}, turn failures ${turnFailures.length}, provider outages ${outages}, reply deltas ${r.reply.deltas} (${r.reply.language}/${r.reply.expectedLanguage})${r.reply.error ? ` reply error: ${r.reply.error}` : ""}`,
      );

      for (const [k, v] of Object.entries(r.detection)) {
        if (v.length) {
          console.log(`  ${k}: ${v.join("; ")}`);
        }
      }

      for (const f of turnFailures) {
        console.log(`  turn: ${f}`);
      }

      results.push(r);
    }
  }

  const report = {
    date: new Date().toISOString(),
    model: modelId(),
    provider: env().AI_PROVIDER,
    thinkingLevel: env().GEMINI_THINKING_LEVEL,
    runs,
    usage,
    results,
  };

  mkdirSync("tests/output/live-eval", { recursive: true });
  const file = `tests/output/live-eval/fixtures-${report.date.slice(0, 19).replace(/[:T]/g, "-")}.json`;

  writeFileSync(file, JSON.stringify(report, null, 1));

  console.log(
    `model ${report.model}, ${runs} run(s), ${usage.calls} calls, ${usage.inputTokens} input / ${usage.outputTokens} output tokens`,
  );

  console.log(`report: ${file}`);
}

await main();
