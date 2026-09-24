# File audit

Every first-party file, reviewed for the September 2026 refactor (see [ARCHITECTURE.md](ARCHITECTURE.md)). Line counts are physical lines when this record was written; the baseline is commit `fd4b280`.

## Current files

| File | Lines | Responsibility | Review | Decision |
| --- | ---: | --- | --- | --- |
| `.env.example` | 30 | Documented environment variables | Reviewed | Reviewed, unchanged |
| `.gitignore` | 14 | Ignored files | Reviewed | Reviewed, unchanged |
| `AGENTS.md` | 9 | Agent notes written by next dev | Reviewed | Reviewed, unchanged |
| `CLAUDE.md` | 1 | Points to AGENTS.md | Reviewed | Reviewed, unchanged |
| `README.md` | 446 | Setup, architecture, behaviour, verification | Reviewed | Updated (layout, commands, test counts) |
| `REQUIREMENTS.md` | 70 | Requirement-to-code traceability | Reviewed | Updated (paths; B16 now browser-tested) |
| `WALKTHROUGH.md` | 49 | Demo script | Reviewed | Reviewed, unchanged |
| `docs/ADR-001-document-engine.md` | 26 | Decision: document engine | Reviewed | Reviewed, unchanged |
| `docs/ADR-002-bonuses.md` | 35 | Decision: bonus features | Reviewed | Reviewed, unchanged |
| `docs/ARCHITECTURE.md` | 165 | Layout, rules, state ownership, refactor note | Reviewed | New |
| `docs/AUDIT.md` | 213 | This record | Reviewed | New |
| `drizzle.config.ts` | 9 | Drizzle Kit configuration | Reviewed | Schema path updated |
| `drizzle/0000_init.sql` | 40 | Initial migration | Reviewed | Unchanged (no migration needed) |
| `drizzle/0001_drafts_retention.sql` | 8 | Retention columns migration | Reviewed | Unchanged |
| `drizzle/meta/0000_snapshot.json` | 308 | Drizzle snapshot | Reviewed | Unchanged |
| `drizzle/meta/0001_snapshot.json` | 351 | Drizzle snapshot | Reviewed | Unchanged |
| `drizzle/meta/_journal.json` | 20 | Drizzle journal | Reviewed | Unchanged |
| `eslint.config.mjs` | 30 | Lint: Next rules, layer rules, assertion bans | Reviewed | Updated |
| `eslint.cycles.config.mjs` | 5 | Import-cycle check (npm run check:cycles) | Reviewed | New |
| `next.config.ts` | 22 | Security headers, CSP, server packages | Reviewed | Reviewed, unchanged |
| `package-lock.json` | 11511 | Locked dependency tree | Reviewed | Updated with package.json |
| `package.json` | 64 | Scripts and dependencies | Reviewed | TanStack Query added; pg made a runtime dependency; check:cycles |
| `playwright.config.ts` | 19 | Browser test configuration | Reviewed | Reviewed, unchanged |
| `postcss.config.mjs` | 2 | Tailwind v4 PostCSS plugin | Reviewed | Reviewed, unchanged |
| `scripts/cleanup.ts` | 35 | Retention cleanup (cron) | Reviewed | Kept; uses the shared cache key |
| `scripts/gemini-smoke.ts` | 35 | One live model check | Reviewed | Kept; thinking level validated |
| `scripts/make-fixtures.ts` | 421 | Generates the synthetic templates | Reviewed | Kept whole: test tooling, exception to the size rule |
| `src/app/api/documents/[id]/chat/route.ts` | 27 | POST: one chat turn as SSE | Reviewed | Kept thin; ownership checked before streaming |
| `src/app/api/documents/[id]/compare/route.ts` | 23 | POST: template-to-draft comparison | Reviewed | Kept thin |
| `src/app/api/documents/[id]/copy/route.ts` | 20 | POST: save a copy (with the editor's content) | Reviewed | Kept thin |
| `src/app/api/documents/[id]/docx/route.ts` | 37 | GET/PUT: the editor's working DOCX (revision-checked) | Reviewed | Kept thin |
| `src/app/api/documents/[id]/download/route.ts` | 26 | GET: export the working draft | Reviewed | Kept thin |
| `src/app/api/documents/[id]/draft/route.ts` | 23 | POST: generate the draft as SSE | Reviewed | Kept thin; ownership checked before streaming |
| `src/app/api/documents/[id]/fields/route.ts` | 19 | PATCH: correct one field | Reviewed | Kept thin |
| `src/app/api/documents/[id]/route.ts` | 50 | GET resume; PATCH rename or chat language; DELETE | Reviewed | Kept thin; bodies parsed with contract schemas |
| `src/app/api/documents/[id]/rules/route.ts` | 19 | POST: a clause decision | Reviewed | Kept thin |
| `src/app/api/documents/current/route.ts` | 15 | GET: the browser's latest draft | Reviewed | Kept |
| `src/app/api/documents/route.ts` | 26 | POST: upload a template | Reviewed | Kept thin: session, origin, then the upload use case |
| `src/app/api/drafts/route.ts` | 15 | GET: saved drafts of this browser | Reviewed | Kept |
| `src/app/globals.css` | 418 | Theme tokens, Tailwind v4 layers, motion, SuperDoc chrome | Reviewed | Kept (one comment path updated) |
| `src/app/layout.tsx` | 42 | Root layout: fonts, theme set before paint, query provider | Reviewed | Kept; wraps the page in the query provider |
| `src/app/page.tsx` | 6 | Server page: passes the upload limit to the workspace | Reviewed | Kept; renders the workspace feature |
| `src/app/providers.tsx` | 9 | TanStack Query provider (one client per tab) | Reviewed | New |
| `src/features/chat/api.ts` | 12 | Chat turn stream and chat-language call | Reviewed | New (from lib/client/api.ts) |
| `src/features/chat/components/ChatHeader.tsx` | 77 | Chat language and what is still needed | Reviewed | Split from components/ChatPanel.tsx |
| `src/features/chat/components/ChatPanel.tsx` | 96 | Conversation layout: scrolling, Jump to latest, failure | Reviewed | Moved from components/ (was 347 lines, split in four) |
| `src/features/chat/components/Composer.tsx` | 85 | Message box: send, stop, keyboard | Reviewed | Split from components/ChatPanel.tsx |
| `src/features/chat/components/Message.tsx` | 104 | One message: formatting, streaming caret, details updated | Reviewed | Split from components/ChatPanel.tsx |
| `src/features/chat/format.ts` | 39 | Reply formatting: paragraphs, lists, bold | Reviewed | Moved from lib/client/; rewritten without assertions (same output on 20,000 replies) |
| `src/features/chat/use-chat-turn.ts` | 132 | A turn's stream, the conversation list, chat language | Reviewed | Split from components/Workspace.tsx |
| `src/features/clauses/clause-status.ts` | 13 | Which clauses need attention, are shown, and their order | Reviewed | Split from components/ClausePanel.tsx |
| `src/features/clauses/components/ClauseDecision.tsx` | 51 | The answer an undecided clause waits for | Reviewed | Split from components/ClausePanel.tsx |
| `src/features/clauses/components/ClausePanel.tsx` | 56 | Clauses with their status, and structure issues | Reviewed | Moved from components/ (was 203 lines, split in three) |
| `src/features/clauses/components/RuleCard.tsx` | 105 | One clause and its actions | Reviewed | Split from components/ClausePanel.tsx |
| `src/features/comparison/api.ts` | 5 | Comparison call with the editor snapshot | Reviewed | New (from lib/client/api.ts) |
| `src/features/comparison/components/ComparePanel.tsx` | 208 | Comparison view: summary, step through changes | Reviewed | Moved from components/; data through useComparison instead of an effect and a nonce |
| `src/features/comparison/components/DiffText.tsx` | 40 | Highlighted word diff | Reviewed | Split from components/ComparePanel.tsx |
| `src/features/comparison/contracts.ts` | 35 | Diff result schema | Reviewed | New (was a TS type in lib/diff.ts) |
| `src/features/comparison/queries.ts` | 18 | useComparison: keyed by revision, never cached | Reviewed | New |
| `src/features/documents/api.ts` | 43 | Draft endpoints, every response validated | Reviewed | New (from lib/client/api.ts) |
| `src/features/documents/components/DraftPreview.tsx` | 117 | Preview that grows as the draft streams | Reviewed | Moved from components/; table grouping rewritten without assertions |
| `src/features/documents/components/FieldPanel.tsx` | 66 | Details grouped, with progress | Reviewed | Moved from components/ (was 173 lines, split in two) |
| `src/features/documents/components/FieldRow.tsx` | 106 | One detail: edit, dismiss, where it appears | Reviewed | Split from components/FieldPanel.tsx; saves through a mutation |
| `src/features/documents/components/UploadPanel.tsx` | 236 | Upload screen and examples | Reviewed | Moved from components/; assertions removed |
| `src/features/documents/contracts/document-view.ts` | 68 | Draft view, clause state, messages (zod) | Reviewed | New (DTOs from lib/server/service.ts) |
| `src/features/documents/contracts/fields.ts` | 91 | Field model (zod) | Reviewed | Moved from lib/fields/types.ts (persisted state moved to server/fields/state.ts) |
| `src/features/documents/contracts/requests.ts` | 31 | Request bodies (zod) | Reviewed | New (schemas that lived in routes) |
| `src/features/documents/contracts/stream-events.ts` | 46 | SSE events (zod) | Reviewed | Moved from lib/events.ts (encoder and decoder moved out) |
| `src/features/documents/editor/SuperDocEditor.tsx` | 177 | SuperDoc wrapper: load, flush, snapshot | Reviewed | Moved from components/; saving delegated to the save coordinator |
| `src/features/documents/editor/save-coordinator.ts` | 89 | Debounced, one-at-a-time autosave with conflict state | Reviewed | New (extracted from SuperDocEditor.tsx); unit-tested |
| `src/features/documents/progress.ts` | 31 | What is still needed (the one definition) | Reviewed | New (merged three copies) |
| `src/features/documents/queries.ts` | 77 | Draft keys, queries, cache writes, field and clause mutations | Reviewed | New |
| `src/features/documents/use-draft-generation.ts` | 60 | Generation stream and preview blocks | Reviewed | Split from components/Workspace.tsx |
| `src/features/drafts/api.ts` | 9 | List, rename, delete calls | Reviewed | New (from lib/client/api.ts) |
| `src/features/drafts/components/DraftRow.tsx` | 128 | One saved draft: open, inline rename, menu | Reviewed | Split from components/DraftsDrawer.tsx |
| `src/features/drafts/components/DraftsDrawer.tsx` | 131 | Saved drafts dialog | Reviewed | Moved from components/; list and actions through queries and mutations |
| `src/features/drafts/contracts.ts` | 23 | Drafts list schemas | Reviewed | New (DTOs from lib/server/service.ts) |
| `src/features/drafts/queries.ts` | 37 | Drafts list query, rename and delete mutations | Reviewed | New |
| `src/features/workspace/components/AssistantPane.tsx` | 76 | Chat, Details and Clauses tabs | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/components/DocumentPane.tsx` | 90 | Document and Compare tabs; editor or preview | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/components/DocumentWorkspace.tsx` | 225 | One open draft: composes chat, generation, editor, download | Reviewed | Split from components/Workspace.tsx; mounted per draft |
| `src/features/workspace/components/ViewSwitcher.tsx` | 37 | One region at a time on narrow screens | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/components/Workspace.tsx` | 94 | Page shell: start-up, upload, open draft, drawer, session loss | Reviewed | Replaces components/Workspace.tsx (632 lines) |
| `src/features/workspace/components/WorkspaceHeader.tsx` | 150 | Title, status, steps, actions | Reviewed | Moved from components/ |
| `src/features/workspace/components/WorkspaceNotices.tsx` | 106 | Save and export banners; next-step bar | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/use-download.ts` | 52 | Export: save first, confirm open issues, download | Reviewed | Split from components/Workspace.tsx |
| `src/features/workspace/use-session-loss.ts` | 26 | Notices a 401 from any query or mutation | Reviewed | New |
| `src/features/workspace/workspace-status.ts` | 72 | Progress, status line, export warnings | Reviewed | Split from components/Workspace.tsx; unit-tested |
| `src/lib/http.ts` | 61 | Validated fetch, ApiError, retry classification | Reviewed | New (replaces parse<T> with as T) |
| `src/lib/query-client.ts` | 25 | Query client defaults (retries) | Reviewed | New |
| `src/lib/sse.ts` | 60 | SSE decoder and POST event stream | Reviewed | New (decoder from lib/events.ts) |
| `src/lib/theme.ts` | 78 | Theme preference; script run before paint | Reviewed | Moved from lib/client/ |
| `src/server/ai/analyze.ts` | 83 | Template analysis: cached, one repair attempt | Reviewed | Moved from lib/ai/ |
| `src/server/ai/extraction.ts` | 150 | Chat stage 1: validated extraction | Reviewed | Split from lib/ai/interview.ts; assertion removed |
| `src/server/ai/interview-messages.ts` | 42 | Opening and language-switch messages (no model call) | Reviewed | Split from lib/ai/interview.ts |
| `src/server/ai/model.ts` | 97 | Gemini model, budgets, usage, AI errors | Reviewed | Moved from lib/ai/ |
| `src/server/ai/reply.ts` | 71 | Chat stage 2: the streamed reply | Reviewed | Split from lib/ai/interview.ts |
| `src/server/cache/redis.ts` | 153 | Cache, locks, rate limits, fallback policy | Reviewed | Moved from lib/cache/; typed ProtectionUnavailableError |
| `src/server/clauses/condition-markers.ts` | 175 | [[IF …]] marker grammar | Reviewed | Split from lib/fields/rules.ts |
| `src/server/clauses/evaluation.ts` | 78 | Deterministic clause evaluation, inactive fields | Reviewed | Split from lib/fields/rules.ts |
| `src/server/clauses/proposals.ts` | 75 | Validation of clauses the model proposes | Reviewed | Split from lib/fields/rules.ts |
| `src/server/db/client.ts` | 23 | Drizzle client: Neon, or pg on localhost | Reviewed | Moved from lib/db/ |
| `src/server/db/repo.ts` | 227 | Session-scoped repository | Reviewed | Moved from lib/db/; insert results checked |
| `src/server/db/schema.ts` | 62 | Tables | Reviewed | Moved from lib/db/ |
| `src/server/diff/align-blocks.ts` | 81 | Pairs template and draft blocks | Reviewed | Split from lib/diff.ts; uses lcs.ts |
| `src/server/diff/change-notes.ts` | 71 | Formatting and structure notes | Reviewed | Split from lib/diff.ts |
| `src/server/diff/compare-blocks.ts` | 142 | The comparison result | Reviewed | Split from lib/diff.ts |
| `src/server/diff/lcs.ts` | 34 | Shared longest-common-subsequence alignment | Reviewed | New: replaces two copies (same output on 8,000 inputs) |
| `src/server/diff/token-diff.ts` | 24 | Word-level diff | Reviewed | Split from lib/diff.ts; uses lcs.ts |
| `src/server/documents/access.ts` | 36 | Owned loading; cached template blocks | Reviewed | Split from lib/server/service.ts; cache read validated |
| `src/server/documents/answers.ts` | 147 | Corrections, chat turn, chat language, clause actions | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/comparison.ts` | 38 | Comparison use case | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/drafting.ts` | 56 | Generation; reading and saving the editor's DOCX | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/drafts.ts` | 69 | List, rename, delete, copy | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/upload.ts` | 64 | A new draft from an upload | Reviewed | Split from lib/server/service.ts |
| `src/server/documents/views.ts` | 74 | The draft view sent to the browser | Reviewed | Split from lib/server/service.ts |
| `src/server/docx/blocks.ts` | 70 | Block types, cached-block schema, size check | Reviewed | Split from lib/docx/ooxml.ts; schema added |
| `src/server/docx/clause-references.ts` | 91 | Clause references kept in line with numbering | Reviewed | Split from lib/docx/structure.ts |
| `src/server/docx/clause-structure.ts` | 171 | Cut and restore whole clauses | Reviewed | Moved from lib/docx/structure.ts |
| `src/server/docx/detect.ts` | 111 | Marker and placeholder-box detection | Reviewed | Moved from lib/docx/ |
| `src/server/docx/edit.ts` | 75 | Run-aware text edits; filled boxes committed | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/package.ts` | 135 | Package validation, limits, hashing | Reviewed | Moved from lib/docx/; hash via node:crypto (same output) |
| `src/server/docx/para-ids.ts` | 60 | Stable w14:paraIds | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/paragraph-text.ts` | 118 | Paragraph text mapped to runs; placeholder boxes | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/render.ts` | 139 | The walk that fills and renders blocks | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/styles.ts` | 119 | Styles, heading levels, list numbering | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/docx/xml.ts` | 50 | Namespaces and DOM helpers | Reviewed | Split from lib/docx/ooxml.ts |
| `src/server/draft/generate.ts` | 103 | Draft generation | Reviewed | Split from lib/draft.ts |
| `src/server/draft/update.ts` | 142 | Updating an edited draft for new answers and clauses | Reviewed | Moved from lib/draft.ts |
| `src/server/env.ts` | 50 | Environment validation | Reviewed | Moved from lib/server/ |
| `src/server/fields/build-fields.ts` | 196 | Fields from markers and the analysis | Reviewed | Split from lib/fields/build.ts |
| `src/server/fields/draft-edits.ts` | 98 | Draft anchors and anchored updates | Reviewed | Split from lib/fields/build.ts |
| `src/server/fields/lang.ts` | 176 | Language detection and per-language rendering | Reviewed | Moved from lib/fields/ |
| `src/server/fields/normalize.ts` | 172 | Dates, amounts, yes/no validation | Reviewed | Moved from lib/fields/ |
| `src/server/fields/state.ts` | 70 | Persisted field state (JSONB schema) | Reviewed | Split from lib/fields/types.ts |
| `src/server/fields/template-analysis.ts` | 48 | Schema the analysis must satisfy | Reviewed | Split from lib/fields/build.ts |
| `src/server/http/responses.ts` | 60 | Private JSON responses, error mapping, id parameter | Reviewed | Moved from lib/server/http.ts; typed errors replace message regexes |
| `src/server/http/sse.ts` | 43 | SSE response with request id and sequence | Reviewed | Split from lib/server/http.ts and lib/events.ts |
| `src/server/session.ts` | 100 | Anonymous sessions, origin check | Reviewed | Moved from lib/server/ |
| `src/shared/ui/BrandMark.tsx` | 8 | Product mark | Reviewed | Split from components/ui.tsx |
| `src/shared/ui/Button.tsx` | 51 | Button, IconButton | Reviewed | Split from components/ui.tsx |
| `src/shared/ui/ConfirmDialog.tsx` | 57 | Themed confirmation dialog | Reviewed | Split from components/ui.tsx |
| `src/shared/ui/Popover.tsx` | 75 | Top-layer popover and menu item | Reviewed | Split from components/ui.tsx; assertion removed |
| `src/shared/ui/Status.tsx` | 43 | Status badge, callout, skeleton, count | Reviewed | Split from components/ui.tsx |
| `src/shared/ui/TabBar.tsx` | 75 | Segmented tabs | Reviewed | Split from components/ui.tsx; assertions removed |
| `src/shared/ui/TabPanel.tsx` | 14 | Tab panel that stays mounted | Reviewed | Split from components/Workspace.tsx |
| `src/shared/ui/ThemeControl.tsx` | 50 | Light / Dark / System control; theme sync | Reviewed | Moved from components/ |
| `tests/e2e/bonuses.spec.ts` | 176 | Integrated scenario with live Gemini (opt-in) | Reviewed | Kept |
| `tests/e2e/chat.spec.ts` | 96 | Chat surface with a stubbed stream | Reviewed | Kept |
| `tests/e2e/controls.spec.ts` | 85 | Placeholder boxes end to end | Reviewed | Kept |
| `tests/e2e/drafts.spec.ts` | 178 | Saved drafts, second tab, draft switching, lost session | Reviewed | New characterization tests |
| `tests/e2e/flow.spec.ts` | 181 | Core flow, fidelity, responsive widths | Reviewed | Kept |
| `tests/e2e/theme.spec.ts` | 81 | Themes | Reviewed | Kept |
| `tests/helpers.ts` | 91 | Model and store test doubles | Reviewed | Kept (imports updated) |
| `tests/integration/bonuses.test.ts` | 356 | Bonus workflows on PostgreSQL | Reviewed | Kept (imports updated) |
| `tests/integration/workflow.test.ts` | 298 | Core workflow on PostgreSQL | Reviewed | Kept (imports updated) |
| `tests/server-only-stub.ts` | 1 | Lets tests import server modules | Reviewed | Kept |
| `tests/smoke/http-smoke.mjs` | 89 | HTTP checks against a running build | Reviewed | Kept |
| `tests/unit/bonuses.test.ts` | 284 | Bonus logic | Reviewed | Kept (imports updated) |
| `tests/unit/docx-core.test.ts` | 239 | DOCX engine | Reviewed | Kept (imports updated) |
| `tests/unit/interview.test.ts` | 50 | Interview prompts | Reviewed | Kept (imports updated) |
| `tests/unit/normalize-events.test.ts` | 67 | Validation and SSE decoding | Reviewed | Kept; malformed-frame case added |
| `tests/unit/save-coordinator.test.ts` | 91 | Save coordinator | Reviewed | New |
| `tests/unit/ui.test.ts` | 29 | Reply formatting, theme resolution | Reviewed | Kept (imports updated) |
| `tests/unit/workspace-status.test.ts` | 107 | Workspace status rules | Reviewed | New |
| `tsconfig.json` | 47 | Strict TypeScript, @/ alias | Reviewed | Reviewed, unchanged |
| `vitest.config.ts` | 8 | Unit and integration test configuration | Reviewed | Reviewed, unchanged |

Binary assets, reviewed and unchanged:

- `docs/screenshots/` (19 files): Screenshots referenced by the README
- `fixtures/` (6 files): Synthetic .docx templates used by tests
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
