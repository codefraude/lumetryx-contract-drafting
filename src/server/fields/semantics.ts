import type {
  Field,
  FieldGroup,
  Unit,
  ValueType,
} from "@/features/documents/contracts/fields";
import type { Block } from "@/server/docx/blocks";
import type { MarkerOccurrence } from "@/server/docx/detect";
import { stripAccents } from "./lang";

const ROLE_WORDS: [RegExp, string][] = [
  [/\bpart(y|ie) a\b/, "party_a"],
  [/\bpart(y|ie) b\b/, "party_b"],
  [/\b(landlord|lessor|bailleur)\b/, "landlord"],
  [/\b(tenant|lessee|locataire|preneur)\b/, "tenant"],
  [/\b(provider|prestataire|supplier|fournisseur|contractor)\b/, "provider"],
  [/\b(client|customer)\b/, "client"],
  [/\b(employer|employeur)\b/, "employer"],
  [/\b(employee|salariee?)\b/, "employee"],
  [/\b(buyer|purchaser|acheteur|acquereur)\b/, "buyer"],
  [/\b(seller|vendor|vendeur)\b/, "seller"],
  [/\b(discloser|disclosing party)\b/, "discloser"],
  [/\b(recipient|receiving party)\b/, "recipient"],
];

const UNIT_WORDS: [RegExp, Unit][] = [
  [/^((business|working) days?|jours? (ouvres|ouvrables))\b/, "business_days"],
  [/^((calendar )?days?|jours?( calendaires)?)\b/, "days"],
  [/^(hours?|heures?)\b/, "hours"],
  [/^(weeks?|semaines?)\b/, "weeks"],
  [/^(months?|mois)\b/, "months"],
  [/^(years?|ans|annees?)\b/, "years"],
  [/^(persons?|people|occupants?|personnes?)\b/, "persons"],
];

const LABEL_UNITS: [RegExp, Unit][] = [
  [/\b(in|en) (business|working) days\b|\bjours ouvres\b/, "business_days"],
  [/\b(in|en) (days|jours)\b|\bdays$/, "days"],
  [/\b(in|en) (hours|heures)\b|\bhours$/, "hours"],
  [/\b(in|en) (weeks|semaines)\b|\bweeks$/, "weeks"],
  [/\b(in|en) (months|mois)\b|\bmonths$/, "months"],
  [/\b(in|en) (years|annees|ans)\b|\byears$/, "years"],
];

export const plain = (s: string) => {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[_/()[\]{}:,.“”"«»]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export function ownerOf(...texts: (string | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) {
      continue;
    }

    const t = plain(text);
    const hit = ROLE_WORDS.find(([re]) => re.test(t));

    if (hit) {
      return hit[1];
    }
  }

  return null;
}

export function roleOf(label: string): Field["role"] {
  const l = plain(label);

  if (
    /signator|signataire|signed by|authori[sz]ed (person|representative)/.test(
      l,
    )
  ) {
    return "signatory";
  }

  return /\bcontact\b/.test(l) ? "contact" : null;
}

export function unitOf(label: string, after = ""): Unit | null {
  const next = plain(after);
  const fromText = UNIT_WORDS.find(([re]) => re.test(next));

  if (fromText) {
    return fromText[1];
  }

  const l = plain(label);

  if (/\bday (of|each) (the )?month\b|\bjour du mois\b/.test(l)) {
    return null;
  }

  return LABEL_UNITS.find(([re]) => re.test(l))?.[1] ?? null;
}

const TIME_UNITS = new Set<Unit>([
  "days",
  "business_days",
  "hours",
  "weeks",
  "months",
  "years",
]);

export function inferType(label: string, unit: Unit | null): ValueType {
  const l = plain(label);

  const has = (words: string) => {
    return new RegExp(`\\b(${words})`).test(l);
  };

  if (unit) {
    return TIME_UNITS.has(unit) ? "duration" : "number";
  }

  if (has("e ?mail|courriel")) {
    return "email";
  }

  if (has("currency\\b|devise\\b")) {
    return "currency";
  }

  if (has("title\\b|titre\\b|position\\b|fonction\\b|job\\b|qualite\\b")) {
    return "text";
  }

  if (has("count\\b|quantity|quantite|number of|nombre de|how many")) {
    return "number";
  }

  if (has("day (of|each) (the )?month|jour du mois|due day")) {
    return "number";
  }

  if (
    has(
      "reference\\b|ref\\b|numero\\b|number\\b|code\\b|identifier|identifiant|method\\b|methode\\b|mode de",
    )
  ) {
    return "text";
  }

  if (
    has(
      "date\\b|commence|start\\b|end\\b|expir|effective|debut\\b|fin\\b|echeance|entree\\b|completion",
    )
  ) {
    return "date";
  }

  if (has("contact\\b|signator|signataire")) {
    return "party";
  }

  if (has("payer\\b|paid by|responsible|a la charge|paye par")) {
    return "party";
  }

  if (
    has(
      "rent\\b|amount|price|fees?\\b|deposit|sum\\b|salary|advance|indemnit|loyer|montant|prix|depot|garantie|salaire|honoraires|remuneration|acompte|solde",
    ) ||
    /\bpayment\b(?! (method|terms|deadline|day))/.test(l)
  ) {
    return "money";
  }

  if (has("rate\\b|percent|interest|taux|pourcentage|interet")) {
    return "percentage";
  }

  if (has("address|adresse|premises|situated|locaux|situe")) {
    return "address";
  }

  if (
    has(
      "project|projet|purpose|objet|scope|services?\\b|prestations?\\b|description|deliverable|livrable|materials?\\b|evaluate",
    )
  ) {
    return "text";
  }

  if (/\b(name|nom|legal name|raison sociale)\b/.test(l)) {
    return "party";
  }

  if (ownerOf(label) || has("party\\b|partie\\b|company|societe")) {
    return "party";
  }

  if (has("law\\b|jurisdiction|court|droit\\b|juridiction|tribunal")) {
    return "jurisdiction";
  }

  if (
    has(
      "years|months|period|term\\b|duration|duree|mois|annees|periode|preavis|notice",
    )
  ) {
    return "duration";
  }

  return "text";
}

