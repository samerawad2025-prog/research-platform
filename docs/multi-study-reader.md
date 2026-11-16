# Multi-study reader

## Multi-study reader pilot: 16 November 2026

The comparison page adds an on-demand reader for two or three public studies. Every study must pass the existing knowledge_source publication and optional-permission checks. The server sends only approved titles and abstracts, labeled S1-S3, and the reader's question. Each answer is limited to four claims, with exact quotations tied to the correct study and source language. Comparison claims require at least two distinct studies; the answer must cite at least two studies overall or report insufficient evidence. Coverage is displayed explicitly.

One Gemini request uses the existing reader model/profile and shared client/global AI limits. There is no automatic retry, persistence, article publication, external search, full-text processing or schema change. Before releasing the answer, all source hashes and permissions are checked again. A changed, withdrawn or inaccessible source suppresses the whole answer. Exact-quote checks do not prove semantic entailment; the interface requires readers to inspect the evidence. This is not a systematic review, quality ranking or research-gap engine.

Browser waits are bounded and cancelled on selection, question or language changes. Hosted tests use synthetic sources and provider responses. Real multi-study provider quality remains unverified until at least two genuine eligible studies are available. Do not create production fixtures or republish withdrawn records for validation. PR checks and the exact production deployment establish release status.

The existing knowledge-permission v1 permits source-linked answers from approved public titles and abstracts. Each selected study must have its own active permission; selection does not grant consent. The new route does not alter acceptance records or expand the source fields. Public corpus selection is reader-controlled, not an exhaustive evidence search.

Implementation references checked on 16 November 2026: [Gemini API terms](https://aistudio.google.com/docs/terms) and [structured output documentation](https://aistudio.google.com/docs/structured-output). Existing unpaid-service disclosures remain applicable. Structured output and verbatim quote checks constrain response shape and attribution, not scientific validity. Existing API-client regional and age requirements remain operator responsibilities, not something submitter consent overrides.

Validation must include fabricated/wrong-source quotes, source-language attribution, absent permission, duplicate/malformed IDs, insufficient evidence, changed/withdrawn sources during generation, quota refusal, oversize input and provider isolation. Before describing the feature as validated on real research, review generated comparisons for comparable populations/methods, correct negation, proposal versus finding distinctions and misleading agreement claims.
