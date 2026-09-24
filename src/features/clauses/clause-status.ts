import type { RuleView } from "@/features/documents/contracts/document-view";

/** How clause states read to the lawyer: what needs them, what is shown, and in which order. */

export const needsAttention = (r: RuleView) => r.state === "unresolved" || r.state === "proposed" || r.pending;

/** Dismissed template markers are not shown again; a dismissed suggestion stays visible (it can be confirmed later). */
export const visibleRules = (rules: RuleView[]) => rules.filter((r) => !r.dismissed || r.source === "ai");

/** Items that need the user come first. */
const rank = (r: RuleView) => (r.pending ? 0 : r.state === "unresolved" ? 1 : r.state === "proposed" ? 2 : r.state === "dismissed" ? 4 : 3);

export const byAttention = (a: RuleView, b: RuleView) => rank(a) - rank(b);
