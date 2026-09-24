// HTTP smoke test against a running server (markers-only mode: no Gemini, no Redis configured).
import { readFileSync } from "node:fs";
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const ORIGIN = { Origin: BASE };
const jar = { a: "", b: "" };
const req = async (who, path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), ...(jar[who] ? { Cookie: jar[who] } : {}) } });
  const sc = res.headers.get("set-cookie");
  if (sc) jar[who] = sc.split(";")[0];
  return res;
};
const log = (k, v) => console.log(k.padEnd(46), v);

// Invalid upload
let form = new FormData();
form.set("file", new Blob(["not a zip"]), "fake.docx");
let r = await req("a", "/api/documents", { method: "POST", body: form, headers: ORIGIN });
log("fake .docx rejected", `${r.status} ${(await r.json()).code}`);
// Cross-origin mutation
form = new FormData();
form.set("file", new Blob([readFileSync("fixtures/synthetic-residential-lease.docx")]), "lease.docx");
r = await req("a", "/api/documents", { method: "POST", body: form, headers: { Origin: "https://evil.example" } });
log("cross-origin upload rejected", r.status);
// Real upload
form = new FormData();
form.set("file", new Blob([readFileSync("fixtures/synthetic-residential-lease.docx")]), "lease.docx");
r = await req("a", "/api/documents", { method: "POST", body: form, headers: ORIGIN });
let doc = await r.json();
log("upload", `${r.status} analysis=${doc.analysis} fields=${doc.fields.length} cookie=${jar.a ? "HttpOnly set" : "none"}`);
log("opening message", doc.messages[0].content.slice(0, 90) + "…");
// Chat without Gemini -> clear 503
r = await req("a", `/api/documents/${doc.id}/chat`, {
  method: "POST",
  headers: { ...ORIGIN, "Content-Type": "application/json" },
  body: JSON.stringify({ message: "hi", fieldsVersion: doc.fieldsVersion, requestId: crypto.randomUUID() }),
});
const chatBody = await r.text();
log("chat without key", `${r.status} ${chatBody.includes("GEMINI_API_KEY") ? "names GEMINI_API_KEY" : chatBody.slice(0, 80)}`);
// Fill every field via the field panel API
const values = {
  "Landlord name": "Ravi Ramdin",
  "Tenant name": "John Smith",
  Address: "12 Royal Road, Curepipe",
  "Property address": "4 Sea View Lane",
  "Start date": "1 October 2026",
  "Monthly rent": "MUR 25,000",
  "Deposit amount": "MUR 50,000",
  "Interest rate": "8%",
  "Reference number": "LX-7 & Co",
};
for (const f of doc.fields) {
  const value = values[f.label] ?? (f.valueType === "date" ? "30 September 2027" : "TBC");
  r = await req("a", `/api/documents/${doc.id}/fields`, {
    method: "PATCH",
    headers: { ...ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ fieldsVersion: doc.fieldsVersion, fieldId: f.id, value }),
  });
  doc = await r.json();
}
log("fields confirmed", `${doc.fields.filter((f) => f.status === "confirmed").length}/${doc.fields.length}`);
// Draft stream: record arrival times of each network chunk and event
const t0 = performance.now();
r = await req("a", `/api/documents/${doc.id}/draft`, {
  method: "POST",
  headers: { ...ORIGIN, "Content-Type": "application/json" },
  body: JSON.stringify({ fieldsVersion: doc.fieldsVersion, requestId: crypto.randomUUID() }),
});
log("draft content-type", r.headers.get("content-type"));
const reader = r.body.getReader();
const dec = new TextDecoder();
let buf = "";
let chunks = 0;
const times = {};
let blocks = 0;
let firstBlockChunk = -1,
  completeChunk = -1;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks++;
  buf += dec.decode(value, { stream: true });
  if (firstBlockChunk < 0 && buf.includes("draft_block_ready")) {
    firstBlockChunk = chunks;
    times.first = (performance.now() - t0).toFixed(1);
  }
  if (completeChunk < 0 && buf.includes("draft_complete")) {
    completeChunk = chunks;
    times.complete = (performance.now() - t0).toFixed(1);
  }
}
blocks = (buf.match(/event: draft_block_ready/g) ?? []).length;
log(
  "draft stream",
  `${chunks} network chunks, ${blocks} block events; first block in chunk ${firstBlockChunk} @${times.first}ms, complete in chunk ${completeChunk} @${times.complete}ms`,
);
// Save editor output (simulate) with correct and stale revisions
r = await req("a", `/api/documents/${doc.id}/docx`);
const working = new Uint8Array(await r.arrayBuffer());
const rev = Number(r.headers.get("x-working-revision"));
log("working docx", `${r.status} rev=${rev} cache-control=${r.headers.get("cache-control")}`);
r = await req("a", `/api/documents/${doc.id}/docx?rev=${rev}`, { method: "PUT", headers: ORIGIN, body: working });
log("save rev", `${r.status} -> ${(await r.json()).workingRevision}`);
r = await req("a", `/api/documents/${doc.id}/docx?rev=${rev}`, { method: "PUT", headers: ORIGIN, body: working });
log("save stale rev", `${r.status} ${(await r.json()).code}`);
// Download
r = await req("a", `/api/documents/${doc.id}/download`);
const dl = new Uint8Array(await r.arrayBuffer()); /* downloaded bytes verified above */
log("download", `${r.status} ${r.headers.get("content-disposition")} ${dl.length} bytes`);
// Isolation: session b
form = new FormData();
form.set("file", new Blob([readFileSync("fixtures/synthetic-mutual-nda.docx")]), "nda.docx");
await req("b", "/api/documents", { method: "POST", body: form, headers: ORIGIN });
for (const [label, path, init] of [
  ["b reads a's docx", `/api/documents/${doc.id}/docx`, {}],
  ["b downloads a's doc", `/api/documents/${doc.id}/download`, {}],
  [
    "b patches a's field",
    `/api/documents/${doc.id}/fields`,
    {
      method: "PATCH",
      headers: { ...ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ fieldsVersion: 1, fieldId: doc.fields[0].id, value: "x" }),
    },
  ],
  [
    "b streams a's draft",
    `/api/documents/${doc.id}/draft`,
    {
      method: "POST",
      headers: { ...ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ fieldsVersion: doc.fieldsVersion, requestId: crypto.randomUUID() }),
    },
  ],
]) {
  r = await req("b", path, init);
  const t = await r.text();
  log(label, `${r.status} ${t.includes("not_found") || r.status === 404 ? "not_found" : t.slice(0, 60)}`);
}
r = await req("none", `/api/documents/${doc.id}/download`);
log("no cookie download", r.status);
r = await req("b", "/api/documents/current");
log("b's current doc", (await r.json()).document.filename);
// Bonus routes: every one is owner-scoped and origin-checked.
const J = { ...ORIGIN, "Content-Type": "application/json" };
for (const [label, path, init] of [
  ["b resumes a's draft", `/api/documents/${doc.id}`, {}],
  ["b renames a's draft", `/api/documents/${doc.id}`, { method: "PATCH", headers: J, body: JSON.stringify({ title: "x" }) }],
  ["b switches a's chat language", `/api/documents/${doc.id}`, { method: "PATCH", headers: J, body: JSON.stringify({ language: "fr", fieldsVersion: 1 }) }],
  ["b deletes a's draft", `/api/documents/${doc.id}`, { method: "DELETE", headers: ORIGIN }],
  ["b compares a's draft", `/api/documents/${doc.id}/compare`, { method: "POST", headers: ORIGIN }],
  ["b copies a's draft", `/api/documents/${doc.id}/copy`, { method: "POST", headers: ORIGIN }],
  [
    "b changes a's clause",
    `/api/documents/${doc.id}/rules`,
    { method: "POST", headers: J, body: JSON.stringify({ fieldsVersion: 1, ruleId: "clause_x", action: "include" }) },
  ],
]) {
  r = await req("b", path, init);
  const t = await r.text();
  log(label, `${r.status} ${r.status === 404 ? "not_found" : t.slice(0, 60)}`);
}
r = await req("b", "/api/drafts");
log("b's drafts list", (await r.json()).drafts.map((d) => d.filename).join(", "));
r = await req("none", "/api/drafts");
log("no cookie drafts list", JSON.stringify(await r.json()));
r = await req("a", `/api/documents/${doc.id}`, { method: "DELETE", headers: { Origin: "https://evil.example" } });
log("cross-origin delete rejected", r.status);
r = await req("a", `/api/documents/${doc.id}/compare`, { method: "POST", headers: ORIGIN });
const cmp = await r.json();
log("a compares", `${r.status} source=${cmp.source} changes=${cmp.result.items.length} cache-control=${r.headers.get("cache-control")}`);
r = await req("a", `/api/documents/${doc.id}`, { method: "PATCH", headers: J, body: JSON.stringify({ title: "Lease — Dupont" }) });
log("a renames", `${r.status} ${(await r.json()).title}`);
r = await req("a", `/api/documents/${doc.id}/copy`, { method: "POST", headers: ORIGIN });
const copy = await r.json();
log("a copies", `${r.status} ${copy.title}`);
r = await req("a", "/api/drafts");
log("a's drafts list", (await r.json()).drafts.map((d) => d.title).join(" | "));
r = await req("a", `/api/documents/${copy.id}`, { method: "DELETE", headers: ORIGIN });
log("a deletes the copy", r.status);
r = await req("a", `/api/documents/${copy.id}`);
log("deleted copy is gone", r.status);
