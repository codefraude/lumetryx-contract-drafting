# Architecture

How the code is organised, which rules keep it that way, and what the September 2026 refactor changed. The per-file record of that refactor is in [AUDIT.md](AUDIT.md).

## Layout

```
src/app/             Next.js App Router: the page, root layout, query provider, and thin API route handlers
src/features/        Browser features. Each one owns its components, hooks, API calls and query keys.
  documents/         The core: zod contracts, progress rules, API + queries, editor + save coordinator,
                     upload, details, streamed preview, draft generation
  chat/              The conversation: turn streaming, messages, composer, header
  clauses/           Conditional clauses: panel, cards, attention rules
  comparison/        Template-to-draft comparison: query and panel
  drafts/            Saved drafts: list query, rename and delete, drawer
  workspace/         Composition root: page shell, one open draft, status, notices, download, session loss
src/shared/ui/       Design-system primitives (Button, Status, TabBar, TabPanel, Popover, ConfirmDialog, ThemeControl, BrandMark)
src/lib/             Framework-free browser helpers: validated HTTP, SSE client, query client, theme
src/server/          Server only: documents (use cases), docx, fields, clauses, diff, draft, ai, db, cache, http, session, env
scripts/             Not shipped: test fixtures (fixtures/), the Microsoft Word check (word/), the live conversation
                     evaluation, the Gemini smoke test, expired-draft cleanup
```

A request goes: route handler (session, origin and ownership checks, body parsed with a contract schema) → a use case in `src/server/documents/` → domain modules (`docx`, `fields`, `clauses`, `draft`, `diff`, `ai`) → `db` / `cache`. Document code never calls the model. Model code never touches XML; it proposes values that deterministic validation accepts or rejects.

## Dependency rules

Enforced by `npm run lint` (`no-restricted-imports` in `eslint.config.mjs`):

- `features`, `shared` and `lib` never import `@/server/*`. The client bundle holds no server code (checked by grepping `.next/static`).
- A feature imports other features only from `documents`, the core. `workspace` is the one place that composes features.
- `shared/ui` imports no feature. `lib` imports neither features nor `shared`.
- The server never imports browser code. From `features` it may import only contracts and `documents/progress.ts`.
- Contracts import only zod and other contracts.
- There are no barrel files (`index.ts`) and no `utils.ts`. Imports name the module that owns the code.
- There are no import cycles (`npm run check:cycles`). This check is separate from lint because resolving every import takes about two minutes.

## Contracts

- zod schemas in `features/*/contracts*` define every request body, response and SSE event. Types are inferred from them.
- Every trust boundary validates:
  - route handlers parse request bodies;
  - the browser validates every JSON response (`requestJson`) and every SSE frame (`SseDecoder`);
  - cache reads from Redis are parsed (template analyses, parsed blocks), and a bad entry is treated as a miss;
  - JSONB field state is parsed when a draft is read.
- Production code has no `any`, no `as T` (`as const` is allowed), no non-null `!` and no double assertions. Lint enforces all four.

## State ownership

| State | Owner |
| --- | --- |
| Server data: draft view, id of the latest draft, drafts list, comparison | TanStack Query, with keys owned by each feature |
| Content typed in the editor and not yet saved | SuperDoc, plus the save coordinator (`features/documents/editor/`) |
| A reply or preview as it streams | `useChatTurn`, `useDraftGeneration` |
| The conversation list | `useChatTurn`, started once from the draft's persisted messages |
| Which draft is open, views, panes, drawer, dialogs | Component state |
| Theme | `localStorage` plus `<html data-theme>` (`lib/theme.ts`), set before the first paint |

## Server data (TanStack Query)

**Keys**

| Key | What it holds | Owned by |
| --- | --- | --- |
| `["documents", "detail", id]` | One draft's view | `features/documents/queries.ts` |
| `["documents", "current"]` | Only the id of the latest draft; its view is stored under that draft's own key | `features/documents/queries.ts` |
| `["drafts", "list"]` | The saved-drafts list | `features/drafts/queries.ts` |
| `["comparison", id, revisionKey]` | One comparison | `features/comparison/queries.ts` |

