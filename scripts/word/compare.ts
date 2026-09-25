import type { Answers, Format, Paragraph, Story, View } from "./views";

export interface Check {
  name: string;
  problems: string[];
}

const LEFTOVER = /\{\{|\[\[|\[[A-ZÀ-Ý][^\]]*\]/;

const isMarker = (p: Paragraph) => {
  return /^\[\[.*\]\]$/.test(p.text.trim());
};

const hasPlaceholder = (text: string) => {
  return LEFTOVER.test(text) || /_{4,}/.test(text);
};

const label = (p: Paragraph, i: number) => {
  return `¶${i + 1} “${p.text.slice(0, 40)}”`;
};

function differences<T extends object>(
  a: T,
  b: T,
  keys: (keyof T)[],
): string[] {
  return keys
    .filter((k) => a[k] !== b[k])
    .map(
      (k) => `${String(k)} ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`,
    );
}

function pairs(
  from: Paragraph[],
  to: Paragraph[],
  problems: string[],
): [Paragraph, Paragraph, number][] {
  if (from.length !== to.length) {
    problems.push(`paragraph count ${from.length} → ${to.length}`);
  }

  return from.flatMap((p, i): [Paragraph, Paragraph, number][] => {
    const q = to[i];

    return q ? [[p, q, i]] : [];
  });
}

const STYLE: (keyof Paragraph)[] = ["style", "outline"];
const LIST: (keyof Paragraph)[] = ["list", "listLevel", "listType"];
const LAYOUT: (keyof Paragraph)[] = [
  "font",
  "size",
  "align",
  "left",
  "first",
  "before",
  "after",
  "line",
  "inTable",
];
const EMPHASIS: (keyof Paragraph)[] = ["bold", "italic", "underline"];
const FORMAT: (keyof Format)[] = [
  "font",
  "size",
  "bold",
  "italic",
  "underline",
  "color",
];

function paragraphCheck(
  name: string,
  from: Paragraph[],
  to: Paragraph[],
  keys: (keyof Paragraph)[],
  skip: (p: Paragraph) => boolean = () => false,
): Check {
  const problems: string[] = [];

  for (const [p, q, i] of pairs(from, to, problems)) {
    if (skip(p)) {
      continue;
    }

    const d = differences(p, q, keys);

    if (d.length) {
      problems.push(`${label(p, i)}: ${d.join(", ")}`);
    }
  }

  return {
    name,
    problems,
  };
}

function storyProblems(where: string, a: Story, b: Story): string[] {
  return [
    ...differences(a, b, ["images"]).map((d) => `${where} ${d}`),
    ...(a.fields.join() !== b.fields.join()
      ? [`${where} fields ${a.fields.join()} → ${b.fields.join()}`]
      : []),
  ];
}

const count = (what: string, a: unknown[], b: unknown[]) => {
  return a.length !== b.length ? [`${what} ${a.length} → ${b.length}`] : [];
};

const same = (what: string, a: string[], b: string[]) => {
  return a.join("\n") !== b.join("\n")
    ? [`${what} ${JSON.stringify(a)} → ${JSON.stringify(b)}`]
    : [];
};

function layoutChecks(from: View, to: View): Check[] {
  const margins = count("sections", from.sections, to.sections);
  const headers: string[] = [];

  from.sections.forEach((s, i) => {
    const t = to.sections[i];

    if (!t) {
      return;
    }

    margins.push(
      ...differences(s, t, [
        "top",
        "bottom",
        "left",
        "right",
        "width",
        "height",
        "orientation",
      ]).map((d) => `section ${i + 1} ${d}`),
    );

    headers.push(
      ...storyProblems(`section ${i + 1} header`, s.header, t.header),
      ...storyProblems(`section ${i + 1} footer`, s.footer, t.footer),
    );
  });

  const tables = [
    ...count("tables", from.tables, to.tables),
    ...from.tables.flatMap((t, i) =>
      differences(t, to.tables[i] ?? t, ["rows", "cols", "borders"]).map(
        (d) => `table ${i + 1} ${d}`,
      ),
    ),
  ];
  const kept = [
    ...count("footnotes", from.footnotes, to.footnotes),
    ...count("endnotes", from.endnotes, to.endnotes),
    ...same(
      "comments",
      from.comments.map((c) => c.text),
      to.comments.map((c) => c.text),
    ),
    ...same(
      "tracked changes",
      from.revisions.map((r) => `${r.type}:${r.text}`),
      to.revisions.map((r) => `${r.type}:${r.text}`),
    ),
    ...(from.tocs !== to.tocs
      ? [`tables of contents ${from.tocs} → ${to.tocs}`]
      : []),
    ...same(
      "shapes",
      from.shapes.map((s) => String(s.type)),
      to.shapes.map((s) => String(s.type)),
    ),
    ...storyProblems("body", from.body, to.body),
    ...count("content controls", from.body.controls, to.body.controls),
  ];

  return [
    {
      name: "Tables",
      problems: tables,
    },
    {
      name: "Header and footer",
      problems: headers,
    },
    {
      name: "Margins and page size",
      problems: margins,
    },
    {
      name: "Notes, comments, tracked changes, pictures, text boxes, contents",
      problems: kept,
    },
  ];
}

export function fillChecks(
  template: View,
  filled: View,
  answers: Answers,
): Check[] {
  const source = template.paragraphs.filter((p) => !isMarker(p));
  const leftovers = [
    ...filled.paragraphs
      .filter((p) => LEFTOVER.test(p.text))
      .map((p) => `“${p.text.slice(0, 50)}”`),
    ...filled.sections
      .flatMap((s) => [s.header.text, s.footer.text])
      .filter((t) => LEFTOVER.test(t))
      .map((t) => `header/footer “${t.slice(0, 50)}”`),
    ...filled.shapes
      .filter((s) => LEFTOVER.test(s.text))
      .map((s) => `text box “${s.text.slice(0, 50)}”`),
    ...[
      ...filled.body.controls,
      ...filled.sections.flatMap((s) => s.header.controls),
    ]
      .filter((c) => c.mapped)
      .map(
        (c) =>
          `content control “${c.title ?? ""}” is still bound to document data`,
      ),
  ];
  const formatting = answers.fields.flatMap((f) => {
    const value = filled.probes.find((p) => p.text === f.answer);
    const placeholder = template.probes.find(
      (p) => p.text === f.placeholders[0],
    );

    if (!value || !placeholder) {
      return [];
    }

    if (!value.found) {
      return [`“${f.label}”: its answer is not in the document`];
    }

    if (!placeholder.found) {
      return [];
    }

    const d = differences(placeholder.first, value.whole, FORMAT);

    return d.length ? [`“${f.label}”: ${d.join(", ")}`] : [];
  });

  return [
    paragraphCheck("Paragraph styles", source, filled.paragraphs, STYLE),
    paragraphCheck(
      "Live numbering and bullets",
      source,
      filled.paragraphs,
      LIST,
    ),
    paragraphCheck(
      "Fonts, alignment, indents and spacing",
      source,
      filled.paragraphs,
      LAYOUT,
    ),
    paragraphCheck(
      "Bold, italic, underline (paragraphs without placeholders)",
      source,
      filled.paragraphs,
      EMPHASIS,
      (p) => hasPlaceholder(p.text),
    ),
    ...layoutChecks(template, filled),
    {
      name: "Values take the formatting of the placeholder they replace",
      problems: formatting,
    },
    {
      name: "No placeholder left",
      problems: leftovers,
    },
  ];
}

export function roundTripCheck(filled: View, roundTrip: View): Check {
  const problems: string[] = [];

  for (const [p, q, i] of pairs(
    filled.paragraphs,
    roundTrip.paragraphs,
    problems,
  )) {
    const d = differences(p, q, [
      "text",
      ...STYLE,
      ...LIST,
      ...LAYOUT,
      ...EMPHASIS,
    ]);

    if (d.length) {
      problems.push(`${label(p, i)}: ${d.join(", ")}`);
    }
  }

  if (filled.pages !== roundTrip.pages) {
    problems.push(`pages ${filled.pages} → ${roundTrip.pages}`);
  }

  problems.push(...layoutChecks(filled, roundTrip).flatMap((c) => c.problems));

  const controls = (v: View) => {
    return [
      ...v.body.controls,
      ...v.sections.flatMap((s) => s.header.controls),
    ].map((c) => `${c.text}|${c.placeholder}|${c.mapped}`);
  };

  problems.push(
    ...same("content controls", controls(filled), controls(roundTrip)),
  );

  problems.push(
    ...same("footnote text", filled.footnotes, roundTrip.footnotes),
    ...same(
      "text boxes",
      filled.shapes.map((s) => s.text),
      roundTrip.shapes.map((s) => s.text),
    ),
  );

  return {
    name: "Editor round trip changes nothing",
    problems,
  };
}

export function editChecks(template: View, edited: View): Check {
  const problems: string[] = [];

  const find = (text: string) => {
    return edited.paragraphs.find((p) => p.text.includes(text));
  };

  const heading = find("RESIDENTIAL LEASE AGREEMENT (DRAFT)");

  if (!heading) {
    problems.push("the heading edit is missing");
  } else if (heading.style !== template.paragraphs[0]?.style) {
    problems.push(`the edited heading lost its style (${heading.style})`);
  }

  if (find("The Tenant shall not: at any time")?.italic !== true) {
    problems.push("the italic paragraph edit is missing or not italic");
  }

  if (
    !edited.tables.some((t) =>
      t.cells.some((c) => c.includes("Deposit (refundable)")),
    )
  ) {
    problems.push("the table cell edit is missing");
  }

  const late = find("Late payments attract interest");

  if (late?.listLevel !== 2 || late.list !== "3.2.") {
    problems.push(
      `the outdented clause is ${late ? `“${late.list}” at level ${late.listLevel}` : "missing"}, expected “3.2.” at level 2`,
    );
  }

  if (find("A security deposit")?.list !== "3.3.") {
    problems.push("the next clause was not renumbered to 3.3.");
  }

  const bold = edited.probes.find((p) => p.text === "Strictly");

  if (!bold?.found || bold.whole.bold !== true) {
    problems.push("“Strictly” is not bold");
  }

  if (edited.paragraphs.some((p) => p.text.includes("ZZZ"))) {
    problems.push("the undone insertion is still there");
  }

  return {
    name: "Browser edits, as Word shows them",
    problems,
  };
}
