// lib/ai/schema.js
//
// The one structured shape every provider (mock, Gemini, anything added
// later) must return. The orchestrator and the confirmation screen only
// ever speak this shape, never a provider's native response format.

// Fields we ask for. "researchers" is handled slightly differently from
// the rest (it's a list, not a single value) but carries the same
// found/not_found/ambiguous/conflicting idea per entry.
const METADATA_FIELDS = [
  'title',
  'title_ar',
  'abstract',
  'abstract_ar',
  'methodology',
  'supervisor_name',
  'year',
  'keywords',
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

const EXTRACTION_INSTRUCTIONS = `You are reading an undergraduate research paper to extract factual metadata. You are not summarizing, evaluating, or improving it.

Rules that matter more than completeness:
- Only report what the document actually states. Never infer, guess, or fill in something plausible.
- Distinguish the paper's actual authors (the students who wrote it, usually on the title page or a declaration page) from the supervisor, examiners, interviewees, or anyone named only in acknowledgements. Only authors go in "researchers".
- If two parts of the document disagree (for example the title page says one year and the approval page says another), report both as a conflict. Do not pick one.
- If something is not stated anywhere you were shown, mark it not_found. Do not leave the platform to guess later by writing something uncertain as if it were certain.
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
