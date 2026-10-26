# Explore research directions: curated pilot

The first M3 release is a human-reviewed evidence-card page at /research/directions, linked from the catalogue. It is not an automatic idea generator. The live catalogue was reset at the owner's request, so content/research-directions.json intentionally contains no cards. An empty page does not claim that research has been analysed.

## Editorial workflow

1. Choose eligible published records and read their approved abstracts. Never use private submissions, extraction history or documents that are not publicly approved.
2. Draft a focused question and a possible extension in English and Arabic. Describe a feasible approach, data needs, practical constraints and questions to discuss with a supervisor.
3. Attach exact passages from the approved abstract. Classify each as finding, method or stated_limitation. Only use stated_limitation when the source explicitly states that limitation. An inferred opportunity belongs in opportunity, never in the evidence quotation.
4. Record the reviewed sourceHash using sourceHash(record) from lib/public/directions.js. The record must come from the existing public_record RPC. Review the question, translations, source coverage and feasibility before setting reviewed:true and reviewedAt.
5. Add the card through a reviewed repository change, run hosted checks, and release. No separate admin editing interface or AI generation is included in this pilot.
6. Re-review whenever the source changes. A withdrawn/private source, changed title/abstract, missing quotation or database failure hides the whole card. Records are rechecked per request with no stored fallback.

## Card fields

Each entry has id (3 to 80 lowercase letters, numbers or hyphens), reviewed:true, reviewedAt (YYYY-MM-DD), en and ar objects, and evidence (1 to 6 passages). Each language object has question, opportunity, method, constraints and supervisor. Each passage has publicId, field (abstract or abstract_ar), kind (finding, method or stated_limitation), quote and sourceHash. The pilot displays at most eight cards.

The source hash covers both titles and both abstracts. It is a freshness check, not a plagiarism or originality score. Evidence passages are checked against the current public source, but human review remains necessary to assess the interpretation.

Every card says: "A possible research direction based on the sources reviewed." It displays source count, abstract-only coverage and review date, distinguishes inference from findings, and links each quotation to the relevant public abstract. A single source is explicitly a starting point rather than evidence of a field-wide gap. No claim of originality is made.

## Scope and permissions

There are no provider calls, new AI permissions, database migrations, private uploads or charges in this release. Existing optional reader/article permission remains unchanged. A future AI-assisted or full-document version needs its own scope and permission review.

## Verification

scripts/test-directions.js checks reviewed content, exact support, freshness, withdrawal, errors and source deduplication. Hosted browser checks cover English desktop and Arabic mobile navigation and the honest empty state. Production fixtures are not created to populate the pilot.
