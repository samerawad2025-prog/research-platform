# Gemini review, 24 October 2026

## Decision

Keep automatic document extraction on the production-proven gemini-3.5-flash-lite with low thinking. Gemini 3.8 Flash is the leading free-tier candidate for reader explanations and bilingual articles. Give those features independent model settings, with low thinking for interactive answers and medium for drafts. Their default remains the configured GEMINI_MODEL until a real provider evaluation passes. Model descriptions are not a benchmark of this platform's Arabic accuracy.

Remove deprecated temperature from both REST providers. Existing request bounds, manual fallback, permission gates and review requirements remain. The reader/article prompt explicitly preserves numbers, negation, scope and the distinction between observed results and proposed frameworks. Output schema and exact-quotation validation remain; neither proves semantic correctness.

## What was checked

- [Release notes](https://ai.google.dev/gemini-api/docs/changelog): reviewed recent model, API and retirement changes relevant to this application.
- [Models](https://ai.google.dev/gemini-api/docs/models) and [deprecations](https://ai.google.dev/gemini-api/docs/deprecations): 3.5 Flash-Lite remains supported; 3.5 Flash is a different model with a replacement route. Older 2.5 access is restricted for new projects.
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing): standard 3.8 Flash and 3.5 Flash-Lite offer free input/output; 4 Argon does not. Search grounding is not available on the free tier for these text models.
- [3.8 migration](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8) and [3.6/3.5 changes](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6): sampling parameters are deprecated; 3.8 supports low, medium and high thinking.
- [Thinking](https://ai.google.dev/gemini-api/docs/thinking): Flash-Lite defaults to minimal, so our previous reader silently used less reasoning than extraction.
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits): actual model/project quotas must be checked in AI Studio. Historical 500/day figures are not current promises; Google resets daily quotas on Pacific time, while our app uses UTC.
- [Structured output](https://ai.google.dev/gemini-api/docs/structured-output): keep response schemas and application validation.
- [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing): native PDF understanding is already used by extraction. A larger context window does not justify resending all pages for each reader question.
- [File Search](https://ai.google.dev/gemini-api/docs/file-search): useful future retrieval and citations, but indexing, storage lifecycle, permission withdrawal and actual free-tier eligibility need a separate implementation. Do not upload the repository now.

## Later features

Embeddings and retrieval could support bilingual question search and comparisons once the eligible collection grows. For cumulative research, use retrieved evidence to connect results, methods and limitations, preserving conflicts and study context. A stronger model alone does not create a systematic review. Defer image/video, voice, autonomous agents, batch processing and external search integrations: they do not improve the current core enough to justify more operational work.

## Release and evaluation

No paid service, billing change, key change, new provider, stored Google corpus or silent widening of permission. Do not switch extraction simply because a newer model exists.

Before setting GEMINI_READER_MODEL/GEMINI_ARTICLE_MODEL to gemini-3.8-flash, compare real responses on the same permitted sources: EN and AR factual questions, unsupported questions, numerical/causal distinctions and a bilingual draft. Require correct source quotations and interpretations, preserved attribution/uncertainty, tolerable latency, and no quota/access errors. A single successful response establishes connectivity only. Do not publish generated test drafts automatically. Existing papers require the separate optional permission before any provider test with their content.

Automated tests use simulated provider responses and cover selection, request shape, invalid configuration, thought filtering, incomplete output, exact quotations, revoked permission and existing workflows. Real model quality and account-specific quota are not established by these tests.
