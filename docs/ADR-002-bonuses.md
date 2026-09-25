# ADR-002: Stable paragraph identity for the four bonuses

**Status:** accepted.

## Context
French/mixed templates, conditional clauses, a template-to-draft comparison and saved drafts all have to work on a draft the lawyer has edited in the browser. The server therefore needs to find a given template paragraph again in an edited DOCX that SuperDoc re-serialized. The original code located values by `part#paragraphOrdinal`, which breaks as soon as a paragraph is inserted or removed. That was already a documented limitation for answer corrections, and it rules out removing or restoring a clause.

## Evidence (spike, before any feature code)
Three identity carriers were injected into a template: a bookmark, a block content control with a `w:tag`, and a `w14:paraId`. The template was then edited in the **real browser editor**: we typed text, pressed Enter to split a paragraph, saved, reloaded and edited again. The results:
- All three carriers survived.
- Existing `w14:paraId`s were **identical across two save/reload cycles**, 24 of 24.
- SuperDoc gives paragraphs without an id one of its own, and a paragraph created by Enter gets a new unique id.

## Decision
- **Identity.** At draft generation the server gives every paragraph without a `w14:paraId` a deterministic one derived from its part and ordinal (`ensureParaIds`), and keeps existing ids. The same template always yields the same ids, so the untouched original and any working draft can be aligned without storing a mapping.
- **Answers.** Anchors record the paragraph's `paraId` plus offsets. After server-side edits they are rebased: an edit earlier in a paragraph shifts later anchors. Unanswered markers get identity anchors, so an answer given after drafting, for example in a clause restored later, is still written.
- **Conditional clauses.** A clause is a contiguous run of top-level body elements, located by the paraIds of its paragraphs.
  - *Exclusion* cuts those whole elements and stores their exact XML (`removedXml`), plus the paraIds of the neighbours as the slot.
  - *Inclusion* re-inserts the stored XML, or renders the clause from the template when it was excluded at generation.
  - A text-and-format hash detects hand edits. An edited clause is only removed after confirmation, and its edited version comes back on re-inclusion.
  - Section breaks, partial tables and missing relationships are refused rather than guessed at.
  - `numbering.xml` is never touched; Word renumbers from what remains.
  - Plain-text clause references ("clause 4", "article 4") are tracked from the template's own numbering and rewritten only where the text still says what we wrote. References to a removed clause are reported before export.
- **Rule grammar.** `[[IF name]]`, `[[IF NOT name]]`, `[[IF name = v]]`, `[[IF name IN a, b]]`, `[[END IF]]` (French: `SI`, `SI NON`, `FIN SI`). It is parsed, never executed, with no nesting. Word and SuperDoc have no native conditional-clause metadata, so there was no engine feature to honour. Model-proposed rules need verbatim template evidence and apply only after the user confirms them.
- **Comparison.** Blocks of the untouched template (with the same deterministic ids) are compared with blocks of a snapshot: the editor's current export (not saved), else the saved draft, else an in-memory preview. Alignment uses the paraId, then a longest-increasing-subsequence to drop crossings, then an exact-text LCS and similarity inside the gaps. Text is compared word by word, with placeholders as whole tokens.
  - *Covered:* bold, italic, underline, paragraph style, heading level and list level.
  - *Not covered:* fonts, sizes, colours, spacing and layout.
  - Nothing is cached: a comparison takes milliseconds and would otherwise need invalidation on every keystroke.
- **Persistence.** Neon is authoritative. The working DOCX holds the document, including manual edits, tables, numbering and headers. Field state (JSONB) holds answers, anchors, rules, removed clause variants, references, language metadata and the chosen chat language. Messages are stored separately. Answer changes and structural changes that alter the document are written in **one** `UPDATE` with the DOCX, guarded by both revision counters. Restoring a draft needs no model call and no regeneration.

## Consequences
- A paragraph the user **moves** (cut and paste) gets a new id and shows up in the comparison as removed plus added.
- A clause whose neighbouring paragraphs were all deleted cannot be restored safely. That is reported instead of guessed.
- Ids are Word-compatible (`< 0x80000000`, `w14` declared and marked ignorable).
- Microsoft Word itself has not been run on these outputs (see the Word checklist in [DETAILS.md](DETAILS.md#verification)).