export function groupOf(
  type: ValueType,
  label: string,
  owner: string | null,
  role: Field["role"],
): FieldGroup {
  const l = plain(label);

  if (role || type === "email") {
    return "contacts";
  }

  if (type === "money" || type === "currency" || type === "percentage") {
    return "money";
  }

  if (/\b(payment|paiement|rent|loyer|invoice|facture)\b/.test(l)) {
    return "money";
  }

  if (type === "date") {
    return "dates";
  }

  if (type === "party") {
    return /payer|paid by|responsible|charge/.test(l) ? "other" : "parties";
  }

  if (type === "address") {
    return owner ? "parties" : "subject";
  }

  if (
    type === "text" &&
    /\b(project|projet|purpose|objet|scope|services?|prestations?|description|deliverable|livrable|premises|property|evaluate)\b/.test(
      l,
    )
  ) {
    return "subject";
  }

  return "other";
}

export interface Semantics {
  valueType: ValueType;
  group: FieldGroup;
  owner: string | null;
  role: Field["role"];
  unit: Unit | null;
}

const blockText = (blocks: ReadonlyMap<string, Block>, m: MarkerOccurrence) => {
  return blocks.get(m.blockId)?.text ?? "";
};

export function markerSemantics(
  m: MarkerOccurrence,
  blocks: ReadonlyMap<string, Block>,
): Semantics {
  const text = blockText(blocks, m);
  const unit = unitOf(m.labelHint, text.slice(m.end, m.end + 40));
  const valueType = inferType(m.labelHint, unit);
  const owner = ownerOf(m.role, m.labelHint);
  const role = roleOf(m.labelHint);

  return {
    valueType,
    group: groupOf(valueType, m.labelHint, owner, role),
    owner,
    role,
    unit,
  };
}

export function enrichAnalysed(
  f: Field,
  markers: MarkerOccurrence[],
  blocks: ReadonlyMap<string, Block>,
): Field {
  const [first] = f.occurrences;
  const marker = markers.find(
    (m) => first && m.blockId === first.blockId && m.start === first.start,
  );
  const text = first ? (blocks.get(first.blockId)?.text ?? "") : "";
  const unit =
    f.unit ??
    (first ? unitOf(f.label, text.slice(first.end, first.end + 40)) : null) ??
    unitOf(f.id.replace(/_/g, " "));
  const role = f.role ?? roleOf(f.label) ?? roleOf(f.id.replace(/_/g, " "));
  const owner =
    f.owner ?? ownerOf(marker?.role, f.label, f.id.replace(/_/g, " "));
  const roleLabel =
    marker?.role && !plain(f.label).includes(plain(marker.role))
      ? marker.labelHint
      : f.label;
  let valueType = f.valueType;

  if (
    unit &&
    (valueType === "text" || valueType === "number" || valueType === "duration")
  ) {
    valueType = unit === "persons" ? "number" : "duration";
  } else if (valueType === "text") {
    const guess = inferType(`${f.label} ${f.id.replace(/_/g, " ")}`, null);

    if (guess === "email" || guess === "currency") {
      valueType = guess;
    }
  }

  return {
    ...f,
    label: roleLabel,
    valueType,
    unit,
    role,
    owner,
    group: role || valueType === "email" ? "contacts" : f.group,
  };
}

const PAIRABLE = new Set(["line", "underscore", "implicit"]);

export function pairTranslations(fields: Field[], blocks: Block[]): Field[] {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const merged = new Set<string>();
  const out: Field[] = [];

  const solo = (f: Field) => {
    const [o] = f.occurrences;

    return f.source !== "condition" &&
      f.occurrences.length === 1 &&
      o &&
      PAIRABLE.has(o.marker) &&
      (o.lang === "en" || o.lang === "fr")
      ? o
      : null;
  };

  const markersIn = (blockId: string) => {
    return fields.filter((f) =>
      f.occurrences.some((o) => o.blockId === blockId),
    ).length;
  };

  for (const f of fields) {
    if (merged.has(f.id)) {
      continue;
    }

    const o = solo(f);
    const b = o ? byId.get(o.blockId) : undefined;
    const at = o ? index.get(o.blockId) : undefined;
    const partner =
      o && b && at !== undefined && !b.table
        ? fields.find((g) => {
            const p = solo(g);
            const pb = p ? byId.get(p.blockId) : undefined;

            return (
              g !== f &&
              !merged.has(g.id) &&
              p !== null &&
              pb !== undefined &&
              !pb.table &&
              p.lang !== o.lang &&
              index.get(p.blockId) === at + 1 &&
              p.marker === o.marker &&
              markersIn(o.blockId) === 1 &&
              markersIn(p.blockId) === 1 &&
              parallel(b.text, o.start, pb.text, p.start)
            );
          })
        : undefined;

    if (!partner) {
      out.push(f);
      continue;
    }

    merged.add(partner.id);

    out.push({
      ...f,
      occurrences: [...f.occurrences, ...partner.occurrences],
      note: null,
      issue: null,
    });
  }

  return out;
}

function parallel(a: string, at: number, b: string, bt: number): boolean {
  const ratio = a.length / Math.max(1, b.length);
  const pa = at / Math.max(1, a.length);
  const pb = bt / Math.max(1, b.length);

  return ratio > 0.5 && ratio < 2 && Math.abs(pa - pb) < 0.25;
}
