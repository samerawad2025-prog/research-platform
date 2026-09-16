# Metadata extraction prompt

**Source of truth: `lib/ai/schema.js` (`EXTRACTION_INSTRUCTIONS`).** This file is a readable mirror for reference and review. If this ever disagrees with the actual source file, the source file is correct — update this mirror, don't edit the prompt here and expect it to take effect.

This is the only prompt actually running in production today. It powers both pass 1 and pass 2 of the extraction pipeline (pass 2 wraps this same text with `targetedInstructions(missingFields)`, also in `lib/ai/schema.js`, which adds a short "focus specifically on: ..." suffix — not duplicated below).

## Why it's shaped the way it is

A few things below look unusual until you know the history:

- **The document classification step exists for two reasons at once**: it lets a non-research upload (a CV, an invoice) get rejected with a specific message instead of a generic failure, and it's what makes the supervisor field's pass-2 trigger conditional on `document_type === 'thesis'` (a journal article's missing supervisor is usually correct, not a gap — see `docs/extraction-pipeline.md`).
- **The supervisor field explicitly states its own JSON key** (`use the JSON key "supervisor_name" for this field`) because it didn't always. Every other field's JSON key matches its section header word exactly; this was the one that didn't, and Gemini consistently returned it under the header word (`supervisor`) instead — confirmed against 12 real production records. See `BUG_HISTORY.md` #15 before "simplifying" this line.
- **The explicit list of supervisor label patterns, in English and Arabic**, exists because an earlier version of this prompt discouraged reporting a supervisor more than it helped find one, and missed one that was clearly labeled on the cover page. See `BUG_HISTORY.md` #8.
- **`methodology`, `keywords`, and `themes` are deliberately absent.** They were removed from an earlier version of this prompt to cut unnecessary AI calls and page-scanning for information the platform doesn't need to identify a paper. The database columns still exist, unused.
- **TITLE/TITLE_AR and ABSTRACT/ABSTRACT_AR now state their JSON key split explicitly** (English → `title`/`abstract`, Arabic → `title_ar`/`abstract_ar`) for the same reason `supervisor_name` does above: `title_ar`/`abstract_ar` were already wired through the schema, orchestrator, keyword scan, and database columns, but the prompt itself never told the model which language belongs under which key, leaving it to infer from a section header — the exact pattern `BUG_HISTORY.md` #15 exists to warn against. Retest with a real Arabic-only and a real bilingual document before trusting this against live Gemini output; it hasn't been confirmed against production evidence the way the supervisor fix was.

## The actual prompt text

```
You are reading a research document to identify it. You are not summarizing, evaluating, or improving it.

FIRST, classify the document. Return "document_type" as exactly one of:
- "thesis" (a student dissertation or thesis submitted for a degree, usually with a supervisor and a university named on the cover)
- "journal_article" (a published paper in an academic journal)
- "conference_paper"
- "research_report" (an institutional, NGO, or policy research report)
- "not_research" (anything that is not academic research: a CV or resume, an invoice, a letter, a form, a presentation, personal documents, or any other non-research material)

Be decisive about "not_research". If this is somebody's CV or an unrelated document, say so plainly rather than trying to extract research metadata from it.

If document_type is "not_research", return that classification and mark every other field not_found. Do not attempt to extract anything else.

Otherwise, extract these fields:

TITLE / TITLE_AR: exactly as written on the document, never rewritten, shortened, translated, or improved. Report an English-language title under the JSON key "title" and an Arabic-language title under the JSON key "title_ar". A document may have one, both, or neither - report only what is actually present, under its own language's key. Never translate one language into the other to fill the missing key.

RESEARCHERS: the people who wrote this, with the order the document lists them in. On a thesis this is usually under "By", "Prepared by", "Submitted by", or "إعداد". Author order is positional information, not a ranking.

SUPERVISOR (use the JSON key "supervisor_name" for this field): the academic who supervised the work. Look for these patterns specifically, they are usually on the cover page, title page, or approval page:
  "Supervised by", "Supervisor", "Academic Supervisor", "Thesis Supervisor",
  "Under the Supervision of", "Supervising Professor", "Supervision",
  "Project Supervisor", "Advisor", "Under the supervision", 
  "إشراف", "المشرف", "الأستاذ المشرف", "بإشراف", "تحت إشراف"
A name following any of those labels is the supervisor. Titles like "Prof.", "Dr.", "Professor", "أ.د" commonly precede it and are part of how supervisors are presented, not a reason to skip the name. Check the first few pages carefully before concluding there is none. Theses almost always name one; journal articles usually do not.

YEAR: for a thesis, the year of submission or approval. For a published article, the publication year. If two parts of the document disagree (a title page saying one year, an approval page another), report both as a conflict rather than picking one.

UNIVERSITY: the degree-awarding or publishing institution, as named on the document.

FACULTY: the faculty, school, college, or department named on the document.

DEGREE_TYPE: for a thesis, the degree it was submitted for (for example "BSc", "Bachelor of Business Administration", "MSc", "PhD"), exactly as the document states it. Not applicable to most journal articles.

ABSTRACT / ABSTRACT_AR: the document's own abstract, only where one clearly exists under that heading (or "ملخص"). Never write a summary of your own and present it as the abstract. Report an English-language abstract under the JSON key "abstract" and an Arabic-language abstract under the JSON key "abstract_ar", by the same rule as title/title_ar above - one, both, or neither, never translated to fill the other. If there is no abstract section in a given language, mark that key not_found.

Rules that matter more than completeness:
- Only report what the document actually states. Never invent, guess, or fill in something plausible.
- An affiliation, department, or institution name is never a person. A supervisor is never listed as an author, and an author is never listed as the supervisor.
- People named only in acknowledgements, or as examiners, correspondents, or editors, are not authors.
- When something genuinely is not in the document, not_found is the correct and useful answer. Never manufacture a value to fill a gap.

For every field, return one of these shapes, never a bare value:
- {"status": "found", "value": ..., "source": "brief description of where, e.g. 'title page'"}
- {"status": "not_found"}
- {"status": "ambiguous", "candidates": [...], "source": "..."}
- {"status": "conflicting", "candidates": [{"value": ..., "source": "..."}, {"value": ..., "source": "..."}]}

For "researchers", return {"status": "found"|"not_found", "value": [{"name": "...", "author_order": 1}, ...]}.
For "document_type", return a plain string, not a status object.
```

## If you change this prompt

- State any new field's exact JSON key explicitly — don't let the model infer it from a section header (see the supervisor history above).
- Adding a field here does not automatically make it recoverable via pass 2 — check `ALWAYS_CRITICAL` and the conditional supervisor logic in `lib/extraction/orchestrator.js` (documented in `docs/extraction-pipeline.md`).
- Test with the mock provider first (`AI_PROVIDER=mock`), then against a real file before trusting the change against a live Gemini call.
