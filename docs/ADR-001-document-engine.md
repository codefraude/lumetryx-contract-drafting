# ADR-001: Document engine

**Status:** accepted.

## Context
Formatting fidelity is weighted most heavily. The editor must round-trip real legal multilevel numbering, tables, headers/footers and styles without flattening.

## Decision
- **Filling:** our own OOXML code (`jszip` + `@xmldom/xmldom`) that changes only `w:t` text, anchored by part + paragraph ordinal + expected text.
- **Editing and export:** SuperDoc 2.17 (OOXML-native) in the browser.

## Evidence
A spike ran *before* any UI was built, using SuperDoc's headless SDK. It made three edits (a heading, a list level 1.1.2 → 1.2, a table cell), then exported and reopened the document.
- **Preserved:** margins, header/footer references, numbering definitions, fonts and escaping.
- **Correctly changed:** numbering renumbered to match the new list level.
- **Visual check:** LibreOffice renders of the original and the export matched.

Later browser E2E tests repeated this through the real UI.

## Consequences
- **Licence:** SuperDoc is AGPL-3.0. Proprietary use requires a commercial licence.
- **Behaviour we inherit:**
  - empty footnote/endnote parts are dropped on export;
  - undo grouping follows the editor;
  - fit-width zoom is unreliable in editing mode, so the page is not scaled on phones.
- **HTML editors rejected:** they flatten numbering.
