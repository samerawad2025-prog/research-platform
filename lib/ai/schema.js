// lib/ai/schema.js
//
// The one structured shape every provider (mock, Gemini, anything added
// later) must return. The orchestrator and the confirmation screen only
// ever speak this shape, never a provider's native response format.

const METADATA_FIELDS = [
  'title',
  'title_ar',
  'abstract',
  'abstract_ar',
  'supervisor_name',
  'year',
  'university',
  'faculty',
  'degree_type',
];

// A single field's value always looks like one of these four shapes.
// Never a bare value with no status attached, even when the model is
// highly confident, since "confident" is exactly the kind of thing a
// human reviewer needs to be able to check, not infer.
//
// { status: 'found', value: ..., source: 'short excerpt or page ref' }
// { status: 'not_found' }
// { status: 'ambiguous', candidates: [...], source: '...' }
// { status: 'conflicting', candidates: [{ value, source }, { value, source }] }

const EXTRACTION_INSTRUCTIONS = `You are reading a research document to identify it. You are not summarizing, evaluating, or improving it.

FIRST, classify the document. Return "document_type" as exactly one of:
- "thesis" (a student dissertation or thesis submitted for a degree, usually with a supervisor and a university named on the cover)
- "journal_article" (a published paper in an academic journal)
- "conference_paper"
- "research_report" (an institutional, NGO, or policy research report)
- "not_research" (anything that is not academic research: a CV or resume, an invoice, a letter, a form, a presentation, personal documents, or any other non-research material)

Be decisive about "not_research". If this is somebody's CV or an unrelated document, say so plainly rather than trying to extract research metadata from it.

If document_type is "not_research", return that classification and mark every other field not_found. Do not attempt to extract anything else.

Otherwise, extract these fields:

TITLE: exactly as written on the document. Do not rewrite, shorten, translate, or improve it.

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

ABSTRACT: the document's own abstract, only where one clearly exists under that heading (or "ملخص"). Never write a summary of your own and present it as the abstract. If there is no abstract section, mark it not_found.

Rules that matter more than completeness:
- Only report what the document actually states. Never invent, guess, or fill in something plausible.
- An affiliation, department, or institution name is never a person. A supervisor is never listed as an author, and an author is never listed as the supervisor.
- People named only in acknowledgements, or as examiners, correspondents, or editors, are not authors.
- Arabic and English are both valid source languages. If the document gives a title or abstract in only one language, do not translate it into the other, leave the other field not_found.
- When something genuinely is not in the document, not_found is the correct and useful answer. Never manufacture a value to fill a gap.

For every field, return one of these shapes, never a bare value:
- {"status": "found", "value": ..., "source": "brief description of where, e.g. 'title page'"}
- {"status": "not_found"}
- {"status": "ambiguous", "candidates": [...], "source": "..."}
- {"status": "conflicting", "candidates": [{"value": ..., "source": "..."}, {"value": ..., "source": "..."}]}

For "researchers", return {"status": "found"|"not_found", "value": [{"name": "...", "author_order": 1}, ...]}.
For "document_type", return a plain string, not a status object.`;

function targetedInstructions(missingFields) {
  return `${EXTRACTION_INSTRUCTIONS}

A first pass over the front matter already found some of this. Now look specifically for: ${missingFields.join(', ')}.

Search carefully for these before concluding they are absent, they are often on a cover page, title page, approval page, or declaration page that the first pass may have rendered poorly. Only report on these fields. If one genuinely is not in this document, not_found remains the right answer.`;
}

module.exports = { METADATA_FIELDS, EXTRACTION_INSTRUCTIONS, targetedInstructions };
