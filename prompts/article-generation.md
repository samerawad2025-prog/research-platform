# Article generation prompt

**Status: not implemented.** There is no article-generation code anywhere in this repository — `articles` and `article_versions` are empty tables reserved for this. Nothing below is running; it's a draft starting point, written against the original product vision (`docs/vision.md`), so this doesn't have to be designed from nothing when the work actually begins.

## What this step is meant to do

Turn a confirmed `papers` row (title, researchers, supervisor, abstract, etc. — everything the extraction pipeline produced and a human confirmed) into an accessible, non-specialist research article. Per the founding vision, the article should normally contain:

- An accurate, engaging headline
- A short introductory hook
- The problem investigated, and why it matters
- Sudanese or relevant contextual background
- How the research was conducted
- Major findings and their interpretation, kept clearly distinct from each other
- Practical implications and the researcher's own recommendations
- Study limitations and open questions for future research
- Researcher attribution
- A link or reference to the complete study

## Non-negotiable constraints (same standard as extraction, not a lower bar)

This step generates far more free-form text than metadata extraction does, which makes it a much easier place to accidentally invent something. The same rules from `docs/vision.md` apply in full, and matter more here, not less:

- Never present interpretation as an original finding.
- Never invent a number, quote, source, or conclusion not present in the confirmed metadata or the source document.
- Never strengthen a weak or uncertain conclusion, or drop a qualification that changes its meaning.
- Never claim national representativeness for a limited-sample study.
- Never imply peer review unless the work was actually peer reviewed.
- Human approval is required before publication — this step should produce a **draft**, not a publish action.

## A plausible starting shape (untested, for discussion)

A draft prompt design, not implemented code:

```
Input: the confirmed papers row + the original document (or its confirmed abstract/findings)
Output: a structured draft with the sections listed above, each traceable back to
        a specific part of the confirmed metadata or source document

Rules:
- Every claim in the "findings" section must map to something the researcher's own
  paper states, not something inferred by this step.
- "Interpretation" and "implications" sections must be clearly labeled as such,
  visually and textually distinct from "findings".
- Limitations stated in the original paper must be preserved, not softened.
- If the source material for a section is missing (e.g., no clear methodology to
  summarize), say so rather than filling the section with generic language.
```

## Open questions to resolve before building this for real

- Should generation happen automatically after confirmation, or only on administrator request? (The founder currently operates alone — see `docs/vision.md`'s "operational simplicity" principle.)
- Does this need the original document text, or is the confirmed metadata (title, abstract, supervisor, etc.) sufficient input? Abstracts are often too short to safely generate the "how the research was conducted" and "major findings" sections without risking invention.
- What does the human-review step look like — is it the same confirmation-screen pattern as extraction (inline editable, uncertainty flagged), or something new?
- Bilingual output (Arabic and English) is part of the vision — is this one generation call producing both, or two separate, audience-adapted passes? The vision explicitly warns against mechanical translation.
