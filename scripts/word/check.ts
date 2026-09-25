import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { editChecks, fillChecks, roundTripCheck, type Check } from "./compare";
import { Answers, Inspection } from "./views";

const option = (name: string) => {
  return process.argv[process.argv.indexOf(name) + 1];
};

const OUT = process.argv.includes("--dir")
  ? (option("--dir") ?? "")
  : "tests/output/word";
const EDITED = "tests/output/e2e-download.docx";
const wsl = process.platform !== "win32";

const output = (cmd: string, args: string[]) => {
  return spawnSync(cmd, args, { encoding: "utf8" }).stdout.trim();
};

const toWindows = (path: string) => {
  return wsl ? output("wslpath", ["-w", path]) : path;
};

const fixtures = existsSync(OUT)
  ? readdirSync(OUT)
      .filter((f) => f.endsWith(".filled.docx"))
      .map((f) => f.replace(/\.filled\.docx$/, ""))
      .sort()
  : [];

if (!fixtures.length) {
  console.error(
    "Nothing to check yet: run `npm run test:e2e -- word-exports` against a markers-only server first.",
  );

  process.exit(2);
}

const temp = output("powershell.exe", [
  "-NoProfile",
  "-Command",
  "[IO.Path]::GetTempPath()",
]);
const dir = join(
  wsl ? output("wslpath", ["-u", temp]) : temp,
  "lumetryx-word-check",
  String(Date.now()),
);

mkdirSync(dir, { recursive: true });
const files: string[] = [];
const probes: Record<string, string[]> = {};

const add = (source: string, name: string, texts: string[] = []) => {
  copyFileSync(source, join(dir, name));
  files.push(join(dir, name));
  probes[name] = texts;
};

const answers = new Map(
  fixtures.map((f) => [
    f,
    Answers.parse(JSON.parse(readFileSync(join(OUT, `${f}.json`), "utf8"))),
  ]),
);

for (const f of fixtures) {
  const free = (answers.get(f)?.fields ?? []).filter((x) =>
    x.answer.startsWith("Sample "),
  );

  add(
    `fixtures/${f}.docx`,
    `${f}.docx`,
    free.flatMap((x) => x.placeholders.slice(0, 1)),
  );

  add(
    join(OUT, `${f}.filled.docx`),
    `${f}.filled.docx`,
    free.map((x) => x.answer),
  );

  add(join(OUT, `${f}.roundtrip.docx`), `${f}.roundtrip.docx`);
}

if (existsSync(EDITED)) {
  add(EDITED, "lease-edited.docx", ["Strictly"]);
}

writeFileSync(join(dir, "list.txt"), files.map(toWindows).join("\n"));
writeFileSync(join(dir, "probes.json"), JSON.stringify(probes));
copyFileSync("scripts/word/inspect.ps1", join(dir, "inspect.ps1"));

const at = (name: string) => {
  return toWindows(join(dir, name));
};

const args = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  at("inspect.ps1"),
  "-ListFile",
  at("list.txt"),
  "-OutFile",
  at("views.json"),
  "-PidFile",
  at("pid.txt"),
  "-ProbeFile",
  at("probes.json"),
];
const ps = spawnSync(
  "powershell.exe",
  [...args, ...(process.argv.includes("--pdf") ? ["-Pdf"] : [])],
  {
    stdio: "inherit",
    timeout: 600_000,
  },
);

if (!existsSync(join(dir, "views.json"))) {
  const pid = existsSync(join(dir, "pid.txt"))
    ? readFileSync(join(dir, "pid.txt"), "utf8").trim()
    : "";

  if (/^\d+$/.test(pid)) {
    spawnSync("taskkill.exe", ["/PID", pid, "/F"]);
  }

  console.error(
    `Word did not finish (${ps.error?.message ?? `exit ${ps.status}`}).`,
  );

  process.exit(2);
}

const inspection = Inspection.parse(
  JSON.parse(readFileSync(join(dir, "views.json"), "utf8")),
);

const entry = (name: string) => {
  return inspection.files.find(
    (e) => basename(e.file.replaceAll("\\", "/")) === name,
  );
};

const opens = (names: string[]): Check => {
  return {
    name: "Opens in Word without repair",
    problems: names
      .filter((n) => !entry(n)?.opened)
      .map((n) => `${n}: ${entry(n)?.error ?? "not checked"}`),
  };
};

const sections: {
  title: string;
  pages: string;
  checks: Check[];
}[] = fixtures.map((f) => {
  const [template, filled, roundTrip] = [
    `${f}.docx`,
    `${f}.filled.docx`,
    `${f}.roundtrip.docx`,
  ].map((n) => entry(n)?.view ?? null);
  const checks = [
    opens([`${f}.docx`, `${f}.filled.docx`, `${f}.roundtrip.docx`]),
  ];

  if (template && filled && roundTrip) {
    checks.push(
      ...fillChecks(template, filled, answers.get(f) ?? { fields: [] }),
      roundTripCheck(filled, roundTrip),
    );
  }

  return {
    title: f,
    pages: [template, filled, roundTrip]
      .map((v) => v?.pages ?? "?")
      .join(" / "),
    checks,
  };
});
const lease = entry("synthetic-residential-lease.docx")?.view;
const edited = entry("lease-edited.docx");

if (edited && lease) {
  sections.push({
    title: "synthetic-residential-lease, edited in the browser (flow.spec.ts)",
    pages: String(edited.view?.pages ?? "?"),
    checks: [
      opens(["lease-edited.docx"]),
      ...(edited.view ? [editChecks(lease, edited.view)] : []),
    ],
  });
}

const failed = sections.flatMap((s) =>
  s.checks.filter((c) => c.problems.length).map((c) => `${s.title}: ${c.name}`),
);
const lines = [
  "# Microsoft Word check",
  "",
  `Word ${inspection.word.version} (build ${inspection.word.build}), ${new Date().toISOString().slice(0, 10)}. ${sections.length} documents, ${sections.reduce((n, s) => n + s.checks.length, 0)} checks, ${failed.length} failed.`,
  "",
  ...sections.flatMap((s) => [
    `## ${s.title}`,
    "",
    `Pages (template / filled / round trip): ${s.pages}`,
    "",
    ...s.checks.flatMap((c) => [
      `- ${c.problems.length ? "✗" : "✓"} ${c.name}`,
      ...c.problems.map((p) => `  - ${p}`),
    ]),
    "",
  ]),
];

writeFileSync(join(OUT, "report.md"), lines.join("\n"));
copyFileSync(join(dir, "views.json"), join(OUT, "views.json"));

for (const pdf of readdirSync(dir).filter((f) => f.endsWith(".pdf"))) {
  copyFileSync(join(dir, pdf), join(OUT, pdf));
}

console.log(`\n${lines[2]}\nReport: ${join(OUT, "report.md")}`);

for (const f of failed) {
  console.log(`  ✗ ${f}`);
}

process.exit(failed.length ? 1 : 0);
