# Reader and reviewed articles

Approved by the founder on 2026-10-21. This release uses approved public titles and abstracts only. It does not claim to read full documents. Existing Gemini document extraction is unchanged. A later full-document reader needs a separately scoped source pipeline and permission.

## Optional permission

The confirmed submitter can grant or withdraw a separate optional permission from the private confirmation page. No default opt-in, no change to existing agreement acceptances, no effect on ordinary submission/publication. The exact bilingual notice and its hash are recorded through append-only events. Only the server can call the permission RPC, after hashing the private credential. A new grant after withdrawal creates a new source identity; old articles remain hidden until reviewed again.

## Reader

On an eligible, opted-in public research page, the reader can ask a question in English or Arabic. Source text is treated as untrusted data, never instructions. Each answer must include a quotation that actually occurs in the abstract. This mechanical check does not prove the interpretation is correct; the interface asks readers to verify it. Unsupported questions return insufficient evidence. No invented pages or external literature claims.

Only the configured Gemini model is used; no new provider, SDK, subscription or billing. One request with a 25-second timeout and no retries. Client quota: 10 AI requests per UTC day; global reader/article cap: 50 per day to preserve submission capacity. These share Google's underlying project quota. No question or answer history is stored or logged by the Platform; Google receives them under the disclosed terms. Existing daily hashed rate-limit keys and cleanup apply.

## Editorial workflow

Administrators open the article workspace from the review page. The paper must be publicly eligible with current optional permission. Generate a short bilingual draft, edit it, save a new version, review both languages and explicitly publish. Saving/generating never publishes. Prior published content remains until the new draft is published or the article is removed. Existing article/version tables are reused.

Every public article read checks current paper eligibility, permission and source identity. Withdrawal, changed source, embargo or loss of publication eligibility hides it. The article label identifies AI assistance, abstract-only basis and editorial rather than peer review. Original research authors remain credited on the containing research page.

## Release

Migration 0021 is additive except for replacing the unused article publication trigger with the current publication/permission rule. Existing rows and submission acceptances are not changed. Fresh schema includes the same SQL. Run real Postgres tests and hosted browser checks before applying. Enable RESEARCH_KNOWLEDGE=enabled only after migration verification. Without the flag, API and article editor are off. Removing the flag disables new processing and permission controls; public ordinary research remains available.

Never test through a production-connected Preview. Mocked UI and real disposable Postgres checks run in GitHub Actions without real keys. No Preview Gemini access is added.
