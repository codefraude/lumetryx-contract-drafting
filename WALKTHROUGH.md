# Walkthrough script (≤ 5 minutes)

This is a script for the recording; **the recording itself has not been made yet.**
- **Needs:** `GEMINI_API_KEY`.
- **Template:** `public/examples/synthetic-bilingual-employment.docx` (synthetic; English/French, with a conditional non-compete).
- **Optional:** use the employer's templates if available.

1. **0:00 Upload (25 s).** Drop the template. Point out:
   - the real numbering, header and table;
   - the Assistant header with *Auto / English / Français* and "Bilingual template";
   - the header status "… details and 1 decision still needed", and the *Clauses* tab marked 1 (the non-compete is undecided);
   - under *Details*, each English/French pair counts as one field.
2. **0:25 Answer in French (40 s).** Type: *"L'employeur est Lumetryx Ltée et la salariée est Hélène Dupré-Lefèvre. Elle commence le 1er octobre 2026, salaire annuel 48 000 EUR. Oui, elle est classée senior."* Show:
   - several fields confirming at once;
   - the reply streaming **in French**;
   - "N details updated" under the reply, and the *Clauses* tab turning to **Included** (Employee is senior = Yes);
   - the non-compete's own fields now being asked.
3. **1:05 Finish answers (20 s).** Answer the rest in the chat, or use *Details* for one field.
4. **1:25 Streaming draft (15 s).** Click *Generate draft*. Paragraphs appear as they are filled. The `[[IF]]` lines are gone, and English/French paragraphs show "1 October 2026" and "1 octobre 2026".
5. **1:40 Edit (30 s).**
   - Add "(gross)" to the salary table cell.
   - Add a sentence to the non-compete paragraph.
   - Outdent a sub-clause with the toolbar.
   - The header shows *Unsaved changes*, then *Saved at HH:MM*.
6. **2:10 Compare (30 s).** Open *Compare with template* immediately, without waiting for the save. Show:
   - the change count;
   - filled placeholders ("Filled: …");
   - the table cell by row and column;
   - "List level 3 → 2";
   - that the unsaved sentence is included (the note says so);
   - *Next change* navigation.
7. **2:40 Save and resume (35 s).**
   - Click *Save now*, then close the browser window.
   - Reopen the site in the same browser: the draft is back as it was, with no AI call.
   - Open *Saved drafts*: title, save time, language, "kept until"; rename from the row menu.
   - Mention that another device or private window would not see it.
8. **3:15 Switch to English, exclude the clause (40 s).**
   - Click *English*: the assistant confirms in English and asks nothing again.
   - Type: *"Correction: the employee is not senior."* Because the clause was edited, the *Clauses* tab asks for confirmation.
   - Click *Remove the clause*.
   - In the draft, the clause is gone, "subject to clause 4" now reads "clause 3", and *Clauses* flags the reference to the removed clause. Say that the edited version is kept if it is re-included.
9. **3:55 Compare again and export (35 s).**
   - Compare shows "Clause excluded — Excluded: Employee is senior = No".
   - Click *Download .docx*; the "Before you download" dialog lists the dangling reference first.
   - Open the file in Word: live numbering, header/footer, both languages, edits present, no comparison markup.
10. **4:30 Close (20 s).** Switch the theme to *Dark*: the page stays white and nothing reloads. Mention:
    - values are changed only at the text-run level, and whole clauses are moved without touching numbering definitions;
    - the editor is under the AGPL licence;
    - the README lists what was verified live, what was verified in a browser, and what is pending (Word).
