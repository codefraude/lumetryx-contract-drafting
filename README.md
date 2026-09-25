# AI contract drafting from Word templates

This app fills a lawyer's own Word template through a chat. You upload a `.docx`, answer its questions about the parties, dates and amounts, edit the result in the browser and download it. The file you get back keeps the template's styles, clause numbering, tables, headers and footers.

It was written for the Lumetryx take-home, as a single-page Next.js app. The code is AGPL-3.0 because the document editor it embeds is.

![The workspace in the dark theme: Chat, Details and Clauses tabs on the left, and the filled bilingual employment contract open in the editor on the right](docs/screenshots/ui-draft-dark.png)

_A synthetic bilingual template in the dark theme, with no AI key set (markers-only mode). The screenshot predates the Open in Word button._

## What it does

1. You upload one `.docx` of up to 5 MB. The server checks the zip before unpacking it and turns away encrypted, legacy `.doc` and macro-enabled files.
2. The server finds the blanks itself, reading the Word structure rather than flat text: `{{name}}` (also when Word splits it across runs), `[NAME]`, `____`, lines drawn as underlined spaces, empty cells whose row and column labels name a value, and Word placeholder boxes, in the body, headers and footers. Code works out what each blank means: a cell takes its row and column labels, `[address]` after "(the Tenant), of" is the tenant's address, the words after a blank give its unit ("calendar days", "hours", "persons"), and a blank in an English sentence followed by the same blank in its French translation is one field. Gemini then merges duplicates and names the fields, quoting the template. It cannot delete a real blank: a blank it doubts stays, marked as uncertain.
3. A chat asks for the missing details two or three at a time: the parties first, then the subject, dates, money and other terms, with contacts and signatories last. One message can answer several details, correct an earlier one or ask a question back. "None", "not applicable", "I don't know yet" and "leave it blank" are understood and kept apart from zero. Answers can also be typed in the Details panel. Dates are written in full ("26 September 2026") unless you ask for figures.
4. The filled draft streams in, paragraph by paragraph.
5. You edit it in SuperDoc, a Word-like editor that runs in the browser. Edits save on their own.
6. You download the `.docx`, or open it in the Word app installed on the device.

The four optional parts of the brief are there too. French and mixed English/French templates work, and dates and amounts are written in each paragraph's language ("1 octobre 2026", "1 250,50 EUR"). A clause wrapped in `[[IF senior]] … [[END IF]]` stays or goes depending on an answer, and an unanswered condition is never taken as "no". A Compare tab shows what changed between the template and the draft, unsaved edits included. Drafts are kept for 30 days and can be reopened later in the same browser, without an account.

## How it works

The model never writes the contract. It proposes answers, and one function (`server/fields/resolve.ts`) decides what is saved, for the chat and the Details panel alike. A proposed value must appear in the user's message, or be the value of a field the user explicitly points to ("same address as the landlord"). A value inside a question is never stored, and a contact person is not taken as the signatory. `03/04/2026` gets a follow-up question because it could be the 3rd of April or the 4th of March. A currency has to be named, "$" is ambiguous, "25 000,50 EUR" is read the French way, and amounts are stored as exact decimals. Emails and counts in the template's unit are checked, and so is an end date that falls before its start date. Free text that the bilingual template writes in both languages gets a French wording, translated by the model, checked for matching numbers and flagged as a translation in the Details panel. Progress, the next questions and the pre-export check all read the same saved state.

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
| `next-intl` | 4.14.7 | English and French interface, locale from a cookie | MIT |
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
cp .env.example .env   # every variable is explained in the file
node --env-file=.env node_modules/.bin/drizzle-kit migrate
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
| `npm run eval:fixtures -- --runs 2` | Live analysis and chat turns on the three supplied templates, scored against their manifests. Writes a JSON report with model, runs, failures and token use to `tests/output/live-eval/` |
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

- The three templates Lumetryx supplied are immutable fixtures (`fixtures/lumetryx/`), each with a hand-written manifest of its fields, reviewed independently against the raw XML (`tests/manifests/`). Detection scores zero missed fields, zero false positives, zero wrong merges and zero duplicate questions on all three, for markers-only detection and for a recorded model analysis.
- 160 unit and integration tests pass. One flow per supplied template runs upload, answers, clarification, correction, the streamed draft, a browser edit, resume and export, and parses the exported file again: every paragraph keeps its style and numbering, text outside the answers is unchanged, and styles, numbering and settings are byte-identical. Generalization tests change copies of the templates: renamed parties, reordered tables, one [NAME] for two parties, a French-only template, no fields, and an instruction hidden in the text.
- Playwright covers editing, export, themes, saved drafts, placeholder boxes and Open in Word (24 tests in Chromium). For each supplied template, a browser test edits the draft, switches the interface to French while the edit is still unsaved, and checks that the editor is not remounted, that the download contains the edit, and that a reload resumes the draft. Firefox and WebKit were not re-run after these changes.
- Microsoft Word 16 on Windows opened every template, its filled draft and the draft after a round trip through the editor, all without a repair prompt (11 templates including the three supplied, 122 checks). Styles, live numbering, tables, headers, footers and margins match. 4 checks are flagged, and all 4 are comparison artefacts. Three are an empty template cell compared by its paragraph mark (11 pt) with the value written into the cell's own 10.5 pt run. The fourth is a repeated `________` matched to the wrong occurrence.
- Live model (`npm run eval:fixtures`, gemini-3.1-flash-lite, thinking level minimal): 2 runs over the three supplied templates, 39 calls, about 88,000 input and 23,000 output tokens. The live analysis had no detection issue against the manifests, and no conversation turn failed its check on the saved answers. One turn could not be judged because the provider was down. The first runs found three defects, fixed with tests: blanks the model dismissed were dropped, numbers written in words were rejected, and party names were typed as text. Mocked tests are not evidence of live quality; this run is small.

Each run is written up in [docs/DETAILS.md](docs/DETAILS.md#verification).

## What was not tested, and known gaps

- The templates are all synthetic. Lumetryx's own templates were not available.
- Neon and Upstash were used, but never under load.
- Word was only run on Windows, not on a Mac or on the web.
- The live chat evaluation is thirteen cases, run once after the latest fixes.
- The chat's "Jump to latest" browser test fails about half the time, and did before the latest changes too. The test finishes while one of its network stubs is still running.
- Without AI, marked and drawn blanks are found and labelled from their structure, but unmarked gaps are not, and the French wording of bilingual text has to be typed in the Details panel.
- The pairing of an English blank with its French twin assumes the translation follows directly. Other layouts rely on the model.
- Units are not converted: "2 weeks" for a field counted in days is asked about.
- A translation is the model's. Code checks only that its numbers match, so it is shown to the lawyer as a translation.
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
