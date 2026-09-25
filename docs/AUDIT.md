# File audit

Every first-party file, reviewed for the September 2026 refactor (see [ARCHITECTURE.md](ARCHITECTURE.md)). Line counts are physical lines when this record was written; the baseline is commit `fd4b280`. Work done after the refactor ([After the refactor](ARCHITECTURE.md#after-the-refactor)) is marked *Later*.

## Current files

| File | Lines | Responsibility | Review | Decision |
| --- | ---: | --- | --- | --- |
| `.env.example` | 30 | Documented environment variables | Reviewed | Reviewed, unchanged |
| `.gitignore` | 14 | Ignored files | Reviewed | Reviewed, unchanged |
| `.prettierignore` | 11 | Files Prettier leaves alone (build output, fixtures, migrations) | Reviewed | Later: new |
| `.prettierrc.json` | 3 | Prettier settings (print width 160) | Reviewed | Later: new |
| `AGENTS.md` | 9 | Agent notes written by next dev | Reviewed | Reviewed, unchanged |
| `CLAUDE.md` | 1 | Points to AGENTS.md | Reviewed | Reviewed, unchanged |
| `README.md` | 465 | Setup, architecture, behaviour, verification | Reviewed | Updated (layout, commands, test counts). Later: Word check, live evaluation, browsers, latency |
| `REQUIREMENTS.md` | 70 | Requirement-to-code traceability | Reviewed | Updated (paths; B16 now browser-tested). Later: rows 11, 17, 23, 24 and B19 |
| `WALKTHROUGH.md` | 49 | Demo script | Reviewed | Reviewed, unchanged |
| `docs/ADR-001-document-engine.md` | 26 | Decision: document engine | Reviewed | Reviewed, unchanged |
| `docs/ADR-002-bonuses.md` | 35 | Decision: bonus features | Reviewed | Reviewed, unchanged |
| `docs/ARCHITECTURE.md` | 179 | Layout, rules, state ownership, refactor note | Reviewed | New. Later: sizes now, work after the refactor |
| `docs/AUDIT.md` | 213 | This record | Reviewed | New |
| `drizzle.config.ts` | 9 | Drizzle Kit configuration | Reviewed | Schema path updated |
| `drizzle/0000_init.sql` | 40 | Initial migration | Reviewed | Unchanged (no migration needed) |
| `drizzle/0001_drafts_retention.sql` | 8 | Retention columns migration | Reviewed | Unchanged |
| `drizzle/meta/0000_snapshot.json` | 308 | Drizzle snapshot | Reviewed | Unchanged |
| `drizzle/meta/0001_snapshot.json` | 351 | Drizzle snapshot | Reviewed | Unchanged |
| `drizzle/meta/_journal.json` | 20 | Drizzle journal | Reviewed | Unchanged |
| `eslint.config.mjs` | 56 | Lint: Next rules, layer rules, assertion bans | Reviewed | Updated |
| `eslint.cycles.config.mjs` | 5 | Import-cycle check (npm run check:cycles) | Reviewed | New |
| `next.config.ts` | 22 | Security headers, CSP, server packages | Reviewed | Reviewed, unchanged |
| `package-lock.json` | 11528 | Locked dependency tree | Reviewed | Updated with package.json |
| `package.json` | 69 | Scripts and dependencies | Reviewed | TanStack Query added; pg made a runtime dependency; check:cycles. Later: check:word, eval:conversation, format, Prettier |
| `playwright.config.ts` | 31 | Browser test configuration | Reviewed | Reviewed. Later: Firefox and WebKit projects (E2E_BROWSERS, WEBKIT_PATH) |
| `postcss.config.mjs` | 2 | Tailwind v4 PostCSS plugin | Reviewed | Reviewed, unchanged |
| `scripts/cleanup.ts` | 35 | Retention cleanup (cron) | Reviewed | Kept; uses the shared cache key |
| `scripts/eval-conversation.ts` | 217 | Live conversation evaluation (npm run eval:conversation) | Reviewed | Later: new |
| `scripts/fixtures/content-controls.ts` | 104 | Fixture: French letter whose blanks are placeholder boxes | Reviewed | Later: split from scripts/make-fixtures.ts |
| `scripts/fixtures/english.ts` | 100 | Fixtures: NDA and residential lease | Reviewed | Later: split from scripts/make-fixtures.ts |
| `scripts/fixtures/french.ts` | 128 | Fixtures: French services agreement, bilingual lease and employment contract | Reviewed | Later: split from scripts/make-fixtures.ts |
| `scripts/fixtures/parts.ts` | 57 | Shared fixture parts: styles, numbering, clauses, header, footer | Reviewed | Later: split from scripts/make-fixtures.ts |
| `scripts/fixtures/rich.ts` | 100 | Fixture: supply agreement with a picture, contents, a footnote, a comment, tracked changes and a text box | Reviewed | Later: new |
| `scripts/gemini-smoke.ts` | 46 | One live model check | Reviewed | Kept; thinking level validated. Later: `--gateway` runs it through the Vercel AI Gateway |
| `scripts/make-fixtures.ts` | 30 | Writes the synthetic templates (CLI) | Reviewed | Later: split; the templates moved to scripts/fixtures/ |
| `scripts/word/check.ts` | 134 | Word check: runs Word on every export, writes the report | Reviewed | Later: new |
| `scripts/word/compare.ts` | 174 | The Word checks: an export against what it came from | Reviewed | Later: new |
| `scripts/word/inspect.ps1` | 133 | What Word reports about each document (PowerShell, COM) | Reviewed | Later: new |
| `scripts/word/views.ts` | 77 | Schemas of Word's report and of the answers given | Reviewed | Later: new |
| `src/app/api/documents/[id]/chat/route.ts` | 27 | POST: one chat turn as SSE | Reviewed | Kept thin; ownership checked before streaming |
| `src/app/api/documents/[id]/compare/route.ts` | 23 | POST: template-to-draft comparison | Reviewed | Kept thin |
| `src/app/api/documents/[id]/copy/route.ts` | 20 | POST: save a copy (with the editor's content) | Reviewed | Kept thin |
| `src/app/api/documents/[id]/docx/route.ts` | 37 | GET/PUT: the editor's working DOCX (revision-checked) | Reviewed | Kept thin |
| `src/app/api/documents/[id]/download/route.ts` | 24 | GET: export the working draft | Reviewed | Kept thin. Later: the file name comes from `draftFileName` |
| `src/app/api/documents/[id]/word-link/route.ts` | 17 | POST: a short-lived link to the saved draft for Word | Reviewed | New |
| `src/app/api/word/[token]/[name]/route.ts` | 29 | GET/HEAD: the saved draft for Word, by signed link | Reviewed | New |
| `src/app/api/documents/[id]/draft/route.ts` | 23 | POST: generate the draft as SSE | Reviewed | Kept thin; ownership checked before streaming |
| `src/app/api/documents/[id]/fields/route.ts` | 19 | PATCH: correct one field | Reviewed | Kept thin |
| `src/app/api/documents/[id]/route.ts` | 50 | GET resume; PATCH rename or chat language; DELETE | Reviewed | Kept thin; bodies parsed with contract schemas |
| `src/app/api/documents/[id]/rules/route.ts` | 19 | POST: a clause decision | Reviewed | Kept thin |
| `src/app/api/documents/current/route.ts` | 15 | GET: the browser's latest draft | Reviewed | Kept |
| `src/app/api/documents/route.ts` | 26 | POST: upload a template | Reviewed | Kept thin: session, origin, then the upload use case |
| `src/app/api/drafts/route.ts` | 15 | GET: saved drafts of this browser | Reviewed | Kept |
| `src/app/globals.css` | 424 | Theme tokens, Tailwind v4 layers, motion, SuperDoc chrome | Reviewed | Kept (one comment path updated). Later: a fitted page may shrink (`.lx-fit`) |
| `src/app/layout.tsx` | 42 | Root layout: fonts, theme set before paint, query provider | Reviewed | Kept; wraps the page in the query provider |
| `src/app/page.tsx` | 6 | Server page: passes the upload limit to the workspace | Reviewed | Kept; renders the workspace feature |
| `src/app/providers.tsx` | 9 | TanStack Query provider (one client per tab) | Reviewed | New |
| `src/features/chat/api.ts` | 13 | Chat turn stream and chat-language call | Reviewed | New (from lib/client/api.ts) |
| `src/features/chat/components/ChatHeader.tsx` | 112 | Chat language and what is still needed | Reviewed | Split from components/ChatPanel.tsx |
| `src/features/chat/components/ChatPanel.tsx` | 106 | Conversation layout: scrolling, Jump to latest, failure | Reviewed | Moved from components/ (was 347 lines, split in four) |
| `src/features/chat/components/Composer.tsx` | 89 | Message box: send, stop, keyboard | Reviewed | Split from components/ChatPanel.tsx |
| `src/features/chat/components/Message.tsx` | 112 | One message: formatting, streaming caret, details updated | Reviewed | Split from components/ChatPanel.tsx |
| `src/features/chat/format.ts` | 39 | Reply formatting: paragraphs, lists, bold | Reviewed | Moved from lib/client/; rewritten without assertions (same output on 20,000 replies) |
| `src/features/chat/use-chat-turn.ts` | 149 | A turn's stream, the conversation list, chat language | Reviewed | Split from components/Workspace.tsx |
| `src/features/clauses/clause-status.ts` | 13 | Which clauses need attention, are shown, and their order | Reviewed | Split from components/ClausePanel.tsx |
| `src/features/clauses/components/ClauseDecision.tsx` | 81 | The answer an undecided clause waits for | Reviewed | Split from components/ClausePanel.tsx |
| `src/features/clauses/components/ClausePanel.tsx` | 64 | Clauses with their status, and structure issues | Reviewed | Moved from components/ (was 203 lines, split in three) |
| `src/features/clauses/components/RuleCard.tsx` | 129 | One clause and its actions | Reviewed | Split from components/ClausePanel.tsx |
| `src/features/comparison/api.ts` | 6 | Comparison call with the editor snapshot | Reviewed | New (from lib/client/api.ts) |
| `src/features/comparison/components/ComparePanel.tsx` | 231 | Comparison view: summary, step through changes | Reviewed | Moved from components/; data through useComparison instead of an effect and a nonce |
| `src/features/comparison/components/DiffText.tsx` | 40 | Highlighted word diff | Reviewed | Split from components/ComparePanel.tsx |
| `src/features/comparison/contracts.ts` | 35 | Diff result schema | Reviewed | New (was a TS type in lib/diff.ts) |
| `src/features/comparison/queries.ts` | 18 | useComparison: keyed by revision, never cached | Reviewed | New |
| `src/features/documents/api.ts` | 47 | Draft endpoints, every response validated | Reviewed | New (from lib/client/api.ts) |
| `src/features/documents/components/DraftPreview.tsx` | 129 | Preview that grows as the draft streams | Reviewed | Moved from components/; table grouping rewritten without assertions |
| `src/features/documents/components/FieldPanel.tsx` | 78 | Details grouped, with progress | Reviewed | Moved from components/ (was 173 lines, split in two) |
| `src/features/documents/components/FieldRow.tsx` | 121 | One detail: edit, dismiss, where it appears | Reviewed | Split from components/FieldPanel.tsx; saves through a mutation |
| `src/features/documents/components/UploadPanel.tsx` | 271 | Upload screen and examples | Reviewed | Moved from components/; assertions removed |
| `src/features/documents/contracts/document-view.ts` | 68 | Draft view, clause state, messages (zod) | Reviewed | New (DTOs from lib/server/service.ts) |
| `src/features/documents/contracts/fields.ts` | 96 | Field model (zod) | Reviewed | Moved from lib/fields/types.ts (persisted state moved to server/fields/state.ts) |
| `src/features/documents/contracts/requests.ts` | 31 | Request bodies (zod) | Reviewed | New (schemas that lived in routes) |
| `src/features/documents/contracts/stream-events.ts` | 46 | SSE events (zod) | Reviewed | Moved from lib/events.ts (encoder and decoder moved out) |
| `src/features/documents/editor/SuperDocEditor.tsx` | 219 | SuperDoc wrapper: load, flush, snapshot | Reviewed | Moved from components/; saving delegated to the save coordinator. Later: fit-width zoom below 900 px |
| `src/features/documents/editor/save-coordinator.ts` | 89 | Debounced, one-at-a-time autosave with conflict state | Reviewed | New (extracted from SuperDocEditor.tsx); unit-tested |
| `src/features/documents/progress.ts` | 34 | What is still needed (the one definition) | Reviewed | New (merged three copies) |
| `src/features/documents/queries.ts` | 83 | Draft keys, queries, cache writes, field and clause mutations | Reviewed | New |
| `src/features/documents/use-draft-generation.ts` | 67 | Generation stream and preview blocks | Reviewed | Split from components/Workspace.tsx |
| `src/features/drafts/api.ts` | 9 | List, rename, delete calls | Reviewed | New (from lib/client/api.ts) |
| `src/features/drafts/components/DraftRow.tsx` | 143 | One saved draft: open, inline rename, menu | Reviewed | Split from components/DraftsDrawer.tsx |
| `src/features/drafts/components/DraftsDrawer.tsx` | 144 | Saved drafts dialog | Reviewed | Moved from components/; list and actions through queries and mutations |
| `src/features/drafts/contracts.ts` | 23 | Drafts list schemas | Reviewed | New (DTOs from lib/server/service.ts) |
| `src/features/drafts/queries.ts` | 41 | Drafts list query, rename and delete mutations | Reviewed | New |
| `src/features/workspace/components/AssistantPane.tsx` | 96 | Chat, Details and Clauses tabs | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/components/DocumentPane.tsx` | 121 | Document and Compare tabs; editor or preview | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/components/DocumentWorkspace.tsx` | 294 | One open draft: composes chat, generation, editor, download | Reviewed | Split from components/Workspace.tsx; mounted per draft |
| `src/features/workspace/components/ViewSwitcher.tsx` | 47 | One region at a time on narrow screens | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/components/Workspace.tsx` | 114 | Page shell: start-up, upload, open draft, drawer, session loss | Reviewed | Replaces components/Workspace.tsx (632 lines) |
| `src/features/workspace/components/WorkspaceHeader.tsx` | 179 | Title, status, steps, actions | Reviewed | Moved from components/ |
| `src/features/workspace/components/WorkspaceNotices.tsx` | 188 | Save and export banners; next-step bar | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/use-export.ts` | 78 | Export: save first, confirm open issues, then download or open in Word | Reviewed | Split from components/Workspace.tsx (as use-download.ts). Later: Open in Word |
| `src/features/workspace/use-session-loss.ts` | 26 | Notices a 401 from any query or mutation | Reviewed | New |
| `src/features/workspace/workspace-status.ts` | 75 | Progress, status line, export warnings | Reviewed | Split from components/Workspace.tsx; unit-tested |
| `src/lib/http.ts` | 67 | Validated fetch, ApiError, retry classification | Reviewed | New (replaces parse<T> with as T) |
| `src/lib/query-client.ts` | 25 | Query client defaults (retries) | Reviewed | New |
| `src/lib/sse.ts` | 66 | SSE decoder and POST event stream | Reviewed | New (decoder from lib/events.ts) |
| `src/lib/theme.ts` | 79 | Theme preference; script run before paint | Reviewed | Moved from lib/client/ |
| `src/server/ai/analyze.ts` | 95 | Template analysis: cached, one repair attempt | Reviewed | Moved from lib/ai/ |
| `src/server/ai/extraction.ts` | 178 | Chat stage 1: validated extraction | Reviewed | Split from lib/ai/interview.ts; assertion removed. Later: a date in figures is validated as the user wrote it |
| `src/server/ai/interview-messages.ts` | 52 | Opening and language-switch messages (no model call) | Reviewed | Split from lib/ai/interview.ts |
| `src/server/ai/fallback.ts` | 70 | Gemini with the Vercel AI Gateway as fallback, one-minute skip after a failure | Reviewed | New |
| `src/server/ai/model.ts` | 153 | Model choice (`AI_PROVIDER`), budgets, usage, AI errors | Reviewed | Moved from lib/ai/. Later: a lasting 5xx is reported as unavailable; Gemini or the gateway, and their errors named |
| `src/server/ai/reply.ts` | 101 | Chat stage 2: the streamed reply | Reviewed | Split from lib/ai/interview.ts. Later: clause text without block ids; the stream's failure is kept; no prompt labels in replies |
| `src/server/cache/redis.ts` | 155 | Cache, locks, rate limits, fallback policy | Reviewed | Moved from lib/cache/; typed ProtectionUnavailableError |
| `src/server/clauses/condition-markers.ts` | 185 | [[IF …]] marker grammar | Reviewed | Split from lib/fields/rules.ts |
| `src/server/clauses/evaluation.ts` | 82 | Deterministic clause evaluation, inactive fields | Reviewed | Split from lib/fields/rules.ts |
| `src/server/clauses/proposals.ts` | 75 | Validation of clauses the model proposes | Reviewed | Split from lib/fields/rules.ts |
| `src/server/db/client.ts` | 23 | Drizzle client: Neon, or pg on localhost | Reviewed | Moved from lib/db/ |
| `src/server/db/repo.ts` | 286 | Session-scoped repository: drafts and messages | Reviewed | Moved from lib/db/; insert results checked. Later: session functions moved to sessions.ts |
| `src/server/db/schema.ts` | 70 | Tables | Reviewed | Moved from lib/db/ |
| `src/server/db/sessions.ts` | 49 | Sessions: create, find and refresh, find by id for signed links, usage counters | Reviewed | Later: split from repo.ts (320 lines after formatting) |
| `src/server/diff/align-blocks.ts` | 81 | Pairs template and draft blocks | Reviewed | Split from lib/diff.ts; uses lcs.ts |
| `src/server/diff/change-notes.ts` | 71 | Formatting and structure notes | Reviewed | Split from lib/diff.ts |
| `src/server/diff/compare-blocks.ts` | 179 | The comparison result | Reviewed | Split from lib/diff.ts |
| `src/server/diff/lcs.ts` | 34 | Shared longest-common-subsequence alignment | Reviewed | New: replaces two copies (same output on 8,000 inputs) |
| `src/server/diff/token-diff.ts` | 32 | Word-level diff | Reviewed | Split from lib/diff.ts; uses lcs.ts |
| `src/server/documents/access.ts` | 36 | Owned loading; cached template blocks | Reviewed | Split from lib/server/service.ts; cache read validated |
| `src/server/documents/answers.ts` | 185 | Corrections, chat turn, chat language, clause actions | Reviewed | Split from lib/server/service.ts. Later: a failed reply says the answers were saved |
| `src/server/documents/comparison.ts` | 38 | Comparison use case | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/drafting.ts` | 75 | Generation; reading and saving the editor's DOCX; the export file name | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/word-link.ts` | 37 | Signed five-minute links to a saved draft, for Word | Reviewed | New |
| `src/server/documents/drafts.ts` | 69 | List, rename, delete, copy | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/upload.ts` | 72 | A new draft from an upload | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/views.ts` | 78 | The draft view sent to the browser | Reviewed | Split from lib/server/service.ts |
| `src/server/docx/blocks.ts` | 75 | Block types, cached-block schema, size check | Reviewed | Split from lib/docx/ooxml.ts; schema added |
| `src/server/docx/clause-references.ts` | 91 | Clause references kept in line with numbering | Reviewed | Split from lib/docx/structure.ts |
| `src/server/docx/clause-structure.ts` | 172 | Cut and restore whole clauses | Reviewed | Moved from lib/docx/structure.ts |
| `src/server/docx/detect.ts` | 179 | Marker and placeholder-box detection | Reviewed | Moved from lib/docx/. Later: `humanize` exported for labels |
| `src/server/docx/edit.ts` | 82 | Run-aware text edits; filled boxes committed | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/package.ts` | 130 | Package validation, limits, hashing | Reviewed | Moved from lib/docx/; hash via node:crypto (same output) |
| `src/server/docx/para-ids.ts` | 60 | Stable w14:paraIds | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/paragraph-text.ts` | 135 | Paragraph text mapped to runs; placeholder boxes | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/render.ts` | 139 | The walk that fills and renders blocks | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/styles.ts` | 141 | Styles, heading levels, list numbering | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/xml.ts` | 54 | Namespaces and DOM helpers | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/draft/generate.ts` | 112 | Draft generation | Reviewed | Split from lib/draft.ts |
| `src/server/draft/update.ts` | 162 | Updating an edited draft for new answers and clauses | Reviewed | Moved from lib/draft.ts |
| `src/server/env.ts` | 61 | Environment validation | Reviewed | Moved from lib/server/. Later: `AI_PROVIDER`, `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL` |
| `src/server/fields/build-fields.ts` | 233 | Fields from markers and the analysis | Reviewed | Split from lib/fields/build.ts. Later: labels copied from markers are made readable; a `{{variable}}` or ALL-CAPS `[PLACEHOLDER]` cannot be dismissed by the model |
| `src/server/fields/draft-edits.ts` | 98 | Draft anchors and anchored updates | Reviewed | Split from lib/fields/build.ts |
| `src/server/fields/lang.ts` | 186 | Language detection and per-language rendering | Reviewed | Moved from lib/fields/ |
| `src/server/fields/normalize.ts` | 219 | Dates, amounts, yes/no validation | Reviewed | Moved from lib/fields/ |
| `src/server/fields/state.ts` | 70 | Persisted field state (JSONB schema) | Reviewed | Split from lib/fields/types.ts |
| `src/server/fields/template-analysis.ts` | 65 | Schema the analysis must satisfy | Reviewed | Split from lib/fields/build.ts |
| `src/server/http/responses.ts` | 65 | Private JSON responses, error mapping, id parameter | Reviewed | Moved from lib/server/http.ts; typed errors replace message regexes |
| `src/server/http/sse.ts` | 43 | SSE response with request id and sequence | Reviewed | Split from lib/server/http.ts and lib/events.ts |
| `src/server/session.ts` | 101 | Anonymous sessions, origin check | Reviewed | Moved from lib/server/. Later: the cookie is Secure only over HTTPS (Safari) |
| `src/shared/ui/BrandMark.tsx` | 11 | Product mark | Reviewed | Split from components/ui.tsx |
| `src/shared/ui/Button.tsx` | 56 | Button, IconButton | Reviewed | Split from components/ui.tsx |
| `src/shared/ui/ConfirmDialog.tsx` | 68 | Themed confirmation dialog | Reviewed | Split from components/ui.tsx |
| `src/shared/ui/Popover.tsx` | 115 | Top-layer popover and menu item | Reviewed | Split from components/ui.tsx; assertion removed |
| `src/shared/ui/Status.tsx` | 64 | Status badge, callout, skeleton, count | Reviewed | Split from components/ui.tsx |
| `src/shared/ui/TabBar.tsx` | 96 | Segmented tabs | Reviewed | Split from components/ui.tsx; assertions removed |
| `src/shared/ui/TabPanel.tsx` | 33 | Tab panel that stays mounted | Reviewed | Split from components/Workspace.tsx |
| `src/shared/ui/ThemeControl.tsx` | 54 | Light / Dark / System control; theme sync | Reviewed | Moved from components/ |
| `tests/e2e/bonuses.spec.ts` | 192 | Integrated scenario with live Gemini (opt-in) | Reviewed | Kept |
| `tests/e2e/chat.spec.ts` | 101 | Chat surface with a stubbed stream | Reviewed | Kept |
| `tests/e2e/controls.spec.ts` | 105 | Placeholder boxes end to end | Reviewed | Kept |
| `tests/e2e/drafts.spec.ts` | 196 | Saved drafts, second tab, draft switching, lost session | Reviewed | New characterization tests |
| `tests/e2e/flow.spec.ts` | 218 | Core flow, fidelity, responsive widths | Reviewed | Kept. Later: the fitted phone page: no sideways scroll, a tap edits |
| `tests/e2e/theme.spec.ts` | 120 | Themes | Reviewed | Kept |
| `tests/e2e/word-exports.spec.ts` | 114 | Every fixture answered, generated and round-tripped, saved for the Word check | Reviewed | Later: new |
| `tests/helpers.ts` | 102 | Model and store test doubles | Reviewed | Kept (imports updated). Later: a failing reply stream |
| `tests/integration/bonuses.test.ts` | 466 | Bonus workflows on PostgreSQL | Reviewed | Kept (imports updated) |
| `tests/integration/workflow.test.ts` | 417 | Core workflow on PostgreSQL | Reviewed | Kept (imports updated). Later: a failed reply keeps its answers |
| `tests/server-only-stub.ts` | 1 | Lets tests import server modules | Reviewed | Kept |
| `tests/smoke/http-smoke.mjs` | 181 | HTTP checks against a running build | Reviewed | Kept |
| `tests/unit/ai-fallback.test.ts` | 137 | Gemini to gateway fallback and gateway errors | Reviewed | New |
| `tests/unit/bonuses.test.ts` | 435 | Bonus logic | Reviewed | Kept (imports updated) |
| `tests/unit/docx-core.test.ts` | 335 | DOCX engine | Reviewed | Kept (imports updated). Later: rich-template preservation, readable labels |
| `tests/unit/interview.test.ts` | 101 | Interview prompts | Reviewed | Kept (imports updated). Later: messy answers from the live evaluation |
| `tests/unit/normalize-events.test.ts` | 71 | Validation and SSE decoding | Reviewed | Kept; malformed-frame case added |
| `tests/unit/save-coordinator.test.ts` | 91 | Save coordinator | Reviewed | New |
| `tests/unit/ui.test.ts` | 29 | Reply formatting, theme resolution | Reviewed | Kept (imports updated) |
| `tests/unit/workspace-status.test.ts` | 122 | Workspace status rules | Reviewed | New |
| `tsconfig.json` | 47 | Strict TypeScript, @/ alias | Reviewed | Reviewed, unchanged |
| `vitest.config.ts` | 8 | Unit and integration test configuration | Reviewed | Reviewed, unchanged |

Binary assets, reviewed:

- `docs/screenshots/` (21 files): Screenshots referenced by the README and `docs/DETAILS.md`; the two `word-*.png` added later
- `fixtures/` (7 files): Synthetic .docx templates used by tests; `synthetic-supply-agreement.docx` added later for the Word check
- `public/examples/` (5 files): The same templates, offered as examples on the upload screen

## Removed or replaced

| Before | Lines | Now in |
| --- | ---: | --- |
| `src/components/Workspace.tsx` | 632 | features/workspace/*, chat/use-chat-turn.ts, documents/use-draft-generation.ts, shared/ui/TabPanel.tsx |
| `src/lib/docx/ooxml.ts` | 596 | server/docx/{xml, blocks, paragraph-text, styles, edit, render, para-ids}.ts |
| `src/lib/server/service.ts` | 495 | server/documents/{access, views, upload, answers, drafting, comparison, drafts}.ts |
| `src/components/ChatPanel.tsx` | 347 | features/chat/components/{ChatPanel, ChatHeader, Composer, Message}.tsx |
| `src/lib/diff.ts` | 346 | server/diff/{token-diff, align-blocks, change-notes, compare-blocks, lcs}.ts; features/comparison/contracts.ts |
| `src/lib/fields/build.ts` | 329 | server/fields/{template-analysis, build-fields, draft-edits}.ts |
| `src/lib/fields/rules.ts` | 314 | server/clauses/{condition-markers, proposals, evaluation}.ts |
| `src/components/ui.tsx` | 306 | shared/ui/{Button, Status, BrandMark, TabBar, Popover, ConfirmDialog}.tsx |
| `src/components/ComparePanel.tsx` | 259 | features/comparison/ (panel, DiffText, query) |
| `src/lib/docx/structure.ts` | 249 | server/docx/{clause-structure, clause-references}.ts |
| `src/lib/ai/interview.ts` | 243 | server/ai/{extraction, reply, interview-messages}.ts |
| `src/lib/draft.ts` | 238 | server/draft/{generate, update}.ts |
| `src/components/UploadPanel.tsx` | 234 | features/documents/components/UploadPanel.tsx |
| `src/components/DraftsDrawer.tsx` | 221 | features/drafts/ (drawer, row, queries) |
| `src/components/SuperDocEditor.tsx` | 206 | features/documents/editor/{SuperDocEditor.tsx, save-coordinator.ts} |
| `src/components/ClausePanel.tsx` | 203 | features/clauses/ (panel, card, decision, status) |
| `src/components/FieldPanel.tsx` | 173 | features/documents/components/{FieldPanel, FieldRow}.tsx |
| `src/lib/fields/types.ts` | 156 | features/documents/contracts/fields.ts, server/fields/state.ts |
| `src/components/WorkspaceHeader.tsx` | 149 | features/workspace/components/WorkspaceHeader.tsx |
| `src/components/DraftPreview.tsx` | 111 | features/documents/components/DraftPreview.tsx |
| `src/lib/client/api.ts` | 83 | features/*/api.ts, lib/http.ts, lib/sse.ts |
| `src/lib/server/http.ts` | 80 | server/http/{responses, sse}.ts |
| `src/lib/events.ts` | 74 | features/documents/contracts/stream-events.ts, lib/sse.ts, server/http/sse.ts |
| `src/lib/client/theme.ts` | 78 | lib/theme.ts |
| `src/lib/client/format.ts` | 52 | features/chat/format.ts |
| `src/components/ThemeControl.tsx` | 50 | shared/ui/ThemeControl.tsx |
| `src/lib/ai/{analyze, model}.ts, src/lib/cache/redis.ts, src/lib/db/*, src/lib/docx/{detect, package}.ts, src/lib/fields/{lang, normalize}.ts, src/lib/server/{env, session}.ts` |  | Same names under src/server/ |
