# Requirements → implementation → evidence

Legend: **V** verified by automated test or observed run · **M** verified with a mocked model only · **L** also exercised against live Gemini · **P** pending (needs Word, employer templates or more live runs)

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| 1 | Upload one .docx (drag-drop + picker), validate the real package | `UploadPanel.tsx`, `server/docx/package.ts` (central directory read before inflation, limits, CFB/encrypted/macro/non-docx rejection) | `docx-core.test.ts` "package validation"; HTTP smoke (fake file → 422); E2E "rejects an invalid upload" | V |
| 2 | Detect `{{x}}`, `[X]`, `____`, mixed styles, placeholders split across runs, and Word content controls (placeholder boxes) | `server/docx/detect.ts`, `server/docx/paragraph-text.ts` (run-joined paragraph text; `placeholderSpans`) and `server/docx/edit.ts` (`commitControl` when a box is filled) | `docx-core.test.ts` "finds placeholders split across differently formatted runs" and "Word content controls"; `controls.spec.ts`; live run on a real content-control letter | V / L |
| 3 | Detect contextual / implicit fields ("the Tenant, of …"), and placeholder wording to replace | `server/ai/analyze.ts` + `buildFields` verbatim-quote verification (`replace` flag, overlap checks) | `docx-core.test.ts` (unverifiable quote rejected; placeholder wording replaced, overlaps refused); integration analysis with mocked model | M / P live |
| 4 | Fields with ids, types, anchors, status, confidence, correction UI | `features/documents/contracts/fields.ts`, `FieldPanel.tsx`, `PATCH /fields` | Integration + HTTP smoke (10/10 fields confirmed via panel) | V |
| 5 | Plain-language, ordered, grouped questions; every detected field is asked | Group order parties→subject→dates→money→other, `replyPrompt` (details still needed by name, `READY TO GENERATE`), `openingMessage`, distinct labels in `buildFields` | Integration asserts `NEXT TO ASK` context; `interview.test.ts`; live replay of a real conversation asked every field and nothing else | M / L |
| 6 | One answer fills several fields | `extract` + `applyExtraction` | Integration "fills several fields from one answer" | M |
| 7 | Validate/clarify dates, amounts, currency, chronology | `server/fields/normalize.ts` | `normalize-events.test.ts`; integration (03/04/2026, Rs ambiguity) | V |
| 8 | Never fabricate values | Mandatory verbatim evidence from the user message | Integration "rejects values the user never wrote"; mutation check | M (guard is deterministic) |
| 9 | Corrections update all occurrences | Field → multiple occurrences; `anchoredUpdates` after drafting | Integration "applies a later correction to every untouched occurrence" | M |
| 10 | "What does this clause mean / is it usual?" | `clauseBlockIds` → `clauseContext` (+ sub-clauses) → cautious reply rules | Integration asserts clause + sub-clause text reach the reply prompt | M / P live wording |
| 11 | Assistant responses stream | `streamText` → `assistant_delta` SSE | Integration: multiple deltas before `assistant_done` (mock stream) | M / P live |
| 12 | Draft streams progressively (real events) | `fillAndRender` generator → `draft_block_ready` → `draft_complete` | Integration order; HTTP smoke: 19 network chunks, first block @19 ms, complete @76 ms | V |
| 13 | Draft view = the same revision that is edited/exported | Preview from filled OOXML blocks; editor opens persisted bytes of that revision | Code path + E2E (editor shows filled values) | V |
| 14 | Cancel, idempotent retry, stale events ignored | AbortSignal propagation, Redis locks, requestId/seq filtering | Integration cancellation + dedupe; client filter by requestId | V |
| 15 | Word-like editor: headings, paragraphs, B/I/U, lists, legal numbering, tables, undo/redo | SuperDoc 2.17, restricted toolbar | E2E: heading, italic paragraph, table cell, list outdent (toolbar), bold (toolbar), undo | V (other toolbar buttons not individually tested) |
| 16 | Export .docx with latest edits, including an edit just before Download | Debounced save + `flush()` before download | E2E immediate download; XML assertions | V |
| 17 | Export looks like the original (styles, numbering, spacing, headers/footers, margins) | OOXML-only text edits; SuperDoc round-trip | Unit (numbering.xml byte-identical); E2E XML checks; LibreOffice render comparison | V (LibreOffice) / P Word |
| 18 | Single page, desktop two-panel, mobile/tablet tabs, no page overflow | `features/workspace/components/` (`Workspace.tsx`, `DocumentWorkspace.tsx`) | E2E 390 px and 820 px | V |
| 19 | Accessibility: labels, focus, live regions, reduced motion | ARIA labels, `aria-live`, `:focus-visible`, reduced-motion CSS | Code review only (no automated a11y audit run) | P |
| 20 | Neon source of truth, migrations, optimistic revisions, retention | Drizzle schema + `drizzle/0000_init.sql`, `repo.ts`, `db:cleanup` | Integration on PostgreSQL 16; drizzle-kit migrate ran; cleanup ran | V local / P Neon |
| 21 | Anonymous session isolation | Hashed cookie secret, session-scoped queries, Origin checks | Integration + HTTP smoke (404 on every cross-session route) | V |
| 22 | Upstash cache/dedupe/rate limits with safe fallback | `server/cache/redis.ts` | Integration (cache reuse, isolation, outage, dedupe); production fails closed without Redis (observed 503) | V (fake store) / P Upstash |
| 23 | Gemini cost controls | Local detection first, cached analysis, compact prompts, 2 calls/turn, output caps, minimal thinking, usage ceilings | Code + integration usage tracking | M / P live |
| 24 | Template text treated as untrusted | Data wrapping + system rules + deterministic validation of every mutation | Code; no live injection test | P |
| 25 | README, licences, limitations; recording | `README.md`, `docs/ADR-001-document-engine.md`, `docs/ADR-002-bonuses.md`, `WALKTHROUGH.md` | — | Recording P |

