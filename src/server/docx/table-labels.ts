import type { Block } from "./blocks";

export interface CellLabels {
  row: string;
  column: string;
  valueColumns: number;
}

const PLACEHOLDER = /\{\{|\[[^\]]+\]|_{3,}/;
const GENERIC_HEADER =
  /^((agreed|contract(ual)?) )?(value|amount|details?|information)$|^(valeur|montant|détails?|informations?)( convenue| contractuelle)?$/i;

const clean = (s: string) => {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*$/, "")
    .trim();
};

export function cellLabeller(
  blocks: Block[],
): (block: Block) => CellLabels | null {
  const tables = new Map<string, Block[]>();

  for (const b of blocks) {
    if (b.kind === "tableCell" && b.table) {
      const key = `${b.part}|${b.table.table}`;

      tables.set(key, [...(tables.get(key) ?? []), b]);
    }
  }

  return (block) => {
    const { table } = block;

    if (!table) {
      return null;
    }

    const cells = tables.get(`${block.part}|${table.table}`) ?? [];

    const textAt = (row: number, col: number) => {
      return clean(
        cells
          .filter((c) => c.table?.row === row && c.table.col === col)
          .map((c) => c.text)
          .join(" "),
      );
    };

    const cols = [...new Set(cells.map((c) => c.table?.col ?? 0))];
    const header =
      table.row > 0 &&
      cols.every((c) => {
        const t = textAt(0, c);

        return t !== "" && !PLACEHOLDER.test(t);
      });

    return {
      row: table.col > 0 ? textAt(table.row, 0) : "",
      column: header ? textAt(0, table.col) : "",
      valueColumns: cols.filter((c) => c > 0).length,
    };
  };
}

export function cellLabel(labels: CellLabels): string {
  const column = labels.column
    .split(/\s*\/\s*/)
    .every((segment) => GENERIC_HEADER.test(segment))
    ? ""
    : labels.column;

  if (labels.row && column) {
    return `${labels.row} (${column})`;
  }

  return labels.row || column;
}
