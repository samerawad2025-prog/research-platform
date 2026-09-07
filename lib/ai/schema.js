// lib/ai/schema.js
//
// The one structured shape every provider (mock, Gemini, anything added
// later) must return. The orchestrator and the confirmation screen only
// ever speak this shape, never a provider's native response format.

// Fields we ask for. "researchers" is handled slightly differently from
// the rest (it's a list, not a single value) but carries the same
// found/not_found/ambiguous/conflicting idea per entry.
//
// Deliberately narrow: methodology, keywords, and themes were removed.
// They added AI calls and page-scanning for information the platform
// doesn't actually need to identify and present a paper. The database
// columns for them still exist and may be used later; extraction just
// no longer asks for them, and their absence never triggers a second pass.
const METADATA_FIELDS = [
  'title',
  'title_ar',
  'abstract',
  'abstract_ar',
  'supervisor_name',
  'year',
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

You are extracting only what's needed to identify and present this research: the title, the researchers and their order, the supervisor where one is clearly named, the year, and the abstract where one is clearly present. Nothing else.

Rules that matter more than completeness:
- Only report what the document actually states. Never infer, guess, or fill in something plausible.
- Distinguish the paper's actual authors (the people who wrote it, usually named on the title page or a declaration page) from the supervisor, examiners, correspondents, editors, affiliations, or anyone named only in acknowledgements. Only real authors go in "researchers". An affiliation or department is never an author, and a supervisor is never an author.
- A supervisor is common for university theses and often genuinely absent from published journal articles. If the document doesn't clearly name someone as a supervisor, report not_found. Do not infer one from a department name or an affiliation.
- For the year: if this reads as a published article, use the publication year if clearly stated. If this reads as a thesis, use the year clearly associated with the research or its approval. If two parts of the document disagree, report both as a conflict rather than picking one.
- Do not rewrite, shorten, or improve the title. Report it exactly as written.
- If something is not stated anywhere you were shown, mark it not_found rather than writing something uncertain as if it were certain.
- Arabic and English are both valid source languages. If the document gives a title or abstract in only one language, do not translate it into the other, leave that field not_found.
- Preserve the order authors are listed in the document. That order is positional information, not a ranking.

For every field, return one of these shapes, never a bare value:
- {"status": "found", "value": ..., "source": "brief description of where, e.g. 'title page' or 'page 2, approval section'"}
- {"status": "not_found"}
- {"status": "ambiguous", "candidates": [...], "source": "..."}
- {"status": "conflicting", "candidates": [{"value": ..., "source": "..."}, {"value": ..., "source": "..."}]}

For "researchers", return {"status": "found"|"not_found", "value": [{"name": "...", "author_order": 1}, ...]}.`;

function targetedInstructions(missingFields) {
  return `${EXTRACTION_INSTRUCTIONS}\n\nA first pass already found some information. Focus specifically on locating: ${missingFields.join(', ')}. Only report on these fields. If you still can't find one of them here, mark it not_found rather than guessing, that's fine and expected, a first attempt already flagged it as uncertain.`;
}

module.exports = { METADATA_FIELDS, EXTRACTION_INSTRUCTIONS, targetedInstructions };
