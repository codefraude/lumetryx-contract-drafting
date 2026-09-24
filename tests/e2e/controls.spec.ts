import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";

/**
 * A letter whose blanks are Word content controls (placeholder boxes, as in Word's own letter
 * templates), in markers-only mode: every answer takes the place of its placeholder in the editor
 * and in the downloaded file, also after the editor has re-exported the document.
 */
const ORIGIN = { Origin: process.env.APP_URL ?? "http://localhost:3000" };
type Doc = { id: string; fieldsVersion: number; fields: { id: string; label: string }[] };
const VALUES: Record<string, string> = {
  "Votre nom": "Camille Martin",
  "Adresse postale": "12 rue des Lilas",
  "Ville, rue et code postal": "Port-Louis 11302",
  Date: "24 septembre 2026",
  "Nom du destinataire": "Jeanne Dupont",
  Titre: "Responsable des sinistres",
  "Compagnie d’assurance": "Assurances & Fils",
  "Adresse postale (2)": "1 place de la Bourse",
  "Ville, rue et code postal (2)": "Curepipe 74213",
  "Pourcentage d’augmentation": "8",
  "Numéro de police": "POL-778",
  Cordialement: "Bien à vous",
};

/** Waits until SuperDoc has painted every pending change, so measured positions are current. */
async function settle(page: Page) {
  await page.waitForFunction(() => {
    const s = document.querySelector(".v2-super-editor__stage");
    if (!s) return false;
    const a = (n: string) => s.getAttribute(`data-v2-render-scheduler-${n}`);
    return a("painted-sequence") === a("target-sequence") && a("action-painted-sequence") === a("action-target-sequence") && a("pending-action-count") === "0";
  });
  await page.waitForTimeout(150);
}

test("placeholder boxes are replaced by the answers, before and after the editor saves", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.setInputFiles("input[type=file]", "fixtures/synthetic-lettre-controles-fr.docx");
  await expect(page.getByText(/still needed/)).toBeVisible({ timeout: 20_000 });
  let doc = (await (await page.request.get("/api/documents/current")).json()).document as Doc;
  expect(doc.fields.map((f) => f.label).sort(), "one field per blank, two same-worded blanks named apart").toEqual(Object.keys(VALUES).sort());
  for (const f of doc.fields)
    doc = await (
      await page.request.patch(`/api/documents/${doc.id}/fields`, {
        headers: ORIGIN,
        data: { fieldsVersion: doc.fieldsVersion, fieldId: f.id, value: VALUES[f.label]! },
      })
    ).json();
  await page.reload();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });

  const stage = page.locator(".v2-super-editor__stage");
  await expect(stage.getByText("Cher/Chère Jeanne Dupont :")).toBeVisible();
  for (const placeholder of ["Votre nom", "Adresse postale", "Nom du destinataire", "Titre"])
    await expect(stage.getByText(placeholder, { exact: true }), placeholder).toHaveCount(0);

  // An edit makes the editor re-export the document; download right away (the save is flushed first).
  await settle(page);
  const closing = stage.getByText("Bien à vous", { exact: true }).first();
  await closing.scrollIntoViewIfNeeded();
  const box = (await closing.boundingBox())!;
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.keyboard.press("End");
  await page.keyboard.type(" et à bientôt");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .docx" }).click()]);
  await download.saveAs("tests/output/e2e-controls.docx");
  const zip = await JSZip.loadAsync(readFileSync("tests/output/e2e-controls.docx"));
  const xml = await zip.file("word/document.xml")!.async("string");
  const header = await zip.file(Object.keys(zip.files).find((n) => /^word\/header\d*\.xml$/.test(n))!)!.async("string");
  const texts = (part: string) =>
    [...part.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => [...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""));
  const body = texts(xml);

  expect(body, "the edit was saved").toContain("Bien à vous et à bientôt");
  for (const line of [
    "Camille Martin",
    "12 rue des Lilas",
    "Port-Louis 11302",
    "24 septembre 2026",
    "Jeanne Dupont",
    "Responsable des sinistres",
    "1 place de la Bourse",
    "Cher/Chère Jeanne Dupont :",
    "Numéro de police : POL-778",
  ])
    expect(body, line).toContain(line);
  expect(body.find((t) => t.includes("longue date de"))).toContain("longue date de Assurances &amp; Fils, je conteste cette augmentation de 8 pourcent !");
  expect(texts(header)).toEqual(expect.arrayContaining(["Jeanne Dupont", "24 septembre 2026"]));
  // Values sit where the placeholders were: no placeholder wording is left next to them.
  for (const placeholder of ["Votre nom", "Adresse postale", "Ville, rue et code postal", "Nom du destinataire", "Compagnie d’assurance", "Cliquez ou appuyez"])
    expect(body.join("\n"), placeholder).not.toContain(placeholder);
  // Word must not show a filled box as a placeholder, or refill it from the (empty) bound property.
  for (const value of ["Camille Martin", "Jeanne Dupont", "POL-778"]) {
    const at = xml.indexOf(value);
    const sdt = xml.lastIndexOf("<w:sdt>", at) > xml.lastIndexOf("</w:sdt>", at) ? xml.slice(xml.lastIndexOf("<w:sdt>", at), xml.indexOf("</w:sdt>", at)) : "";
    expect(sdt, value).not.toMatch(/showingPlcHdr|dataBinding/);
  }
  expect(errors).toEqual([]);
});
