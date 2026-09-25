# AI contract drafting from Word templates

A lawyer uploads their own Word template, answers a short conversation, and gets back a filled contract as a `.docx` that keeps the template's styles, clause numbering, tables, headers and footers.

It is a single-page Next.js app, built as a take-home for Lumetryx. It is licensed AGPL-3.0 because of its document editor (see [Licence](#licence)).

![The workspace in the dark theme: Chat, Details and Clauses tabs on the left, and the filled bilingual employment contract open in the editor on the right](docs/screenshots/ui-draft-dark.png)

_A synthetic bilingual template in the dark theme, taken with no AI key set (markers-only mode) and before the Open in Word button was added._

## What it does

1. **Upload.** One `.docx` of up to 5 MB. It is checked before it is unzipped (size and zip-bomb limits); encrypted, legacy and macro-enabled files are rejected.
2. **Find the blanks.** Marked blanks are found locally: `{{name}}`, `[NAME]`, `____` and Word placeholder boxes (content controls). Gemini then merges duplicates, drops false positives and proposes unmarked blanks, each backed by a verbatim quote from the template.
3. **Ask.** A streaming chat asks for the missing details by group: parties, subject, dates, money. Answers can also be typed in the Details panel.
4. **Draft.** The server fills the template and streams it into a preview, paragraph by paragraph.
5. **Edit.** The draft opens in SuperDoc, a Word-like editor in the browser, and edits save automatically.
6. **Export.** Download the `.docx`, or open it directly in the Word app installed on the device.

The four optional bonuses are on the same page:

- **French and mixed English/French templates.** Dates and amounts are written in each paragraph's language ("1 octobre 2026", "1 250,50 EUR").
- **Conditional clauses.** Markers such as `[[IF senior]] … [[END IF]]` keep or remove a clause depending on an answer. An unanswered condition is never read as "no".
- **Compare with template.** A read-only diff of the template and the current draft, unsaved edits included.
- **Saved drafts.** Drafts are kept for 30 days after the last save and can be resumed in the same browser, without an account.

## How it is built, and why

- **The AI never writes the document.** It only proposes answers. Each one must quote the user's own words, then pass deterministic checks before it is saved: an ambiguous date such as `03/04/2026` is asked about, a currency must be named, amounts are exact decimals.
- **Filling is plain code.** The server edits the Word XML itself (`jszip` and `@xmldom/xmldom`). Filling changes only text; styles, numbering, relationships and media stay as they are, and a test checks that `numbering.xml` is byte-identical afterwards.
- **SuperDoc for editing.** A spike, run before any interface was built, showed that it round-trips real legal numbering (1 / 1.1 / 1.1.1), tables, headers and footers. HTML editors flatten that numbering into text. The decision is in [ADR-001](docs/ADR-001-document-engine.md).
- **Two model calls per chat turn:** a structured extraction, then a streamed reply. Answers are saved before the reply starts, so a failed reply loses nothing.
- **Gemini first, the Vercel AI Gateway as a fallback.** The model is `gemini-3.1-flash-lite`, called through the Vercel AI SDK. When Gemini fails before answering, the same call goes once through the gateway, and Gemini is skipped for the next minute.
- **Separate layers.** Document code knows nothing about AI, routes only validate input and call a use case, and browser code never imports server code. ESLint enforces the import rules between layers ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

**Stack:** Next.js 16 (App Router, Node runtime), React 19, strict TypeScript, TanStack Query 5, Zod 4, Tailwind CSS 4, SuperDoc 2.17, Vercel AI SDK 7, Drizzle ORM on Neon Postgres, and Upstash Redis for caching, locks and rate limits.

## Run it locally

You need Node 22 or later (the AI SDK requires it) and npm.

```bash
npm ci
cp .env.example .env.local   # fill in the values; each one is explained in the file
node --env-file=.env.local node_modules/.bin/drizzle-kit migrate
npm run dev                  # http://localhost:3000
```

What happens when a credential is missing:

- **No `GEMINI_API_KEY` and no `AI_GATEWAY_API_KEY`:** markers-only mode. Marked blanks are found and filled from the Details panel, and the chat is off and says why. The app never makes up AI answers.
- **No `UPSTASH_*`:** development skips caching and rate limits. A production build refuses costly requests unless `ALLOW_NO_REDIS=true`, which is for local testing only.
- **No database:** requests fail with a storage error. There is no in-memory fallback.

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build for production, serve the build |
| `npm run typecheck` / `lint` / `format` | Strict TypeScript, ESLint (layer rules included), Prettier |
| `npm test` | Unit and integration tests. The integration tests need a local Postgres at `postgres://postgres:postgres@localhost:5432/lumetryx_test` (in `DATABASE_URL`) and recreate its schema |
| `npm run test:e2e` | Playwright browser tests against a running server (`APP_URL`) |
| `npm run check:word` | Opens the exported drafts in Microsoft Word (Windows, or WSL) and compares them with their templates |
| `npm run eval:conversation` | A small live evaluation of the chat, against a server with a real AI key |
| `npm run db:cleanup` | Deletes expired drafts and sessions; run it from cron |

Run the browser tests against a production build with no AI key and no Redis:

```bash
GEMINI_API_KEY= AI_GATEWAY_API_KEY= UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= ALLOW_NO_REDIS=true npm start
```

With a live key, the model names fields differently from what the tests expect. With Redis, the upload rate limit runs out partway through the suite. The one live scenario, `tests/e2e/bonuses.spec.ts`, needs a real key and runs only with `E2E_LIVE_AI=1`.

## Project layout

```
src/app/          the page and thin API routes
src/features/     browser code by feature: documents, chat, clauses, comparison, drafts, workspace
src/shared/ui/    design-system components: buttons, tabs, dialogs, theme control
src/lib/          browser helpers: validated HTTP, SSE client, query client, theme
src/server/       use cases, Word XML, fields, clauses, diff, AI, database, cache, sessions
tests/            unit, integration and Playwright tests
scripts/          fixture generator, Word check, live evaluation, cleanup
fixtures/         the synthetic .docx templates
```

## What has been verified

- **81 unit and integration tests** pass. The integration tests run on a real Postgres with a **mocked** model.
- **Browser tests** in headless Chromium, Firefox and WebKit cover editing, export, themes, saved drafts, placeholder boxes and Open in Word.
- **Microsoft Word 16** on Windows opened every fixture's draft, and its editor round trip, without repair, and matched the templates on 86 automated checks.
- **Live Gemini** ran the full bonus scenario in a real browser, and a ten-case evaluation of messy answers: ambiguous dates, corrections, unknown answers, instructions hidden in a message or a template. Its first run found four defects. After the fixes, all 16 expectations held.

The evidence, run by run, is in [docs/DETAILS.md](docs/DETAILS.md#verification).

## What has not been verified, and known limits

- **Every template is synthetic.** The employer's own templates were not available.
- Neon and Upstash work, but have not been tested under load.
- Word was checked on Windows only. Word for Mac and Word on the web were not run.
- The live evaluation is small: ten cases, run once after the fixes.
- One browser test is flaky. The chat's "Jump to latest" test fails about half the time, as it did before the latest changes: it ends while one of its network stubs is still running.
- Unmarked blanks depend on the model. Without AI, only marked blanks are found, and an English/French pair of blanks is asked twice.
- Placeholders inside footnotes and comments are not detected.
- Compare covers text, bold, italic, underline, styles and list levels, not fonts, spacing or layout.
- Saved drafts resume only in the same browser profile. There are no accounts and no cross-device access.
- Word on the web is not offered: it can only open files on a public HTTPS address or in OneDrive.

The full list is in [docs/DETAILS.md](docs/DETAILS.md#known-limitations-and-trade-offs).

## Licence

AGPL-3.0-only. The editor, SuperDoc, is AGPL-3.0, so a network service that uses it must publish its own source. A closed product needs a commercial SuperDoc licence or another editor; the filling code does not depend on SuperDoc. Every other dependency is under a permissive licence (MIT, Apache-2.0 or ISC).

## More documentation

- [docs/DETAILS.md](docs/DETAILS.md): how each part works, the full verification table and every limit
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, import rules and who owns which state
- [REQUIREMENTS.md](REQUIREMENTS.md): each requirement of the brief and where it is met
- [WALKTHROUGH.md](WALKTHROUGH.md): the script for a demo
- [ADR-001](docs/ADR-001-document-engine.md) and [ADR-002](docs/ADR-002-bonuses.md): the document engine and the bonus design