## Bonuses

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| B1 | French and mixed templates: accented, run-split placeholders | `server/docx/detect.ts` (Unicode markers, accent-insensitive keys) | Unit: French fixture markers incl. `{{date_de_` + `signature}}` split across runs | V |
| B2 | Language per paragraph/occurrence and per document; explicit unknown/mixed | `server/fields/lang.ts`, `Occurrence.lang`, `FieldState.language` | Unit (detection, document language); integration (bilingual lease = mixed) | V |
| B3 | EN/FR equivalents grouped only when the same value; language-independent ids | Analysis prompt + `buildFields`; no deterministic merging | Unit (no merge without AI; unprefixed live keys resolved); live analysis merges the employment pairs | V / L |
| B4 | Chat language: user's, else template's; EN/FR control stored; switching re-asks nothing; no translation of the contract | `replyLanguage`, `setConversationLanguage`, `languageSwitchMessage`, Auto/English/Français control | Integration (French reply prompt, switch with zero model calls); live browser (French reply, then English) | V / L |
| B5 | Canonical values vs per-occurrence rendering; exact French amounts; ambiguous dates and separators asked; no currency from language | `normalize.ts` (`renderAt`, `parseMoney` with language), `lang.ts` (`parseAmount`) | Unit + integration: "1 octobre 2026" / "1 October 2026", "1 250,50 EUR" / "EUR 1,250.50", `25,000` asked | V |
| B6 | Deterministic conditional rules; bounded grammar; invalid markers rejected; no eval | `server/clauses/` (`condition-markers.ts`, `evaluation.ts`) | Unit (grammar, nesting/unpaired/inline/table rejection) | V |
| B7 | Yes / no / unknown; unknown never false; inactive fields not blocking; overrides explicit | `evaluateRule`, `inactiveFields`, `ruleAction`, `ClausePanel` | Unit + integration (unknown blocks generation; override persisted and visible) | V |
| B8 | Exclusion really removes the clause from the DOCX; inclusion restores it once; idempotent; numbering and references consistent; dangling reference surfaced before export | `server/docx/clause-structure.ts`, `clause-references.ts`, `server/draft/` (`buildDraft`, `updateWorkingDraft`) | Unit on the real DOCX (text equal after no→yes; `numbering.xml` unchanged; "clause 4"→"3"; issue for "Clause 3 survives"); browser E2E export check | V |
| B9 | Edited clause: confirm before removal; edited variant preserved and restored | `contentHash`, `removedXml`, `pendingClauses`, "Remove the clause" | Unit + integration + live browser | V / L |
| B10 | Model-proposed rules only from template wording, confirmed by the user | `validateProposal` (verbatim evidence, whole tables) | Unit (accept/reject, not applied until confirmed) | M (never proposed live: no fixture wording) |
| B11 | Read-only diff: added/deleted/modified, word level, filled placeholders, clause exclusions with reason, table cells, B/I/U, style/heading/list level; noise ignored | `server/diff/`, `ComparePanel.tsx` | Unit (incl. run splitting, reverting, accents/amounts) | V |
| B12 | Compare includes an edit made just before opening, without saving; no markup in saved/exported DOCX | Editor `snapshot()` → `POST /compare` | Integration (unsaved edit visible, revision unchanged); live browser; DOCX checks | V |
| B13 | Multiple drafts per anonymous browser; list/open/rename/delete; ownership on every route | `/api/drafts`, `/api/documents/[id]` (GET/PATCH/DELETE), `copy`, `DraftsDrawer` | Integration (other identity denied on 8 operations); HTTP smoke (404 on every route) | V |
| B14 | Retention 30 days after last save; cookie and DB expiry aligned and sliding; expired never served; bounded cleanup incl. caches | Migration `0001`, `repo.ts`, `session.ts`, `scripts/cleanup.ts` | Integration (expired → 404, `deleteExpired`); cleanup run | V |
| B15 | Authoritative saved state recreates the draft; restore makes no model call and does not regenerate | Working DOCX + field state + messages; paraId anchors | Integration (zero model calls, no duplicate messages); browser (close and reopen the same profile) | V |
| B16 | Autosave with a max interval, Save now, accurate status, conflict choice, failure keeps edits, export uses the latest editor state | `SuperDocEditor.tsx`, `save-coordinator.ts`, `DocumentWorkspace.tsx` | Integration (stale second-tab save rejected); unit (coordinator: coalescing, max wait, conflict keeps edits); browser (Save now, reopen; a second tab's stale save is detected and the newer version loaded: `drafts.spec.ts`); E2E immediate download | V ("Save mine as a new draft" not browser-tested) |
| B17 | Interrupted generation shown as incomplete, with retry | `phase: "interrupted"`, "Retry generation" | Integration | V |
| B18 | Responsive, keyboard-accessible controls | Native `<dialog>`, tabs with `role=tab`, text labels and icons beside colour | Browser 390/820 px incl. Compare + Saved drafts; Escape closes the drawer; see U8 | V (no screen-reader run) |
| B19 | Microsoft Word opens the exported bilingual/conditional drafts correctly | — | — | P (see the README checklist) |

## Interface upgrade

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| U1 | Light / Dark / System, System by default; explicit choice persisted; OS changes followed only under System; storage failure handled | `lib/theme.ts`, `ThemeControl.tsx` (`ThemeSync` in the root layout) | `theme.spec.ts`; unit (resolution); scripted check with blocked storage | V |
| U2 | No wrong-theme flash, no hydration warnings, SSR kept | Inline `<head>` script (Next guide), `suppressHydrationWarning` on `<html>` only | `theme.spec.ts` (theme set before `interactive`); dev server checked in both themes | V |
| U3 | Theme never changes the document, the editor state or the export | Page colour pinned; SuperDoc chrome via `--sd-ui-*`, `--sd-ui-loader-*`, `uiDisplayFallbackFont`; context-menu classes only | `theme.spec.ts` (same editor instance, no requests, white page, identical `document.xml`) | V |
| U4 | Chat: streaming, one entrance animation, working indicator, Stop, scroll that respects the reader, Jump to latest, inline failure and retry without duplicates, "details updated", Enter/Shift+Enter/IME | `features/chat/` (`use-chat-turn.ts`, `ChatPanel.tsx`, `format.ts`), `chatTurn` de-duplication | `chat.spec.ts` (stream stubbed); integration (retry stored once); unit (formatting) | V (live streaming: see the live row) |
| U5 | Unsent input, tab, scroll and editor survive tab, view and theme switches | Panels kept mounted and hidden with `visibility` | `theme.spec.ts`; `flow.spec.ts` (views on phone/tablet) | V |
| U6 | Honest counts: details vs clause decisions | `features/documents/progress.ts` (a deciding yes/no counts once), used by the workspace status and by `detailsLeft`/`decisionsLeft` in `GET /api/drafts` | Browser screenshots; drafts list | V |
| U7 | Download never disabled without a reason; export failure shown with retry | `downloadHint` + `aria-describedby`; fetched download with an error banner | Browser (disabled state, hint); failure path not forced in a test | V / P (failure path) |
| U8 | Contrast, keyboard, focus, reduced motion | Tokens, `:focus-visible`, native dialogs and radios, APG tab keys, popover focus handling, reduced-motion rules | Scripted contrast audit of rendered text in both themes; keyboard and focus checks; reduced-motion check | V (Chromium only) |
| U9 | Responsive 360–1600 px and short landscape, no horizontal overflow, dialogs fit | Single view below 1024 px, More actions menu, compact short-height chat header | `flow.spec.ts` (390, 820); scripted sweep (360, 768, 1024, 1366, 1600, 844 × 390) | V |

