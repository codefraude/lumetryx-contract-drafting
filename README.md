# AI contract drafting from Word templates

This app fills a lawyer's own Word template through a chat. You upload a `.docx`, answer its questions about the parties, dates and amounts, edit the result in the browser and download it. The file you get back keeps the template's styles, clause numbering, tables, headers and footers.

It was written for the Lumetryx take-home, as a single-page Next.js app. The code is AGPL-3.0 because the document editor it embeds is.

![The workspace in the dark theme: Chat, Details and Clauses tabs on the left, and the filled bilingual employment contract open in the editor on the right](docs/screenshots/ui-draft-dark.png)

_A synthetic bilingual template in the dark theme, with no AI key set (markers-only mode). The screenshot predates the Open in Word button._

## What it does

1. You upload one `.docx` of up to 5 MB. The server checks the zip before unpacking it and turns away encrypted, legacy `.doc` and macro-enabled files.
2. The server finds the marked blanks itself: `{{name}}`, `[NAME]`, `____` and Word placeholder boxes. Gemini then merges duplicates, drops false positives and suggests unmarked blanks, quoting the template for each one.
3. A chat asks for the missing details, a few at a time. Answers can also be typed in the Details panel.
4. The filled draft streams in, paragraph by paragraph.
5. You edit it in SuperDoc, a Word-like editor that runs in the browser. Edits save on their own.
6. You download the `.docx`, or open it in the Word app installed on the device.

The four optional parts of the brief are there too. French and mixed English/French templates work, and dates and amounts are written in each paragraph's language ("1 octobre 2026", "1 250,50 EUR"). A clause wrapped in `[[IF senior]] … [[END IF]]` stays or goes depending on an answer, and an unanswered condition is never taken as "no". A Compare tab shows what changed between the template and the draft, unsaved edits included. Drafts are kept for 30 days and can be reopened later in the same browser, without an account.

## How it works

The model never writes the contract. It proposes answers, and each one has to quote what the user actually typed. Code then checks it: `03/04/2026` gets a follow-up question because it could be the 3rd of April or the 4th of March, a currency has to be named, and amounts are stored as exact decimals. Only then is anything saved.

Filling is ordinary code on the server. It edits the Word XML with `jszip` and `@xmldom/xmldom` and changes nothing but text, so styles, numbering, pictures and relationships stay as they were. A test checks that `numbering.xml` comes out byte for byte the same.

SuperDoc was picked after a spike, run before any interface existed, showed that it keeps real legal numbering (1, 1.1, 1.1.1), tables and headers through an edit and an export. HTML editors turn that numbering into plain text. [ADR-001](docs/ADR-001-document-engine.md) has the details.

Each chat turn makes two model calls: one extracts the answers, the other streams the reply. The answers are saved in between, so a reply that fails loses nothing. Gemini (`gemini-3.1-flash-lite`) is tried first. When it fails before answering, the same call goes once through the Vercel AI Gateway, and Gemini is left alone for a minute.

Document code knows nothing about AI, and the API routes only check input and call a use case. Browser code never imports server code. ESLint enforces the import rules between these layers ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Libraries

Every package in `package.json`, at the version installed.

| Package | Version | What it does here | Licence |
| --- | --- | --- | --- |
| `next` | 16.3.6 | Pages and API routes (App Router, Node runtime) | MIT |
| `react`, `react-dom` | 19.3.0 | The interface | MIT |
| `@tanstack/react-query` | 5.103.2 | Fetches, caches and updates server data in the browser | MIT |
| `zod` | 4.6.5 | Validates requests, responses, model output and environment variables | MIT |
| `superdoc` | 2.17.0 | The Word-like editor in the browser | AGPL-3.0 |
| `jszip` | 3.10.2 | Opens and rewrites the `.docx` zip | MIT or GPL-3.0, used under MIT |
| `@xmldom/xmldom` | 0.9.12 | Parses and writes the Word XML | MIT |
| `ai` | 7.0.113 | Vercel AI SDK: structured output and streamed replies | Apache-2.0 |
| `@ai-sdk/google` | 4.0.79 | Gemini provider for the AI SDK | Apache-2.0 |
| `@ai-sdk/gateway` | 4.0.91 | Vercel AI Gateway provider, the fallback | Apache-2.0 |
| `drizzle-orm` | 0.45.3 | Database schema and queries | Apache-2.0 |
| `@neondatabase/serverless` | 1.1.0 | Postgres driver for Neon | MIT |
| `pg` | 8.23.0 | Postgres driver for a local database, in development and tests | MIT |
| `@upstash/redis` | 1.39.0 | Redis over HTTP: the template cache and request locks | MIT |
| `@upstash/ratelimit` | 2.1.0 | Rate limits on new sessions, uploads and chat turns | MIT |
| `lucide-react` | 1.47.0 | Icons | ISC |
| `server-only` | 0.0.1 | Fails the build if server code is imported into the browser | MIT |

Development only:

| Used for | Packages | Licence |
| --- | --- | --- |
| Language and types | `typescript` 6.0.3, `@types/node` 26.6.2, `@types/react` and `@types/react-dom` 19.3.0, `@types/pg` 8.23.1 | Apache-2.0, MIT |
| Styles | `tailwindcss` and `@tailwindcss/postcss` 4.3.3, `postcss` 8.5.28 | MIT |
| Lint and format | `eslint` 9.39.5, `eslint-config-next` 16.3.6, `@stylistic/eslint-plugin` 5.10.0, `prettier` 3.9.9, `prettier-plugin-tailwindcss` 0.8.1 | MIT |
| Tests | `vitest` 5.0.1, `@playwright/test` 1.63.0 | MIT, Apache-2.0 |
| Migrations | `drizzle-kit` 0.31.11 | MIT |
| Scripts | `tsx` 4.23.15 runs the TypeScript scripts, `docx` 9.7.1 generates the synthetic templates | MIT |