**Draft view.** `staleTime: Infinity`, with no refetch on focus. It changes only at defined points:
- a write returns the new view, which is stored with `setQueryData`;
- a streamed event patches the entry of the draft that sent it;
- the end of a stream invalidates that draft.

This tab is the writer. Revision checks on the server catch other tabs.

**Drafts list and comparison.**
- The drafts list uses `staleTime: 0` and is fetched when the drawer opens. Rename and delete update it from their responses. An upload removes it, because an upload can start a new browser session.
- The comparison uses `staleTime: 0`, `gcTime: 0` and `retry: false`. It is keyed by the editor's revision and the answers' version.

**Retries and cancellation.**
- Queries retry only transient failures (network errors, or server errors marked retryable), and at most twice.
- Mutations never retry by themselves.
- Every query function passes on its `AbortSignal`.

**Saving.**
- Edits are saved 1.5 s after the last change, and at least every 10 s during continuous typing.
- One save runs at a time, based on the revision the server last returned.
- A stale save becomes a conflict: the edits stay in the editor, and the lawyer chooses to load the newer version or save theirs as a new draft.

**Reconciliation.**
- When the server writes a new revision (a chat answer patching the draft, a clause action, generation), the workspace changes `editorKey` and the editor reloads that revision.
- The editor's own saves only update `workingRevision` and `savedAt` in the cache, without a reload.

**Ownership.**
- A 401 from any query or mutation means the browser's anonymous session is gone. The workspace returns to the upload screen with the server's message and removes every cached document and the drafts list.
- A draft on screen is mounted as `${id}:${generation}`, so reopening or reloading it starts clean.
- Closing a draft does not cancel work it started. The server finishes that turn or generation, as it did before the refactor. Its events reach only that draft's cache entry, never the draft opened meanwhile.

## What the refactor changed

**Size.** Hand-written `.ts`/`.tsx` in `src/` and `scripts/`:

| | Before (`fd4b280`) | After the refactor | Now |
| --- | --- | --- | --- |
| Files | 55 | 122 | 132 |
| Lines | 8,430 | 9,484 | 11,510 |
| Files ≥ 300 lines | 9 (largest: 632) | 1: `scripts/make-fixtures.ts` (421), test tooling | 0 |
| Files 201–299 lines | 9 | 4 (largest production file: 236) | 8 (largest: 294) |

