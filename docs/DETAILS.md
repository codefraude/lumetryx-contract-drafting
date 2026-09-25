# Technical details

The full reference behind the [README](../README.md): how each part works, what was verified and how, and every known limit.

A single-page Next.js app for the Lumetryx take-home. A lawyer uploads their own `.docx` template, answers a guided (streaming) conversation, watches the filled draft stream in, edits it in a Word-like editor, and downloads a `.docx` that keeps the template's formatting.

The four optional bonuses are implemented on the same page (details in [Bonuses](#bonuses)):
- French and mixed English/French templates;
- conditional clauses;
- a read-only comparison of the template with the current draft;
- saved drafts that can be resumed later without an account.

The interface has light, dark and system themes, and a layout that keeps the document central (see [Interface and themes](#interface-and-themes)).

> **Status in one paragraph.**
>
> - **Tested and verified:**
>   - Document handling.
>   - The conversation logic, against a clearly labelled *mocked* model.
>   - Persistence and session isolation on a real PostgreSQL.
>   - The HTTP layer, against a running production build.
>   - Real in-browser editing and export in headless Chromium, Firefox and WebKit.
>   - The exports in **Microsoft Word** 16: every fixture's filled draft and its editor round trip, and a draft edited in the browser, open without repair and match their templates on 86 automated checks (`npm run check:word`).
>   - The integrated bonus scenario, against **live Gemini** in a real browser (French answer, English correction).
>   - A small **live** evaluation of messy answers (`npm run eval:conversation`); its first run found four defects, now fixed. The latest run (25 September 2026, thirteen cases, after the NDA fixes below) held every expectation.
> - **Live services:** Neon was migrated, and Upstash answered a ping. Neither was exercised under load.
>
> All templates are **synthetic** (`fixtures/`); the employer's sample templates were not available. See [Verification](#verification) and [REQUIREMENTS.md](../REQUIREMENTS.md).

## Run it locally

Requires Node 20.9+ (tested on 22) and npm.

```bash
npm ci
cp .env.example .env.local       # fill in the values (see comments in the file)
npm run db:migrate               # uses DATABASE_URL_UNPOOLED (Neon direct connection), else DATABASE_URL
npm run dev                      # http://localhost:3000
```

`drizzle-kit` does not read `.env.local` by itself. Either export the variables first, or run `node --env-file=.env.local node_modules/.bin/drizzle-kit migrate`. Migration `0001_drafts_retention` only **adds** columns (`title`, `saved_at`, `expires_at` and `sessions.expires_at`) and backfills them from each row's own history; existing drafts keep working. Field-state JSON written by older versions gets its new keys' defaults when read, so no data migration is needed.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop / production build / serve the build |
| `npm run typecheck` / `npm run lint` | Strict TypeScript / ESLint: Next.js and typescript-eslint rules, no `any`, no type or non-null assertions, and the import rules between layers ([docs/ARCHITECTURE.md](ARCHITECTURE.md)) |
| `npm run check:cycles` | Import-cycle check (separate from lint: it resolves every import and takes about two minutes) |
| `npm test` | Unit + integration tests (Vitest). Integration tests need a **local** PostgreSQL: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/lumetryx_test` (they drop and recreate the schema of that database). |
| `npm run test:e2e` | Browser tests (Playwright) against a running server (`APP_URL`, default `http://localhost:3000`): the core flow, themes, and the chat surface (with its stream stubbed). `E2E_BROWSERS=chromium,firefox,webkit` picks the engines (default Chromium). Set `CHROMIUM_PATH` or `WEBKIT_PATH` when Playwright's own browser is unavailable or cannot load its system libraries. The integrated bonus scenario (`tests/e2e/bonuses.spec.ts`) needs a server with a live AI key (Gemini or the gateway) and runs only with `E2E_LIVE_AI=1`. |
| `npm run check:word` | Opens the exports in **Microsoft Word** (Windows, or WSL on a machine with Word) and checks them against their templates. Run the browser tests first against a markers-only server: `word-exports.spec.ts` writes each fixture's filled draft and editor round trip, and `flow.spec.ts` the lease edited in the browser. Writes `tests/output/word/report.md`; `-- --pdf` keeps Word's PDF of each file. Word opens the files read-only in a hidden instance of its own; a Word already open is left alone. |
| `npm run eval:conversation` | A small **live** evaluation against a server with a live AI key (`APP_URL`; `DATABASE_URL` for token counts): messy answers, a correction, an unknown answer, a question about a clause, instructions smuggled into a message and into a template, an ambiguous currency, a relative date and French. It checks what was saved, never the wording, and prints each reply, its latency and the tokens used. About 40 model calls. |
| `npm run format` / `npm run format:check` | Prettier (width 80, Tailwind classes sorted) on every TypeScript and `.mjs` file. `npm run lint` adds the layout Prettier leaves alone: braces on every `if`, blank lines around multi-line statements, one member per line in objects and types, and a block body for every named function |
| `npm run db:generate` / `npm run db:migrate` | Drizzle migrations (`drizzle/0000_init.sql` is committed) |
| `npm run db:cleanup` | Bounded retention cleanup, run from cron or by hand (there is no scheduler service). It removes drafts past their expiry (messages cascade), then expired sessions that own no draft, and drops those drafts' cached analyses. It reads `.env.local`. |
| `npm run smoke:gemini` | One small **live** Gemini check (structured output + streaming, prints token usage). |
| `npm run smoke:gateway` | The same check through the **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL`). |
| `npm run fixtures` | Regenerates the synthetic templates (`npm run fixtures -- <name>` for one of them) |

**Without credentials**:
- **No `GEMINI_API_KEY` and no `AI_GATEWAY_API_KEY`:** the app still runs in *markers only* mode. Explicit placeholders are detected and can be filled from the Details panel; chat is disabled with an explanation. No fake AI responses are ever produced. With only one of the two keys, the app uses that service.
- **No `UPSTASH_*` in development:** caching, dedupe and rate limiting are skipped.
- **No `UPSTASH_*` in production:** the app refuses costly requests (fails closed). `ALLOW_NO_REDIS=true` overrides that for local production-build testing only.
- **No database:** there is no in-memory substitute; requests fail with a clear storage message.

## Architecture

```
src/app/                   Page, root layout, query provider, thin API route handlers (Node runtime)
src/features/documents/    The core: zod contracts (fields, views, requests, SSE events), what is still needed (progress.ts),
                           API + TanStack queries, SuperDoc wrapper + save coordinator, upload, details, streamed preview
src/features/chat/         Conversation: turn streaming (use-chat-turn.ts), messages, composer, reply formatting
src/features/clauses/      Conditional clauses panel and attention rules
src/features/comparison/   Template-to-draft comparison (query + panel)
src/features/drafts/       Saved drafts: list query, rename/delete, drawer
src/features/workspace/    Composes the page: upload or one open draft, status, notices, download, session loss
src/shared/ui/             Design-system primitives (buttons, status, tabs, popover, dialog, theme control)
src/lib/                   Browser helpers: validated HTTP, SSE client, query client, theme store
src/server/documents/      Use cases called by the routes (upload, answers, drafting, comparison, drafts, views)
src/server/docx/           OOXML package validation, paragraph indexing, stable w14:paraIds, marker detection,
                           run-aware filling, whole-clause cut/restore, clause-reference tracking
src/server/fields/         Field building, deterministic validation (dates, money, yes/no), language detection and rendering
src/server/clauses/        Conditional-clause grammar, evaluation, validation of model proposals
src/server/draft/          Draft generation, and updating an edited draft for new answers and clause decisions
src/server/diff/           Read-only template-to-draft comparison
src/server/ai/             Gemini via Vercel AI SDK: template analysis, two-stage interview (validated extraction → streamed reply)
src/server/db/, cache/     Drizzle schema + session-scoped repository; Upstash cache, locks and rate limits with a fallback policy
src/server/http/, session  JSON/SSE responses and error mapping; anonymous sessions and origin checks; env validation
```

[docs/ARCHITECTURE.md](ARCHITECTURE.md) has the import rules between these folders, who owns which state, and the TanStack Query conventions. [docs/AUDIT.md](AUDIT.md) records every file.

The boundaries are the point:
- **Document code** knows nothing about AI.
- **AI code** never touches XML. It proposes *field values*, which pass deterministic validation before anything is committed.
- **Routes** only authenticate, validate input and call a use case in `src/server/documents/`.
- **Browser code** never imports server code, and every response is validated against its contract before the UI sees it.

That layering also makes the whole workflow testable without Next.js.

### Data model

A `Field` is:
- `id`, `label`, `question` and `valueType`: one of party, address, date, money, number, duration, percentage, jurisdiction or text;
- `group`: parties → subject → dates → money → other, the order of questioning;
- `occurrences`: exact anchors in the template;
- `required`, `confidence` and `source` (marker or AI);
- `status`: `missing` | `needs_clarification` | `confirmed`;
- the user's `rawValue`, the `displayValue` written into the document, a `normalized` value (ISO date-only, or an exact decimal string plus ISO currency), and a `note` explaining why clarification is needed.

An **occurrence anchor** is `part#paragraphOrdinal` + `[start,end)` + `expected` text, and supports `replace` (a marker, a placeholder box or placeholder wording) or `insert` (a gap after a caption).

After drafting, `draftAnchors` record where each value now sits, so later answer changes can be applied safely.

Neon tables:
- `sessions`: hashed secret, AI usage counters, sliding `expires_at`;
- `documents`: original and working DOCX as `bytea`, and field state as JSONB. The JSONB holds answers, anchors, conditional rules with any removed clause variants, tracked references, language metadata and the chosen chat language. The row also has `fieldsVersion`, `workingRevision`, draft status, `title`, `saved_at` and `expires_at`;
- `messages`: final messages only, never tokens or keystrokes.

## DOCX → editor → DOCX, and why these libraries

**Choice: server-side OOXML filling (own code on `jszip` + `@xmldom/xmldom`) + [SuperDoc](https://github.com/superdoc/docx-editor) 2.17 in the browser.**

The first thing built was a fidelity spike, run *before* any UI. SuperDoc's headless SDK opened a synthetic NDA and made three edits: a heading edit, a nested list-level change (1.1.2 → 1.2) and a table-cell edit. It then exported the document, and the export was reopened and diffed:
- **Unchanged:** margins, section and header/footer references, the numbering definitions, fonts, and `&amp;` escaping.
- **Correctly changed:** numbering renumbered to match the new list level.

That result is why SuperDoc was chosen; it is recorded in `docs/ADR-001-document-engine.md`.

HTML-based editors were rejected: they can't round-trip real legal multilevel numbering (`w:numPr` → `abstractNum`) without flattening it into text, which the brief forbids.

1. **Upload.**
   - The ZIP central directory is read *before* inflation. That enforces the size, entry-count and zip-bomb limits, and rejects encrypted, legacy CFB and macro packages.
   - `[Content_Types].xml` must declare a standard WordprocessingML main part.
   - Macros are never run and external relationships are never fetched.
2. **Indexing.**
   - Every paragraph in the body, headers and footers (including table cells) gets a stable anchor.
   - Its text is the concatenation of its `w:t` runs, so `{{disclosing_` + `party_name}}` split across bold and bold-italic runs is one string.
   - Tabs and breaks are immutable separators.
3. **Filling.**
   - All anchors are validated first, and a stale anchor aborts before any mutation.
   - Within a paragraph, edits apply from the end backwards so offsets stay valid.
   - A replacement goes into the first touched `w:t`, inheriting that run's formatting; later runs in the range are trimmed.
   - Escaping is done by the XML serializer, not by string manipulation.
   - Only `w:t` text changes. `numbering.xml`, `styles.xml`, relationships, media and section properties are untouched; a test asserts `numbering.xml` is byte-identical after filling.
4. **Editing.**
   - SuperDoc opens the filled bytes, the same revision that is persisted.
   - Edits autosave (1.5 s debounce) by exporting DOCX from SuperDoc and `PUT`ting it with an optimistic revision check.
   - Download, and sending a chat message, first *flush* pending saves, so an edit made immediately before clicking Download is included (E2E-tested).
5. **Export.** The download is the latest saved working DOCX, i.e. SuperDoc's serialization of the editor state. It is never a re-fill of the original, which would discard edits.

### Licences (read this before any proprietary use)

- **SuperDoc (`superdoc`, `@superdoc/sdk`): AGPL-3.0**, with commercial licences sold separately. Using it in a network service obliges you to offer that service's complete source under AGPL. This repository is therefore marked `AGPL-3.0-only`, which is fine for a public take-home submission. **Lumetryx would need a commercial SuperDoc licence**, or a different editor, to ship this in a closed product. No licence or trial was purchased or activated.
- Everything else is permissive: Next.js, React, Zod, `@xmldom/xmldom`, `@neondatabase/serverless`, `@upstash/*` and `docx` (dev only) are MIT; `ai`, `@ai-sdk/google` and `drizzle-orm` are Apache-2.0. `jszip` is dual MIT/GPL-3.0; used under MIT.
- `@sparticuz/chromium` (MIT) is a dev-only test browser.

### What formatting is preserved, and what is lost (observed)

Checked on the synthetic fixtures:
- by semantic XML assertions after filling and after browser round-trips;
- **in Microsoft Word 16** (`npm run check:word`). Word opens each template, the draft the server filled from it and that draft after an editor round trip. It reports styles, live list numbers, fonts, spacing, tables, margins, headers and footers, content controls, notes, comments, tracked changes, pictures, text boxes and tables of contents, and the formatting each answer takes from its placeholder. On 24 September 2026, 86 checks found no difference, and seven deliberately broken exports were each caught. Word's renders: the [supply agreement](screenshots/word-supply-agreement.png) (template left, the editor's export right) and the [lease edited in the browser](screenshots/word-lease-edited.png);
- earlier, by LibreOffice renders of the original next to the export (`docs/screenshots/fidelity-compare.png`).

| Preserved | Notes |
| --- | --- |
| Heading and paragraph styles | `pStyle` kept through fill and browser edits |
| Bold / italic / underline | Replacement inherits the run it lands in. A split placeholder takes the *first* run's formatting |
| Fonts, spacing | From styles; untouched |
| Legal multilevel numbering (1 / 1.1 / 1.1.1) | Real `numPr`, never flattened. Outdenting in the editor renumbers correctly (3.1.1 → 3.2, the next clause 3.2 → 3.3), as Word itself numbers the export |
| Bullets, tables | Table cell edits round-trip |
| Margins, sections, headers/footers | Header placeholders are filled; `pgMar` and header/footer refs survive |
| Pictures, footnotes, comments, tracked changes, text boxes, table of contents | Kept through filling and the editor's save, as Word reports them; a placeholder inside a text box is filled |
| Word content controls (placeholder boxes) | A filled box stops showing its placeholder and loses Word's grey *Placeholder Text* style; its data binding is removed, or Word would refill it from the empty bound property. Unanswered boxes and sample-text boxes are left as they are, and the boxes survive the editor's own save |

**Observed changes and losses:**
- **Empty parts removed:** SuperDoc's export dropped the *empty* `footnotes.xml`/`endnotes.xml` parts and their relationships, consistently (no dangling references). Non-empty footnotes, comments and tracked changes survive.
- **Formatting of a split placeholder:** when a placeholder spans runs with different formatting, the value takes the first run's formatting.
- **Pagination:** Word, LibreOffice and SuperDoc lay text out slightly differently, so page breaks can differ. Pixel-identical rendering is not claimed.
- **Not tested:** floating pictures, modern (DrawingML) text boxes, cross-reference fields, endnotes, charts and several sections. Placeholders inside footnotes and comments are not detected; those in text boxes are.
- **Microsoft Word:** checked with Word 16 on Windows, with a French interface. Word for Mac and Word on the web were not run.

## Conversation and Gemini usage

- **Model:** `gemini-3.1-flash-lite`, configurable via `GEMINI_MODEL`. Google's model page (checked during the build) lists it as *stable* with structured outputs, function calling and `thinking_level`. Pricing was taken from the brief ($0.25 / $1.50 per M input/output tokens) and **was not re-verified**; check the pricing page.
- **Thinking level:** `minimal`, the lowest documented Gemini 3 level, set through the AI SDK's `providerOptions.google.thinkingConfig.thinkingLevel`. It has only been validated by type definitions, not by a live quality test.
- **Why the AI SDK:** one integration path, the Vercel AI SDK 7 with `@ai-sdk/google`. Its `Output.object` gives schema-validated structured output, and `streamText` gives the reply stream.

**Gemini or the Vercel AI Gateway (`AI_PROVIDER`).**
- `auto` (default): Gemini first. When a call fails before answering (overloaded, out of quota, a bad key or model, a network error), the same call is made once through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) with `AI_GATEWAY_MODEL`, and Gemini is skipped for the next minute, so an overload costs one wait instead of one per call. A stop, a malformed request and a stream that already started are not switched. The server logs each switch (`[ai] Gemini failed (…); retrying through the Vercel AI Gateway`).
- `gemini` or `gateway`: that service only. With a single key set, `auto` uses that one.
- `AI_GATEWAY_MODEL` defaults to `google/gemini-2.5-flash-lite`: the gateway's free tier serves Gemini 2.5 models only and refuses `google/gemini-3.1-flash-lite` (HTTP 403) until paid credits are added. Gemini 2.5 rejects a thinking level (HTTP 400), so only Gemini 3 models are sent one.
- Errors name the service that failed and what to check (`AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL`, credits); when both fail, the message says so. Token usage and the per-session budget count both services alike.
- Through the gateway, the template text and messages also pass through Vercel; the upload page says so.
- `vercel ai-gateway setup` is not needed: it configures local coding agents, not this app. The app needs only the key in `.env.local`.

**Template analysis (once per session and template, cached).**
- Markers are detected locally first: `{{x}}`, `[X]`, `____`, four or more underlined spaces (a blank line drawn in Word), empty cells of a fill-in table (a table whose value cells hold at least one marker; the field is named after the row and the column, e.g. "Email address (Party A)"), and Word content controls that still show their placeholder text ("Votre nom"). Signature blanks are excluded. A filled underlined blank loses its underline; the model may not write a value into a row's label cell. Boxes bound to the same data, which Word keeps identical, are one field. A box of more than 12 words, or of the same kind (same title) as one, is the template's sample wording; galleries, pictures and check boxes are never fields.
- The model receives *compact* markers and indexed blocks (id + text, not XML). It groups synonyms, discards non-fields, and proposes *implicit* gaps as a **verbatim quote** that must occur exactly once in the named block: either the text before the gap ("the Tenant, of" with nothing after it; the value goes after it) or placeholder wording that stands where the value goes (a line reading "Nom du destinataire"; the value replaces it). Unverifiable claims, and places that overlap a marker or another answer, are dropped.
- Every field has its own label: the model qualifies same-worded blanks ("Adresse postale (expéditeur)"), and a label still shared gets a number.
- Any marker the model doesn't account for still becomes a field, so nothing is silently lost. The model may dismiss a marker as ordinary text (a citation, a cross-reference), but never a `{{variable}}` or an ALL-CAPS `[PLACEHOLDER]`: a live run on Gemini 2.5 through the gateway dismissed `{{date_d_entree}}`, which then went unfilled into the export.
- Oversized templates (more than 2,500 paragraphs or 120k characters) are rejected, never truncated.
- One schema-repair retry at most. Truncation (`finishReason: length`) is detected and nothing is committed.

**Two defects found by live runs and fixed:**
- **Rejected schema.** Gemini rejects `maxItems` on arrays of objects with HTTP 400, so every analysis failed. The caps are now enforced in code.
- **Groupings silently dropped.** Gemini returns marker keys without their `k:` prefix, so every grouping was rejected and each marker became its own field. Keys are now resolved against the real markers.

Neither defect showed up with the mocked model. The SDK's `RetryError` is also unwrapped now, so a lasting 5xx says that Gemini is overloaded or down (and to retry) instead of a generic failure, and unclassified AI errors are logged on the server.

**Three defects found with a Word letter template whose blanks are all content controls, and fixed:**
- **Values written next to the placeholder.** The boxes were not recognised, so the model could only point at the text before a gap, and the value was inserted after the placeholder ("Votre nom Camille Martin"). Placeholder boxes are now markers and are replaced, and the model can mark plain placeholder wording to be replaced.
- **A detail never asked.** Two fields were both called "Adresse postale", and the reply was told only how many details remained. Once one address was answered it took the other for done and said the draft was ready; it also asked for things that are not fields (a subject line, a reference number). Labels are now distinct, the reply gets the remaining details by name and a `READY TO GENERATE` flag, and it may ask only for listed details.
- **An invented date.** "Take today's date" was recorded as a date the model made up. The extraction now receives today's date.

**Four defects found by the live evaluation (`npm run eval:conversation`) and fixed:**
- **An ambiguous date confirmed.** "The lease starts 03/04/2026" was recorded as 3 April 2026 without a question, because the model rewrote the date before the ambiguity check saw it. A date written in figures is now checked as the user wrote it.
- **Placeholder names as labels.** Fields were called "{{tenant_name}}", "LANDLORD NAME" or "monthly_rent", in the chat too. Labels copied from markers are now made readable ("Tenant name").
- **Block ids in replies.** "What happens if the rent is paid late?" was answered with "[word/document.xml#8] Late payments attract…". The reply now receives clause text without ids.
- **A failed reply looked like a lost turn.** When Gemini failed after the answers were recorded, the chat said "Something went wrong" although they were saved, and an overloaded model was reported as an internal error. The chat now says the service is temporarily unavailable, and that the answers were saved.

**Six defects found with a real NDA template and its conversation, and fixed:**
- **A blank line never asked.** "The parties intend to evaluate ____." was drawn with underlined spaces, not underscores, so it was not detected, and the model saw "evaluate ." once spaces were collapsed. Underlined spaces are now a blank.
- **An email written into the label cell.** Party A's email cell was empty. The model could only point at text before a gap, so it quoted the row label and the email went into the "Email address" cell. Empty cells of a fill-in table are now blanks, and a value can no longer be inserted at the end of a row's label cell.
- **A date format ignored.** "Change the format of the date, put 26/09/2026" moved the date but kept "26 September 2026", while the reply said "26/09/2026". A date now keeps the user's figures when they ask for a format; the model's flag counts only if the message really asks for one.
- **"Ready to generate" after the draft existed.** The reply was not told a draft existed, so it offered the Generate button again. It now knows, and says which answers were written into the document and which could not be because that text was edited.
- **Questions out of order.** A field the model found itself was asked last (Party A's email after Party B's). Questions now follow the document within each group.
- **Lower-case names in the contract, and stiff replies.** Names and addresses typed all in lower case ("jane van der berg") are capitalised ("Jane van der Berg"); anything with a capital letter is left as typed. Replies no longer open with "I have recorded…" or "Could you please provide…".

**Each chat turn = exactly two model calls.**
1. **Extraction.** Structured output: `updates[{fieldId, value, currency, evidence}]` plus `clauseBlockIds`. Every update must quote **verbatim evidence from the user's latest message**, or it is rejected; this is the anti-fabrication guard, and a mutation test proves the test suite catches its removal. Values then go through deterministic validation:
   - numeric dates like `03/04/2026` are flagged when both day-month orders are valid;
   - "Rs" and "$" require a currency named by the user or the template;
   - money is an exact decimal string;
   - start and end dates are checked for chronology.

   Only validated updates are committed, *before* the reply streams, so a failed reply never loses answers.
2. **Reply** (`streamText`). It receives only:
   - what was just recorded;
   - what needs clarification;
   - the next group of up to three questions, the other details still needed by name, and whether the draft is ready to generate (it may say so only then);
   - the relevant clause text with its sub-clauses, for "what does this mean / is this usual";
   - the last four messages.

   The model is told to answer only from the clause text, say that the document alone can't establish market practice or enforceability, cite nothing, and return to the interview.

**Other controls:**
- Template text and user messages are wrapped as data, and the system rules forbid following instructions found inside them.
- Server-side counts of requests and tokens per session, with ceilings (`AI_MAX_*`). When a ceiling is reached, the user gets a clear message; this is **not a billing cap**, so set a budget in Google Cloud too.
- The AI SDK retries transient errors (`maxRetries: 2`, with backoff). Invalid keys, unavailable models and quota exhaustion are classified and shown clearly.
- Cancellation (the Stop button or a client disconnect) propagates into the SDK call via `AbortSignal`.
- The contract itself is never generated by the model. Filling is deterministic.

## Bonuses

The shared basis is a **stable paragraph identity** (`w14:paraId`, assigned deterministically at draft generation and kept by the editor). A spike showed it survives browser edits and repeated save/reload. See [ADR-002](ADR-002-bonuses.md). It lets the server find a template paragraph again in a hand-edited draft. That makes answer corrections follow paragraphs even after the user inserts text; before, they became conflicts.

### 1. French and mixed English/French templates
- **Detection.**
  - *Markers:* accented placeholders such as `{{nom_du_client}}`, `[NOM DU LOCATAIRE]`, `[date de début]` and `[TAUX D’INTÉRÊT]` are detected, including placeholders split across runs. Grouping keys ignore accents and case.
  - *Language:* each paragraph gets `en`, `fr` or an explicit `unknown` from a deterministic word/accent scorer (no LLM). The template gets `en`, `fr`, `mixed` or `unknown`, stored with the draft.
- **Equivalent occurrences.** `[TENANT NAME]` and `[NOM DU LOCATAIRE]` become one field only when the (single, cached) analysis says they are the same value; without AI they are never merged. Field ids are English and language-independent. A French/English keyword heuristic types unmarked fields, using whole words (so "employer" is not read as French *loyer*).
- **Values.** Values are stored canonically: ISO date-only, or an exact decimal string plus ISO currency. They are rendered per occurrence:
  - *English:* "1 October 2026", "EUR 1,250.50".
  - *French:* "1 octobre 2026", "1 250,50 EUR" (non-breaking spaces).

  Names, addresses and identifiers are written exactly as given.
- **Parsing and ambiguity.**
  - `1er octobre 2026` and `1 250,50 EUR` are parsed exactly.
  - A single separator followed by three digits (`25,000`) is accepted only when the language context settles it (thousands in English); otherwise the user is asked.
  - Numeric day/month ambiguity (`03/04/2026`) is always asked.
  - Currency is never inferred from language; "Rs", "$" and "roupies" still need a named currency.
- **Conversation.** The conversation follows an explicit **Auto / English / Français** choice (stored with the draft), else the user's last confident message language, else the template's. French or mixed answers are accepted whatever language the question was asked in. Switching language posts a deterministic confirmation in the new language and re-asks nothing. The contract is never translated; clause explanations quote the clause in its own language.

### 2. Conditional clauses
**Supported template syntax** (documented here, not shown in normal prompts). Each marker is alone in its own paragraph in the main text:

| Marker | Clause included when |
| --- | --- |
| `[[IF name]]` … `[[END IF]]` | the yes/no answer `name` is yes |
| `[[IF NOT name]]` | it is no |
| `[[IF name = value]]` | the text answer equals `value` (case- and accent-insensitive) |
| `[[IF name IN a, b]]` | it equals one of the values |
| French: `[[SI name]]`, `[[SI NON name]]`, `[[FIN SI]]` | same |

**What is rejected, never guessed:** nesting, unpaired markers, inline markers, markers in tables, headers or footers, and unsupported syntax. Each is reported in the clause summary and before export, and the marker is left as text. Everything between the markers (paragraphs and whole tables) is the clause. The marker paragraphs never appear in a draft.

**Rules come from the template, or from the user.** The model may *propose* a rule only where the template itself says a clause is optional in ordinary wording. It must quote verbatim evidence and give valid boundaries, and the rule applies only after the user clicks *Make it conditional*. The model never decides that a clause is appropriate or enforceable.

**Evaluation** is deterministic:
- **Included** or **excluded**, with the reason (e.g. "Employee is senior = No").
- **Undecided**: an unanswered or unclear answer is never read as "no". An undecided rule blocks generation, but not saving.
- **Explicit overrides** ("Always include/exclude") are persisted and shown.
- **Fields that only live in an excluded or undecided clause** are neither asked nor blocking. Their answers are kept for later.

**In the document:**
- *Exclusion* removes the clause's elements from the actual DOCX, which is then saved and exported. `numbering.xml` is untouched, so Word renumbers.
- *References:* plain-text references in both languages ("clause 4", "article 4") are rewritten when the clause they point to is renumbered. A reference to the removed clause itself is reported, and export asks for confirmation.
- *Inclusion* restores the clause once, with its formatting and current answers.
- *Hand edits:* if the lawyer edited the clause, removing it needs explicit confirmation. The edited version is stored and comes back if the clause is re-included.
- *Idempotence:* repeating the same decision changes nothing.

### 3. Compare (read-only diff)
The **Compare with template** tab sits beside the draft and compares the immutable template with a snapshot of the current draft. When the editor is open, the snapshot is its current content, including edits made a second ago; it is sent for comparison and **not saved**. Before any draft exists, a preview of the draft the current answers would produce is used.

The comparison shows:
- word-level additions and removals;
- which placeholders were filled;
- excluded clauses, with the reason, and the removed condition markers;
- table changes by table, row and column;
- bold/italic/underline, paragraph-style, heading-level and list-level changes.

**Coverage boundary:** fonts, sizes, colours, spacing, alignment, borders, images and page layout are **not** compared. This is a content and structure comparison, not a pixel comparison.

**Guarantees:**
- Serialization differences (run splitting, namespace order, generated ids) produce no changes, because structured blocks are compared, never XML.
- Accents, digits and punctuation are compared exactly.
- Diff decorations exist only in the page; the edited and exported DOCX never contain them (tested).
- The comparison makes no model call and is not cached (it takes milliseconds).

### 4. Saved drafts and resume
**Access.**
- **Identity:** drafts belong to the browser's anonymous identity. It is an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production) holding a random 256-bit secret; only its SHA-256 is stored.
- **Ownership:** every route (list, read, rename, delete, copy, compare, clause actions, chat language, generation, export) checks ownership. A draft id alone grants nothing.
- **Retention:** `DRAFT_RETENTION_DAYS`, default 30, after the **last successful save**.
  - The cookie's max-age and the session's database expiry equal the retention period and slide together on authorised activity (refreshed at most hourly).
  - Expired drafts are never served, even before `npm run db:cleanup` removes them.
- **Honest limit:** reopening the **same browser profile** within retention restores access. Cleared cookies, a private window or another device will not. There are no public resume links and no account recovery.

**The authoritative saved state** is the working DOCX (content, tables, numbering, headers/footers, manual edits) plus field state (answers, anchors, rules, removed clause variants, references, language metadata, chat language), the finalized messages, title and timestamps. The workflow phase is derived from these. Restoring re-derives anchors from paraIds and makes **no model call and no regeneration** (tested with a counting mock).

**Saving.**
- Answers and conversation turns are saved as they happen.
- Editor autosave runs 1.5 s after typing stops, and at least every 10 s during continuous typing. **Save now** flushes immediately.
- The header shows *Saving… / Saved at HH:MM / Unsaved changes / Could not save*; a failed save also shows a banner with *Try again*. "Saved" is shown only after the server confirms that exact revision.
- A server-side change to the draft writes document and state in one statement.

**Other tabs and failures.**
- If another tab saved a newer version, the local edits stay in the editor, and you choose *Load the newer version* or *Save mine as a new draft*.
- A save that fails keeps the edits in the editor, says so, and blocks export rather than falling back to an older file.
- Leaving a draft or starting a new template saves pending edits first.
- A best-effort save runs when the tab is hidden; nothing is promised if the browser is closed abruptly.
- An interrupted generation is shown as interrupted, with *Retry generation*; the last consistent draft is kept.

**The Saved drafts drawer** (header, or "Open a saved draft" on the upload page) lists each draft with its title, last save time, phase, template language, the details and decisions still needed, and its "kept until" date. A row opens the draft; Rename and Delete (with confirmation) are in the row's menu.

## Interface and themes

**Layout.**
- *Upload screen:* one column with a short title and sentence, the drop area with the real limits (one .docx up to 5 MB) and the blank formats it detects, a link to saved drafts, the synthetic examples as a plain list, and a "What happens to your file" disclosure. Each example can be used in one click (the page fetches the bundled synthetic file and uploads it like a chosen file) or downloaded.
- *Workspace:* a 56 px bar with the document name and save status, the secondary actions (Save now, Saved drafts, New template), the theme control and one primary action for the state: **Generate draft** before a draft exists (disabled, and described by the status line, until everything needed is answered), then **Download Word file**.
- *Assistant column* (380–480 px) with **Chat / Details / Clauses** tabs, and the document on a canvas beside it. Below 1024 px one region is shown at a time (Chat, Details, Clauses, Document) and the secondary actions move to a *More actions* menu; below 900 px the page is scaled to the width of the screen.
- *State:* panels stay mounted and are hidden with `visibility`, so switching tabs, views or theme keeps unsent text, scroll positions, the editor instance and its undo history. Each region has a single scroll container.

**Counts.** Details count the required details that apply now. A yes/no answer that decides an undecided clause counts once, as a **decision**. The header reads, for example, "12 details and 1 decision still needed"; before, it said "8 items" while the chat said "7 items", because the deciding answer was counted twice.

**Chat.**
- The column is headed **Drafting assistant** with the reply language. Replies render as they stream, with paragraphs, lists and bold, and without entrance animations or a typing caret; a working indicator shows only while a request is pending, and Stop aborts it.
- The transcript follows new content only while you are at the bottom. Otherwise **Jump to latest** appears, marked when something new arrived.
- A failure appears inline with **Retry**. Retrying does not add the message twice, on screen or in the database: the server keeps a single copy of an identical message that was never answered (integration-tested). A message blocked before sending, for example by an unsaved editor edit, goes back into the composer.
- "N details updated" appears under a reply only when that turn validated and saved field changes.
- Enter sends and Shift+Enter adds a line; nothing is sent while an input method is still composing.

**Dialogs and export.** Themed confirmation dialogs replace `window.confirm` (regenerate, leave with unsaved edits, new template, delete, export warnings). The download is fetched first, so a failed export shows an error with *Try again* instead of replacing the page.

**Open in Word** sits next to Download once a draft exists (in *More actions* on small screens). It hands the saved draft to Word on this device through Word's own `ms-word:` link scheme. Word fetches the file itself, without the browser's cookie, so the server issues a link to that draft only, valid for five minutes and signed with the session's secret hash: it stops working when the session ends, and a changed or expired link is simply not found. Word opens a read-only copy, and Save As keeps it. The same save-first step and open-issue warnings as Download run before the link is made. The browser's own "open this app?" message cannot be replaced or suppressed by a page (it guards against sites launching programs), only allowed for good with its "always allow" box, so the first time the app's own dialog says so; later clicks go straight to Word. A managed browser can pre-allow it with the `AutoLaunchProtocolsFromOrigins` policy.

**Design system.**
- Semantic colour tokens (`--lx-*` in `src/app/globals.css`) with one set per theme, exposed to Tailwind v4 through `@theme inline`: warm neutrals with near-black ink in light mode, charcoal layers in dark mode, ink-coloured primary buttons, and one muted teal accent for links, focus, the brand mark and the drop state. Status colours have separate light and dark foreground, surface and border values, and are always paired with text or an icon. Every text pair is at least 4.5:1 and every input border 3:1, in both themes.
- Type scale tokens: 13 px metadata, 14 px interface, 15 px reading (chat, excerpts), 17 px panel titles, 30 px page title. Radii 6 px (controls), 10 px (callouts, drop area), 12 px (dialogs). Shadows only on overlays and the document page.
- Type: Source Sans 3 for the interface and Source Serif 4 for the upload title and legal text (source excerpts, comparison). Both are self-hosted by `next/font`, downloaded once at build time; the browser never contacts a font service.
- Icons: `lucide-react` (ISC licence) at one 1.75 stroke, only where an icon names an action or a status.
- Motion: 120–180 ms on controls and 180–240 ms on drawers and dialogs (`@starting-style`); no entrance animations on content, and loops only while something loads. `prefers-reduced-motion` makes animation instant.

**Screenshots** (synthetic fixtures; `docs/screenshots/`): before, [upload](screenshots/ui-before-upload.png) and [workspace](screenshots/ui-before-workspace.png); after, the upload screen in [light](screenshots/ui-upload-light.png) and [dark](screenshots/ui-upload-dark.png), the [draft](screenshots/ui-draft-dark.png), [clauses](screenshots/ui-clauses-dark.png) and [saved drafts](screenshots/ui-drafts-dark.png) in dark, [Compare](screenshots/ui-compare-light.png) in light, and a [phone draft](screenshots/ui-phone-draft-dark.png). The two chat screenshots ([desktop](screenshots/ui-chat-light-stubbed-stream.png), [phone](screenshots/ui-phone-chat-dark-stubbed-stream.png)) use a **stubbed** chat stream, because Gemini was unavailable; their opening message shows the markers-only mode the server was in.

**Themes.**
- *Light, Dark and System* (the default). The choice is stored in `localStorage` under `lx-theme`; only the preference is stored, never document content. System follows later OS changes; an explicit choice ignores them. If storage is blocked, the choice still applies to the open page.
- *No flash:* an inline `<head>` script sets `data-theme` and `color-scheme` before the first paint, the approach in Next's "preventing flash before hydration" guide. `suppressHydrationWarning` is set on `<html>` only, because the script changes that element's attributes. A layout effect re-applies the theme after React's development remount.
- Switching cross-fades the whole page once through the View Transitions API (180 ms). The fade is skipped under reduced motion and where the API is missing.
- *The document stays paper.* SuperDoc's chrome is themed only through its documented hooks: the `--sd-ui-*` and `--sd-ui-loader-*` variables and the `uiDisplayFallbackFont` option. The page colour cascades from `--sd-ui-bg` by default, so it is pinned to white. The page's own fonts, colours and layout are never touched, and no CSS filter or inversion is used. SuperDoc's right-click menu has fixed colours and no variables, so its own classes are overridden (chrome only). Switching theme fetches, saves and remounts nothing, and the export is identical in both themes (browser-tested).

## Streaming

A typed SSE protocol (`src/features/documents/contracts/stream-events.ts`, encoded by `src/server/http/sse.ts`, decoded by `src/lib/sse.ts`):
- **Event types:** `fields_updated`, `assistant_delta`, `assistant_done`, `draft_patch`, `draft_started`, `draft_block_ready`, `draft_complete`, `error`.
- **Delivery guarantees:** every event carries a request id and sequence number. The decoder handles frames and multi-byte UTF-8 split across chunks (unit-tested). The client ignores events from any other request.
- **Draft generation:** fills and yields **paragraph by paragraph** in document order (`fillAndRender`), yielding to the event loop between blocks. Over HTTP, against the production build, the lease produced 19 separate network chunks, the first block at ~19 ms and completion at ~76 ms. Filling is deterministic and fast, and it is deliberately not slowed down.
- **Preview vs editor:** the preview is rendered from those same filled OOXML blocks. When `draft_complete` arrives, SuperDoc opens the persisted bytes of exactly that revision, and editing is enabled only then.
- **Cancellation:** cancelling mid-draft restores the previous state and never marks a partial draft complete (integration-tested).
- **Switching drafts mid-stream:** a reply or generation still streaming when another draft is opened finishes on the server for its own draft. Its events never reach the draft opened meanwhile (browser-tested).
- **Chat latency (live, Gemini healthy, 25 September 2026, 12 turns):** the answers are recorded and shown before the reply starts (median 2.6 s). The reply's first words came after a median of 4.3 s (3.4–5.0 s, one French turn 11.5 s), and a whole turn took a median of 4.5 s. During the 24 September overload the median first word was 12.3 s, pushed up by the SDK retrying 503s (one turn waited 186 s); in `auto` mode the gateway now answers instead, and Gemini is skipped for a minute after a failure (first words 1.9 s through the gateway).

## Persistence, sessions, caching

- **Sessions.** A 256-bit random secret in an `HttpOnly; SameSite=Lax` cookie (`Secure` whenever `APP_URL` is https; Safari refuses Secure cookies on plain http://localhost); only its SHA-256 is stored. Every query is scoped by session id, so a document id alone grants nothing. Mutations check `Origin`, and there is a CSP. Session creation is rate-limited per IP.
- **Revisions.** Field updates use `fieldsVersion`; editor saves use `workingRevision`. Both are optimistic, so a stale write gets a 409 and is never silently overwritten.
- **Answer changes after drafting.** They are pushed into the draft only where the previously inserted value (or the still-unfilled marker) is exactly at its anchor. Anchors are located by paragraph id, so edits elsewhere no longer cause false conflicts. Anything the user edited is reported as a conflict, and their edit is kept (integration-tested). A full regenerate requires explicit confirmation.
- **Cookie and database expiry** slide together: `DRAFT_RETENTION_DAYS`, default 30 (see [Saved drafts](#4-saved-drafts-and-resume)). Deleting a draft also drops its cached template analysis unless another of your drafts uses the same template.
- **Neon.** The serverless driver over WebSockets, which supports the transactions used; when `DATABASE_URL` is localhost, plain `pg` is used with the same Drizzle schema and queries. DOCX bytes live in `bytea`: fine for ≤5 MB templates at this scale, but a larger deployment should move them to object storage. Retention: `npm run db:cleanup`.
- **Upstash Redis — what is actually cached:**
  - parsed template blocks: `lx:blocks:{session}:{sha256}:{parserVersion}`, 6 h;
  - validated template analyses: `lx:analysis:{session}:{sha256}:{parserVersion}:{promptVersion}:{model}`, 24 h.

  The parser and prompt versions were bumped for the bonuses, so older cached analyses are not reused.

  Keys are **session-scoped**, so identical files in different sessions never share private data (tested). Chat is not cached. Payloads are capped at 256 KB, and no DOCX bytes ever go to Redis.

  Short atomic `SET NX` locks with compare-and-delete release deduplicate concurrent analysis/draft requests (tested: one of two parallel drafts gets `busy`). Sliding-window rate limits apply to session creation, uploads and AI turns.

  If Redis fails, cache reads count as misses and work proceeds (tested with a failing store). Locks and limits fail closed in production.
- **HTTP caching.** All private responses are `Cache-Control: private, no-store`.

## Verification

Labels: **mocked** = the language model is a test double; **live** = real Gemini; **browser** = a real headless browser (Chromium unless stated) against a production build; **Word** = Microsoft Word 16 on Windows.

| Evidence | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:cycles`, `npm run build` | Pass (strict, no `any` or assertions, layer rules respected, formatted, no import cycles). The refactor's own checks are listed in [docs/ARCHITECTURE.md](ARCHITECTURE.md#verification) |
| Unit tests (57). *AI fallback:* an overloaded Gemini answered through the gateway with the gateway model's own thinking options, a stream switched, Gemini skipped for a minute after a failure, no switch on a stop or a malformed request, both failures reported together, gateway errors named with what to check; a `{{variable}}` or ALL-CAPS `[PLACEHOLDER]` the model dismissed still becomes a field (fails without the fix). *Word features:* a template with a picture, a footnote, a comment, tracked changes, a text box and a table of contents is filled, the placeholder in the text box too, and every other part stays byte for byte. *Live-evaluation fixes:* a date written in figures is checked as the user wrote it, labels copied from markers become readable, the reply sees clause text without block ids, an overloaded model is reported as unavailable. *Refactor:* the save coordinator (edits coalesced, no false "saved" after an edit made during a save, a conflict keeps the edits, the maximum wait), and the workspace status (details and clause decisions counted apart, ready state, save state, export warnings). *Placeholder boxes:* detection, one field for bound boxes in body and header, sample wording and galleries left alone, the box title as the label of Word's generic prompt, replacement in body and header with the placeholder flag, binding and grey style cleared, unanswered boxes kept; placeholder wording replaced and overlapping places refused; distinct labels; the reply prompt names the details left, asks at most three, and says when the draft is ready. *Interface:* reply formatting (paragraphs, lists, bold, amounts left alone) and theme resolution. *Core:* package validation, indexing and numbering labels, split runs, escaping, headers, safe edit order, stale anchors, dates/money, SSE decoding (including a malformed frame). *Bonuses:* EN/FR detection, French dates/amounts and separator ambiguity, per-occurrence rendering, accented and run-split French markers, unprefixed model keys, the rule grammar with rejected nesting/unpaired/inline/table markers, yes/no/unknown evaluation, inactive fields, model-proposed rules, exclusion and restoration on a real DOCX (renumbered and dangling references, untouched `numbering.xml`, idempotence), confirmation before removing an edited clause and restoration of the edited variant, answering into a restored clause, and the diff (word level, accents/amounts, repeated paragraphs, table cells, bold and list level, run-split noise, reverting, no markup in the DOCX) | Pass |
| Integration tests (24, real PostgreSQL, **mocked** model). *Word links:* the link serves the saved draft's exact bytes; a forged, other-draft, malformed or expired link, and a link asked for by another session or before a draft exists, are all refused. *Live-evaluation fixes:* a turn whose reply fails keeps its answers and says so. *Placeholder boxes:* a chat answer given after drafting replaces its box in the working draft. *Interface:* a message retried after a failed turn is stored once. *Core:* the original 12. *Bonuses:* bilingual lease answered in French, then switched to English with no model call and nothing re-asked; export with per-language dates/amounts and untouched clause wording; separator ambiguity; conditional yes/no/unknown, overrides and restore-once; edited clause confirmation and restore; drafts list/rename/copy/delete with cache invalidation; another identity denied on every operation; resume with zero model calls and no duplicate messages; interrupted generation; stale second-tab save; comparing unsaved content without saving it; expiry and cleanup; Redis outage | Pass |
| Mutation checks. *Core:* removing the evidence guard or session scoping makes tests fail. *Bonuses:* forcing English rendering, and disabling inactive-field logic, each fail a test. *Interface:* disabling the retry de-duplication fails its test. *Placeholder boxes:* keeping the binding or the grey style, finding no boxes, dropping the sample-title rule, label numbering or replace mode, giving the reply a count instead of names, or asking four at once: each fails a test (8 of 8) | Confirmed |
| HTTP smoke test on the production build (`tests/smoke/http-smoke.mjs`, markers-only) | *Core:* fake file 422, cross-origin 403, no cookie 401, stale save 409, `no-store`, attachment headers, incremental SSE (27 chunks, first block at 33 ms). *Bonuses:* another session gets 404 on every route, including resume, rename, language, delete, compare, copy and clause actions; cross-origin delete 403; no-cookie drafts list empty |
| **Browser** E2E (`flow.spec.ts`): heading, italic paragraph, table cell, list level, bold and undo edits; immediate download; XML inspection; no off-origin requests; mobile 390 px and tablet 820 px: the page is scaled to the screen, nothing scrolls sideways and a tap edits where it lands; Compare and the Saved drafts drawer fit too | 4/4 pass |
| **Browser** E2E (`word-exports.spec.ts`): every fixture answered, generated, round-tripped through the editor and downloaded, for the Word check | 7/7 pass |
| **Browser** E2E on **Firefox 155** and **WebKit 26.6** (`E2E_BROWSERS=firefox,webkit`): every markers-only spec (flow, drafts, controls, theme, chat) | 13/13 on each. WebKit found that the session cookie was `Secure` on plain http://localhost, which Safari refuses; fixed |
| **Word** (`npm run check:word`): 22 documents (7 templates, their filled drafts and editor round trips, and the lease edited in the browser). Opens without repair; paragraph styles; live numbering and bullets; fonts, alignment, indents and spacing; bold/italic/underline; tables; headers and footers; margins and page size; notes, comments, tracked changes, pictures, text boxes and tables of contents; each answer takes its placeholder's formatting (49 compared); no placeholder left; the editor round trip changes nothing; the browser edits are there, with Word's own renumbering | 86 checks, 0 failed. Seven deliberately broken exports (a lost heading style, comment, list number or margin, an unbolded answer, a placeholder left, a corrupt file) were each caught |
| **Browser** E2E (`drafts.spec.ts`), markers-only, written before the client refactor: open another draft, rename the open one and delete another; a second tab's stale save is detected and the newer version loads; a reply that finishes after switching drafts leaves the draft opened meanwhile untouched; a lost session returns to the upload screen and the previous session's drafts are never shown | 4/4 pass |
| **Browser** E2E (`flow.spec.ts`, Chromium, Firefox, WebKit): *Open in Word* hands Word an `ms-word:ofv|u|` link; fetched without the cookie it returns exactly the downloaded bytes, HEAD works, and a changed link is 404. **Word** 16 on Windows opened such a link from the app in WSL: `synthetic-residential-lease - draft.docx`, read-only, 26 paragraphs, answers filled, no placeholder left | Pass (25 September 2026) |
| **Browser** E2E (`controls.spec.ts`): a letter whose blanks are placeholder boxes, answered in the Details panel → draft → an edit in the editor → immediate download. Every answer is where its placeholder was, in the body and the header, no placeholder wording is left, and filled boxes are neither placeholders nor bound after the editor's own export | 1/1 pass |
| **Browser** E2E (`theme.spec.ts`): system theme applied before the first paint; explicit choice survives a reload and ignores OS changes; System follows them; no hydration warnings. In a workspace, switching theme keeps unsaved input and the editor instance, fetches and saves nothing, keeps the page white, and the exported `document.xml` is identical in both themes | 2/2 pass |
| **Browser** E2E (`chat.spec.ts`), with the chat **stream stubbed in the browser** (it says nothing about the model): working indicator, inline failure, retry without a duplicate message, "details updated", list formatting; a reader who scrolled up is not moved, and Jump to latest works | 2/2 pass |
| Scripted interface checks (run for this change, not committed as tests): contrast of every visible interface string in both themes across upload, chat, details, clauses, compare, drawer, menu and dialog states (all at least 4.5:1, or 3:1 for large text, after two fixes; disabled controls included); keyboard (tab arrows, Home/End, dialog focus trap and return, menu focus and Escape); reduced motion; widths 360, 390, 768, 820, 1024, 1366 and 1600 px and a 844 × 390 landscape phone, with no horizontal page overflow; the dev server shows no hydration or script warnings in either theme | Pass |
| **Browser + live** E2E (`bonuses.spec.ts`), the integrated scenario from the brief. Steps: bilingual employment template answered in French → non-compete included → table-cell and paragraph edits → Compare shows the unsaved edits → Save now → browser closed and reopened with the same profile → resumed → chat switched to English → "not senior" through the live model → confirmation because the clause was edited → removed → Compare shows "Excluded: Employee is senior = No" → export. Checks on the exported DOCX: clause gone, edit gone with it, table edit kept, per-language dates, "clause 3" renumbered, no `[[` markers, no diff markup, numbering definitions intact | Pass: on the build before the interface redesign (2 of 2 runs), and again on the refactored build on 24 September 2026 (35 s) |
| Live Gemini: `npm run smoke:gemini`; analysis of the bilingual template merges each EN/FR pair (10 fields, none rejected, on repeated runs) | Pass |
| **Live** Vercel AI Gateway, free tier (24 September 2026): `npm run smoke:gateway`; upload and a chat turn with `AI_PROVIDER=gateway` (analysis ran, three answers saved, first words 2.0 s); `auto` with Gemini answering 503: the gateway answered, first words 1.9 s with the one-minute skip (12.7 s before it); `auto` with a wrong Gemini model name: all three calls switched; `bonuses.spec.ts` end to end through the fallback | Pass. The first gateway replies copied the prompt's section labels ("JUST RECORDED: …"); the reply prompt now forbids that, and the next replies were plain sentences |
| **Live** conversation evaluation (`npm run eval:conversation`), after the NDA fixes on 25 September 2026 with `AI_PROVIDER=gemini`: thirteen cases, 16 turns. Added cases: a name typed in lower case, a date then a request to write it in figures, and a template with a blank drawn as underlined spaces and an empty table cell. A separate live check generated a draft, then asked for the date in figures: the change was written into the draft and the export, and the reply said so without offering to generate again | Every expectation held (21 of 21). The first run of the new cases showed the model setting the format flag when no format was asked, and replies still opening with "I have recorded"; both were fixed and the run repeated. Median first reply word 5.4 s |
| **Live** conversation evaluation (`npm run eval:conversation`), re-run after the fixes on 25 September 2026 with `AI_PROVIDER=gemini` (Gemini only, no fallback): all ten cases, 12 turns, including the instruction inside the template | Every expectation held (16 of 16). No answer took the injected value; `03/04/2026` and `$5000` were held for clarification, not guessed; "today" became 25 September 2026. Median first reply word 4.3 s, median turn 4.5 s; about 3.4k input and 1.2k output tokens per single-turn case |
| **Live** conversation evaluation (`npm run eval:conversation`), first run: 9 cases, 11 turns, while Gemini was intermittently overloaded. Casual message with three answers, ambiguous date and its clarification, correction, unknown answer, clause question, instruction in a message, ambiguous currency, "today", French answers | 12 of 14 expectations held. The two failures and two faults seen in the replies are the four defects above, fixed with tests. Per case: analysis plus 2 requests per turn, about 3.3k input and 1.2k output tokens |
| Live Gemini on a real Word letter template with content controls (the reporter's own file, not committed): 10 fields with distinct labels, each replacing its box, the closing and attachment boxes kept as text. A replay of the reporter's conversation with the new prompts asked for every field, including the sender's address skipped before, asked for nothing else, recorded "take today's date" as the current date, and said the draft was ready only after the last answer | Pass (24 September 2026) |

**Not verified (be aware):**
- **Microsoft Word beyond Windows:** the Word check ran Word 16 on Windows, with a French interface (style names are compared as that Word reports them). Word for Mac, Word on the web and older versions were not run, and page layout was compared by eye on the PDFs Word printed, not pixel by pixel.
- **Live model breadth:** besides the full scenario, the live evaluation has thirteen cases, a small set. Nine ran before the fixes during an overload, and all ten ran again after them with Gemini healthy, once each. The model's *proposals* of conditional clauses from ordinary wording were validated only with a mock; the fixtures contain no such wording.
- **Neon and Upstash under load:** Neon was migrated and serves the dev app, and Upstash answered a ping. Locks and rate limits against Upstash were not load-tested; the test server ran without Redis.
- **Other toolbar actions:** italic, underline, bullet/numbered list toggles, table insert, zoom and the heading-style picker were not individually exercised.
- **Employer templates:** not available.
- **Screen recording:** not made (no recording tool here); [WALKTHROUGH.md](../WALKTHROUGH.md) has the script.
- **Other browsers and assistive technology:** Chromium, Firefox and WebKit ran headless in Playwright on Linux. Safari itself on macOS and iOS, and real screen readers (NVDA, VoiceOver), were not tested; the accessibility checks above are DOM-level.
- **Phone keyboards:** `interactive-widget=resizes-content` keeps the composer above the on-screen keyboard in Chrome for Android; iOS Safari was not tested on a device.

**Manual Microsoft Word checklist** (download a draft, then open it in Word; `npm run check:word` checks every item automatically on Windows):
1. Opens with no repair prompt.
2. Heading 1/2 styles are applied (check the Styles pane).
3. Clause numbering is live (1 / 1.1 / 1.1.1). Press Tab on a clause and confirm it renumbers.
4. Bullets and table borders are intact.
5. The header shows the reference and the footer shows the page number.
6. Margins match the template (Layout → Margins).
7. Georgia is used.
8. Inserted values carry the surrounding formatting.
9. Browser edits are present.

## Known limitations and trade-offs

- **Word for the web:** not offered. Word for the web can only open a file that Microsoft's servers can reach (a public HTTPS address, read-only through Microsoft's viewer) or one stored in OneDrive (a Microsoft sign-in and an app registration). Neither is possible on `localhost`, so *Open in Word* targets Word installed on the device (Windows, macOS, and the mobile Word apps).

- **Implicit fields:** these depend on the model. Without AI only explicit markers are found, and English/French equivalents are **not** merged (safe, but you are asked twice). Underscore blanks are always offered as low-confidence fields, and the user can dismiss them ("Not a field").
- **Placeholder boxes without AI:** in markers-only mode, a short box of sample wording that shares no title with the letter body (e.g. "Cordialement") becomes a field; it can be dismissed ("Not a field"). A box of more than 12 words, one holding several paragraphs or a line break, and galleries stay as they are.
- **Relative dates:** "today" is the server's calendar date, so near midnight a user in another time zone can get the neighbouring day.
- **Language detection** is a word/accent scorer for English and French only. Short or balanced paragraphs are `unknown`; there, values are rendered in the template's dominant language (English if mixed).
- **Clause references:** only plain-text "clause/article/section/paragraph N" references are kept in line. References to other instruments ("section 3 of the Companies Act") are skipped. Word REF fields that point into a removed clause are reported, not rewritten.
- **Moved paragraphs:** a paragraph cut and pasted in the editor gets a new identity, so answers there become conflicts and the comparison shows it as removed plus added.
- **Clause restore:** needs one of the clause's original neighbours to still exist. Clauses containing section breaks, or relying on images or links the editor dropped, are refused with an explanation.
- **Comparison coverage:** text, bold/italic/underline, styles and heading/list levels only (see [Compare](#3-compare-read-only-diff)).
- **Resume:** same browser profile within retention only; no accounts, no cross-device recovery.
- **Undo granularity:** follows the editor's (ProseMirror-style) grouping. Rapid typing is undone as a unit.
- **Phones:** below 900 px the page is scaled to the width of the screen, so the whole page shows but its text is small; the toolbar's zoom goes back to the true size, which then scrolls inside the canvas.
- **Footnotes and comments:** placeholders inside them are not detected (body, headers, footers and text boxes are).
- **Other blank styles:** blank lines drawn with underlined tabs or tab leaders, and dotted lines ("........"), are not detected. Underscores, underlined spaces and empty cells of a fill-in table are.
- **Rupee amounts in chat:** an amount given in chat as “MUR 25,000” is written “Rs 25,000”, the usual Mauritian notation; typed in the Details panel, it stays as typed.
- **After a draft exists:** answers change through the chat, so that anchored patching applies; the Details panel is locked with an explanation. Clause decisions change through the clause summary.
- **Clause explanations:** informational only, from the document text. There is no legal research.
- **AI analysis failures:** a failed analysis leaves the draft in markers-only mode; re-upload to retry.
- **Editor loading:** SuperDoc shows its own loading card (with its real progress) over the app's paper placeholder while a document opens.
- **SuperDoc upgrades:** the right-click menu override uses SuperDoc's class names, and may need updating when SuperDoc is upgraded.
- **Fonts at build time:** `next/font` downloads the two fonts during `next build`, so a build without network access fails; commit local font files if that matters.

## With another week

1. Run the employer's templates through the Word check and the live evaluation, grow the evaluation set (more messy answers, rule proposals), and tune prompts and thinking level with the measured token costs.
2. Commercial-licence decision on SuperDoc, or evaluate an alternative editor, re-using the same OOXML filling layer.
3. Run the Word check in CI on a Windows runner with Word, and add fixtures with floating pictures, modern text boxes, endnotes and cross-reference fields.
4. A "Retry AI analysis" action for drafts created while the model was unavailable.
5. Object storage for DOCX bytes, a scheduled retention job, and observability for token spend.
