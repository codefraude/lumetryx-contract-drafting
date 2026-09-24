/**
 * SYNTHETIC fixtures. These are NOT the employer's sample templates; they
 * exist so the full flow can be tested before those templates arrive.
 * `npm run fixtures -- <name> …` rewrites only those fixtures.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Packer } from "docx";
import { lettreControles } from "./fixtures/content-controls";
import { lease, nda } from "./fixtures/english";
import { bilingualEmployment, bilingualLease, contratPrestation } from "./fixtures/french";
import { supplyAgreement } from "./fixtures/rich";

mkdirSync("fixtures", { recursive: true });
mkdirSync("public/examples", { recursive: true });
const only = new Set(process.argv.slice(2));
for (const [name, make, publish] of [
  ["synthetic-mutual-nda", () => Packer.toBuffer(nda()), true],
  ["synthetic-residential-lease", () => Packer.toBuffer(lease()), true],
  ["synthetic-contrat-prestation-fr", () => Packer.toBuffer(contratPrestation()), true],
  ["synthetic-bilingual-lease", () => Packer.toBuffer(bilingualLease()), true],
  ["synthetic-bilingual-employment", () => Packer.toBuffer(bilingualEmployment()), true],
  ["synthetic-lettre-controles-fr", lettreControles, false],
  ["synthetic-supply-agreement", () => Packer.toBuffer(supplyAgreement()), false],
] as const) {
  if (only.size && !only.has(name)) continue;
  const buf = await make();
  writeFileSync(`fixtures/${name}.docx`, buf);
  if (publish) writeFileSync(`public/examples/${name}.docx`, buf);
  console.log(`wrote fixtures/${name}.docx (${buf.length} bytes)`);
}
