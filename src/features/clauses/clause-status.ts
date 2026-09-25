import type { RuleView } from "@/features/documents/contracts/document-view";

export const needsAttention = (r: RuleView) => {
  return r.state === "unresolved" || r.state === "proposed" || r.pending;
};

/**
 * Dismissed template markers are not shown again; a dismissed
 * suggestion stays visible (it can be confirmed later).
 */
export const visibleRules = (rules: RuleView[]) => {
  return rules.filter((r) => !r.dismissed || r.source === "ai");
};

/** Items that need the user come first. */
const rank = (r: RuleView) => {
  return r.pending
    ? 0
    : r.state === "unresolved"
      ? 1
      : r.state === "proposed"
        ? 2
        : r.state === "dismissed"
          ? 4
          : 3;
};

export const byAttention = (a: RuleView, b: RuleView) => {
  return rank(a) - rank(b);
};
