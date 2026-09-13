# Validation

**Status: not a running pipeline stage.** There is no separate "validate this extraction" AI call anywhere in this codebase today. What exists instead is a set of non-negotiable rules, stated directly in the metadata-extraction prompt itself (see `prompts/metadata-extraction.md`) and in the founding vision (`docs/vision.md`). This file exists so that if a distinct validation step is ever built — automated, human, or both — it has a clear, already-agreed standard to check against, rather than needing to be invented from scratch or, worse, silently drifting from what the extraction prompt already promises.

## The standard (from `docs/vision.md`, restated here as checkable items)

For any AI-generated claim about a piece of research, present or future:

- [ ] Does it preserve the meaning of the source, or has it drifted while paraphrasing?
- [ ] Is a finding clearly distinguished from an interpretation of that finding?
- [ ] Is correlation ever presented as causation?
- [ ] Are the original study's stated limitations still present, not softened or dropped?
- [ ] Is any number, quotation, source, variable, location, method, or conclusion present in the output that isn't present in the source?
- [ ] Is a weak or uncertain conclusion being presented with more confidence than the original researcher gave it?
- [ ] Does the output claim national or general representativeness for a study that used a limited sample?
- [ ] Does the output imply peer review for work that wasn't peer reviewed?
- [ ] Is missing, contradictory, or unclear information flagged honestly, rather than filled in?
- [ ] Can the claim be traced back to a specific section, page, table, or figure, where technically possible?
- [ ] Has a human approved this before anything reaches public view?

## How this is currently enforced, without a dedicated validation step

The metadata-extraction prompt (`prompts/metadata-extraction.md`) builds several of these checks directly into what it asks the model to do — for example, requiring every field to be one of `found`/`not_found`/`ambiguous`/`conflicting` rather than a bare value is itself a validation mechanism: it makes "I'm not sure" a first-class, always-available answer instead of a failure mode the model has to be caught making. The confirmation screen (`components/ConfirmationScreen.jsx`) is the human-approval checkpoint the vision requires — nothing reaches `papers` as confirmed without a person reviewing it.

## Where a dedicated step would plausibly matter most

If and when article generation (`prompts/article-generation.md`) is built, that's the stage most likely to need an explicit validation pass distinct from generation itself — free-form article text is a much easier place to accidentally violate one of the items above than structured metadata extraction is. A plausible shape: a second AI call (or a rule-based check) that takes a generated article draft plus the confirmed source metadata and checks each claim in the draft against the checklist above, flagging anything it can't trace back to the source — before a human ever sees it, as a first filter, not a replacement for human review.

Not implemented. No code exists for this yet.