Three dev packages are installed but not imported by any committed file. `@superdoc/sdk` 2.14.0 (AGPL-3.0) ran the editor spike, whose code is not in the repo. `playwright-core` 1.63.0 (Apache-2.0) is already pulled in by `@playwright/test`. `@sparticuz/chromium` 153.0.0 (MIT) is a spare test browser for machines where Playwright's own Chromium does not start (see `CHROMIUM_PATH`).

The interface fonts, Source Sans 3 and Source Serif 4, are downloaded by `next/font` at build time and served by the app itself.

## Running it locally

You need Node 22 or later and npm.

```bash
npm ci
cp .env.example .env.local   # every variable is explained in the file
node --env-file=.env.local node_modules/.bin/drizzle-kit migrate
npm run dev                  # http://localhost:3000
```

Without an AI key (`GEMINI_API_KEY` or `AI_GATEWAY_API_KEY`), the app runs in markers-only mode: marked blanks are found and filled from the Details panel, and the chat is off, with a message saying why. Without Upstash, development skips the cache and rate limits, but a production build refuses the costly requests unless `ALLOW_NO_REDIS=true`. Without a database nothing works, as there is no in-memory fallback.

| Command | What it does |
| --- | --- |
| `npm run typecheck`, `lint`, `format` | TypeScript, ESLint with the layer rules, Prettier |
| `npm test` | Unit and integration tests. The integration tests need a local Postgres in `DATABASE_URL` (for example `postgres://postgres:postgres@localhost:5432/lumetryx_test`) and wipe its schema |
| `npm run test:e2e` | Playwright tests against a running server (`APP_URL`) |
| `npm run check:word` | Opens the exported drafts in Microsoft Word (Windows or WSL) and compares them with their templates |
| `npm run eval:conversation` | A small live test of the chat, which needs a real AI key |
| `npm run db:cleanup` | Deletes expired drafts and sessions, for a cron job |

The browser tests expect a production build with no AI key and no Redis:

```bash
GEMINI_API_KEY= AI_GATEWAY_API_KEY= UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= ALLOW_NO_REDIS=true npm start
```

With a live key, the model names the fields its own way and some assertions fail. With Redis, the upload rate limit runs out halfway through. The exception is `tests/e2e/bonuses.spec.ts`, which needs a live key and only runs with `E2E_LIVE_AI=1`.

## Where things are

```
src/app/        page and API routes
src/features/   browser code, one folder per feature: documents, chat, clauses, comparison, drafts, workspace
src/shared/ui/  buttons, tabs, dialogs and other shared components
src/lib/        browser helpers: HTTP, SSE, query client, theme
src/server/     use cases, Word XML, fields, clauses, diff, AI, database, cache, sessions
tests/          unit, integration and Playwright tests
scripts/        template generator, Word check, live evaluation, cleanup
fixtures/       synthetic .docx templates
```

## What was tested

- 81 unit and integration tests pass. The integration tests use a real Postgres and a mocked model.
- Playwright covers editing, export, themes, saved drafts, placeholder boxes and Open in Word, in Chromium, Firefox and WebKit.
- Microsoft Word 16 on Windows opened each template's draft, and the same draft after a round trip through the editor, without a repair prompt. 86 automated checks found no difference from the templates.
- Against live Gemini, the full bonus scenario passed in a browser. A ten-case evaluation of messy answers found four defects on its first run; after the fixes, all 16 expectations held.

Each run is written up in [docs/DETAILS.md](docs/DETAILS.md#verification).

## What was not tested, and known gaps

- The templates are all synthetic. Lumetryx's own templates were not available.
- Neon and Upstash were used, but never under load.
- Word was only run on Windows, not on a Mac or on the web.
- The live chat evaluation is ten cases, run once after the fixes.
- The chat's "Jump to latest" browser test fails about half the time, and did before the latest changes too. The test finishes while one of its network stubs is still running.
- Without AI, only marked blanks are found, and a blank that appears in both languages is asked twice.
- Placeholders inside footnotes and comments are missed.
- Compare looks at text, bold, italic, underline, styles and list levels. Fonts, spacing and layout are not compared.
- A saved draft can only be reopened in the browser profile that created it.
- Word on the web is not supported: it can only open files from a public HTTPS address or from OneDrive.

[docs/DETAILS.md](docs/DETAILS.md#known-limitations-and-trade-offs) has the full list.

## Licence

AGPL-3.0-only. SuperDoc is AGPL-3.0, and running it in a network service means publishing that service's source code. A closed product would need a commercial SuperDoc licence or another editor. The filling code does not use SuperDoc, so only the editor would change. The other runtime libraries are MIT, Apache-2.0 or ISC.

## Other documents

- [docs/DETAILS.md](docs/DETAILS.md): how each part works, every test run and every known gap
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, import rules, who owns which state
- [REQUIREMENTS.md](REQUIREMENTS.md): each requirement of the brief and where it is met
- [WALKTHROUGH.md](WALKTHROUGH.md): the script for a demo
- [ADR-001](docs/ADR-001-document-engine.md) and [ADR-002](docs/ADR-002-bonuses.md): the editor choice and the bonus design
