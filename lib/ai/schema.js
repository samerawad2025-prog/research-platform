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
];

// Document classification, returned by pass 1 in the same call as
// everything else (no extra cost, no extra latency). Serves two
// purposes: rejecting non-research uploads with a useful message
// instead of a generic failure, and deciding whether a missing
// supervisor is a real gap worth a second pass or the correct answer.
const THESIS_LIKE_TYPES = ['thesis', 'dissertation'];
const DOCUMENT_TYPES = [
  'thesis',
  'dissertation',
  'journal_article',
  'conference_paper',
  'research_paper',
  'not_research',
];

// A single field's value in the extraction result always looks like one
// of these four shapes. Never a bare value with no status attached, even
// when the model is highly confident, since "confident" is exactly the
// kind of thing a human reviewer needs to be able to check, not infer.
//
// { status: 'found', value: ..., source: 'short excerpt or page ref' }
// { status: 'not_found' }
// { status: 'ambiguous', candidates: [...], source: '...' }
// { status: 'conflicting', candidates: [{ value, source }, { value, source }] }

const EXTRACTION_INSTRUCTIONS = `You are reading a research document to identify it, not to summarize, evaluate, or improve it.

First, classify the document. Return "document_type" as exactly one of: thesis, dissertation, journal_article, conference_paper, research_paper, not_research.

Use "not_research" for anything that is not academic research: a CV or resume, an invoice, a letter, a report unrelated to research, a personal document, or a file whose content you cannot make sense of as scholarly work. Be honest here. It is far better to say not_research than to extract invented metadata from a document that has none.

Then extract only what identifies this research: the title, the researchers and their order, the supervisor, the year, and the abstract where one is present.

SUPERVISOR
University theses and dissertations almost always name a supervisor on the cover page, title page, or in the front matter. Look for it carefully there before concluding it is absent. Common phrasings, any of which identifies a supervisor:
  Supervised by / Supervisor / Supervisors / Academic Supervisor / Thesis Supervisor /
  Under the Supervision of / Supervising Professor / Supervision / Project Supervisor /
  Advisor / Adviser / Under the guidance of
  إشراف / بإشراف / المشرف / الأستاذ المشرف / تحت إشراف
A person named directly after any of these labels is the supervisor. Report their name as written, including an academic title such as Prof. or Dr. if the document shows one.
Published journal articles frequently have no supervisor at all, and reporting not_found for those is correct. What is not correct is missing a supervisor that the document plainly names.

Rules that matter more than completeness:
- Only report what the document actually states. Never infer, guess, or fill in something plausible.
- Distinguish the paper's actual authors (the people who wrote it, usually named on the title page or a declaration page) from the supervisor, examiners, correspondents, editors, affiliations, or anyone named only in acknowledgements. Only real authors go in "researchers". An affiliation or department is never an author, and the supervisor is not one of the authors.
- Never treat a department, faculty, university, or institution name as a person, for either authors or supervisor.
- For the year: if this is a published article, use the publication year if clearly stated. If this is a thesis, use the year clearly associated with the research or its approval. If two parts of the document disagree, report both as a conflict rather than picking one.
- Do not rewrite, shorten, or improve the title. Report it exactly as written.
- If something genuinely is not stated anywhere you were shown, mark it not_found rather than writing something uncertain as if it were certain.
- Arabic and English are both valid source languages. If the document gives a title or abstract in only one language, do not translate it into the other, leave that field not_found.
- Preserve the order authors are listed in the document. That order is positional information, not a ranking.

For every field, return one of these shapes, never a bare value:
- {"status": "found", "value": ..., "source": "brief description of where, e.g. 'title page' or 'page 2, approval section'"}
- {"status": "not_found"}
- {"status": "ambiguous", "candidates": [...], "source": "..."}
- {"status": "conflicting", "candidates": [{"value": ..., "source": "..."}, {"value": ..., "source": "..."}]}

For "researchers", return {"status": "found"|"not_found", "value": [{"name": "...", "author_order": 1}, ...]}.
For "document_type", return {"status": "found", "value": "thesis"} using one of the exact values listed above.`;

function targetedInstructions(missingFields) {
  return `${EXTRACTION_INSTRUCTIONS}

A first pass already read the front of this document and found some information, but could not confidently locate: ${missingFields.join(', ')}. Focus specifically on those fields now, searching the material you have been given here.

If ${missingFields.includes('supervisor_name') ? 'the supervisor is among them, re-read any cover page, title page, approval page, or declaration page especially carefully, since that is where supervision is normally recorded. ' : ''}You still must not invent anything. If a field genuinely is not present in what you can see, mark it not_found, that is a valid and expected answer.

Only report on the fields listed above.`;
}

module.exports = {
  METADATA_FIELDS,
  DOCUMENT_TYPES,
  THESIS_LIKE_TYPES,
  EXTRACTION_INSTRUCTIONS,
  targetedInstructions,
};