"Now" adds the work described in [After the refactor](#after-the-refactor). Prettier's line breaks lengthened some files, so `server/db/repo.ts` (320 lines after formatting) gave its session functions to `server/db/sessions.ts`. `scripts/make-fixtures.ts` was split into `scripts/fixtures/`.

Files that were split:
- `components/Workspace.tsx`: 632 lines into 11 modules across `workspace`, `chat`, `documents` and `shared/ui`
- `lib/docx/ooxml.ts`: 596 lines into 7 files
- `lib/server/service.ts`: 495 lines into 7 modules in `server/documents/`
- `components/ChatPanel.tsx`: 347 lines into 4 components
- `lib/diff.ts`: 346 lines into 5 modules, including the shared `lcs.ts`
- `lib/fields/build.ts`: 329 lines into 3 files
- `lib/fields/rules.ts`: 314 lines into 3 files
- `components/ui.tsx`: 306 lines into 6 files in `shared/ui/`

**Duplication removed.**
- What is still needed was computed in three places: the workspace's count, the saved-drafts list's count, and the outstanding-fields filter. All three now use `features/documents/progress.ts`.
- `ClauseChange` was typed twice. It is now one contract.
- The blocks cache key was built in two places. It is now one function.
- The longest-common-subsequence table and walk existed twice. Both callers now use `server/diff/lcs.ts`, with identical output on 8,000 random inputs.
- `parse<T>` with `as T` is replaced by validated `requestJson`.
- The regexes that classified errors by their message are replaced by typed errors. Database driver errors are the one exception.

**Defects fixed.**
- A reply or generation still streaming when another draft was opened applied its events to the draft opened meanwhile. `drafts.spec.ts` failed on this before the refactor and passes now.
- A clause action after an autosave reloaded the editor needlessly: it compared against a revision the autosave had already superseded.
- Parsed blocks read back from Redis were used without validation.

**Deliberate behaviour change.** When the session is gone, the app returns to the upload screen with the server's explanation. Before, the explanation appeared next to whichever action failed, and cached data for the old session stayed in the page. The brief asks to clear private cache when ownership changes.

**Dependencies.**
- Added `@tanstack/react-query` 5.103.2.
- Moved `pg` from devDependencies to dependencies: the app uses it at runtime against a local PostgreSQL.
- Upgraded nothing else.

## Verification

Run for this refactor on 24 September 2026, against a production build (markers-only mode, local PostgreSQL, no Redis):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` (layer rules and the assertion bans) | 0 problems |
| `npm run check:cycles` | 0 cycles. A deliberate aliased cycle was reported, so the rule does resolve `@/` imports. |
| `npm test` | 67 of 67 pass (45 unit, 22 integration on PostgreSQL) |
| `npm run build` | Pass |
| `npm run test:e2e` | 13 pass. 1 skipped: `bonuses.spec.ts`, which needs live Gemini. |
| `tests/smoke/http-smoke.mjs` | Pass |

Additional checks:
- **Characterization tests** written before the client was moved: `tests/e2e/drafts.spec.ts` (open, rename and delete drafts; a second tab's stale save; a late reply after switching drafts; a lost session).
- **Unit tests** added: the save coordinator, and the workspace status.
- **Mutation check:** without clearing the drafts list on session loss, the session test fails.
- **Differential checks** (scratch scripts, not committed): the new diff helper matches the old implementations on 8,000 random inputs, and reply formatting matches the old version on 20,000 random replies. Every fixture's blocks survive a round trip through the cache schema.
- **Bundle:** `.next/static` contains no server environment variable names, `drizzle-orm`, `@neondatabase`, `pg-protocol`, `server-only`, or server functions.
- **Not run: live Gemini.** Model-facing code was split and moved, not rewritten. The chat path is covered by integration tests with a mocked model and by `chat.spec.ts` with a stubbed stream.

## After the refactor

Done the same day, after a review against the assessment rubric found gaps. The README's verification table has the results.

- **Microsoft Word check** (`npm run check:word`, `scripts/word/`). Word 16 on Windows opens every template, filled draft and editor round trip, and a script compares what Word reports: styles, live numbering, fonts, spacing, emphasis, tables, headers, margins, notes, comments, tracked changes, pictures, text boxes and contents. A rich fixture (`synthetic-supply-agreement.docx`) carries the features the other fixtures lack.
- **Live conversation evaluation** (`npm run eval:conversation`). It found four defects, fixed with tests: a date written in figures was re-read by the model, raw placeholder labels reached the lawyer, clause ids leaked into replies, and a failed reply hid the answers already saved.
- **Narrow screens.** Below 900 px the page is scaled to the width of the screen, with no sideways scrolling.
- **Firefox and WebKit** run the browser tests. The session cookie is `Secure` only when `APP_URL` is HTTPS, because Safari drops `Secure` cookies on `http://localhost`.
- **Prettier** 3.9.9 (devDependency, `printWidth` 160) formats the code. `npm run format:check` verifies it.
- **Interface refinement:** new design tokens and shared primitives (`globals.css`, `shared/ui/`), plain rows instead of cards, one primary action in the header, and the screen-reader markers of the chat and comparison lists contained in their scroll containers (they had made the page scroll).
- **Vercel AI Gateway** (`server/ai/fallback.ts`, `AI_PROVIDER`): Gemini first and the gateway when a call fails, or either one alone. `ai` 7.0.113 with `@ai-sdk/google` 4.0.79 and `@ai-sdk/gateway` 4.0.91, so there is one copy of the provider packages.
- **Tests:** 80 (57 unit, 23 integration).

## Exceptions

- Tests are not held to the size and assertion rules. They cast JSON read back from the app.
- Files under 80 lines are mostly route handlers, contracts and per-feature `api.ts` modules, which are small by nature.
