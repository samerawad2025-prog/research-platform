# Question-based discovery

## Question discovery: 14 November 2026

The next Phase 4 increment adds /research/discover, linked from the catalogue. It extracts up to six distinct meaningful words from an English or Arabic question, retrieves bounded candidates through existing public catalogue checks, then rechecks up to twelve records before displaying up to eight matches. Results show verbatim abstract passages or explicitly say the match is title-only. Retrieval failures hide all results; withdrawn records disappear on the next request.

This is keyword discovery, not semantic retrieval, translation, an AI answer, or proof of a research gap. No provider call, new permission, schema change, embedding store or extra dependency is added. Existing catalogue search remains available. Hosted tests and the deployment record establish release status. Live desktop browser inspection remains unavailable due to the Codex host startup failure.


The passage selector uses a sliding window over matching word positions and retains original text. Query and candidate bounds prevent a full catalogue scan. Ranking uses distinct matched words with a title tie-break, not a scientific relevance or quality score. Results can miss synonyms, inflections and records beyond the candidate limit. The interface shows the actual query words and a bounded-selection notice when retrieval limits are reached. It is a first discovery aid for a small collection; richer semantic discovery requires separately evaluated retrieval and coverage.
