# Legal content

> **Release order and steps live in [`docs/release-runbook.md`](../release-runbook.md)** (authoritative since 2026-09-30). This file explains the reasoning; where the two differ, the runbook wins.

| File | What it is |
|---|---|
| `submission-terms.en.md` | Submission and Deposit Agreement and Privacy Notice — English, Initial Version, dated 25 SEP 2026 |
| `submission-terms.ar.md` | اتفاقية تقديم البحوث وإيداعها وإشعار الخصوصية — Arabic, الإصدار الأول, dated 25 سبتمبر 2026 |
| `submission-terms.v2.en.md` | **Version 2**, dated 4 OCT 2026: Gemini reading by default, under Google's paid-service terms, with manual entry as the researcher's alternative (founder decisions of 2026-10-04). Sections 1–5, 8 and 9 are unchanged from the Initial Version; section 6 is rewritten; section 7's provider paragraph and the acceptance sentence are updated. |
| `submission-terms.v2.ar.md` | Version 2 in Arabic (الإصدار الثاني), dated 4 أكتوبر 2026, with the same changes. Not an official translation; for the founder to review. |
| `submission-terms.v3.en.md` | **Version 3**, dated 4 OCT 2026: Gemini reading by default under Google's **unpaid (free-tier)** terms, sending only a minimized excerpt with names and contact details removed, with manual entry as the alternative (founder decision of 2026-10-04: the project is free tier). Sections 1–5, 8 and 9 are word for word those of versions 1 and 2; section 6 is rewritten; section 7's provider sentence and the acceptance sentence are updated. **Supersedes version 2 for launch.** |
| `submission-terms.v3.ar.md` | Version 3 in Arabic (الإصدار الثالث), with the same changes. Not an official translation; for the founder to review. |

These two files are the **single source of truth** for the agreement text. Any rendered terms page and the acceptance sentence shown beside the checkbox must be produced from these files, not retyped into components. The wording, version label and date are exactly as supplied by the founder; do not edit them in place. A wording change is a new version (a new file or a clearly versioned revision), never a silent edit, because every acceptance must be traceable to the exact text that was shown.

Integrity reference at the time of adding (2026-09-26):

```
77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da  submission-terms.en.md
54a78f8441426b5c2dd190235fb57cfaa0ae9e1a956d6aefb64ff0a13208795b  submission-terms.ar.md
468c51eb1e8edb493de94a969415c8fce28344523503bc43f409a2a45f459367  submission-terms.v2.en.md   (added 2026-10-04)
3bcfe8c27a1046835423b38dc59e7f17d5b4deae94a28cf8273208ea5a71faf0  submission-terms.v2.ar.md   (added 2026-10-04)
54e064c2880d3b67d44fd632bacff70bf6a8f2d05ab28f9e2f05214dab03b988  submission-terms.v3.en.md   (added 2026-10-04)
54af258c7255ebad22b50fbfc7a74c7dc2b3b390bc77068813211ee8b232e2e0  submission-terms.v3.ar.md   (added 2026-10-04)
```

## Version 3 (2026-10-04, free tier): what changed and why

The founder confirmed on 2026-10-04 that the Gemini API project is on Google's **free tier** (no billing), approved revising the agreement to describe that arrangement accurately, and kept Gemini reading as the preferred option with manual entry as the alternative. Paid Gemini is not the launch arrangement, so version 2 (written for paid terms) is superseded before ever being activated.

**The arrangement, as Google states it** (Gemini API terms, last updated 2026-04-28; abuse-monitoring page, last updated 2026-06-09; read 2026-10-04): with unpaid services "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies"; "human reviewers may read, annotate, and process your API input and output", after Google disconnects the data from the account, API key and Cloud project; prompts and responses are logged for 55 days for abuse monitoring; data "may be stored transiently or cached in any country in which Google or its agents maintain facilities"; and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." The terms state no deletion period for content used to improve Google's products.

**Why a checkbox is not the answer.** A researcher's acceptance cannot make prohibited content eligible: it does not change Google's restriction, and it cannot authorize the use of co-authors', supervisors' or anyone else's personal information. So the software changes what is sent, rather than the agreement asking for consent to send everything.

**What is actually sent now (`lib/extraction/excerpt.js`, `docs/extraction-pipeline.md`).** The document never leaves the server. It is read locally (`lib/extraction/pdfText.js` for PDFs, mammoth for Word), and a short excerpt is built: allow-listed cover-page lines (institution, faculty, degree statement, date), lines before any "By"/"Supervisor"/"إعداد"/"إشراف" label that read like a title, and the abstract section(s) sentence by sentence. Lines and sentences with email or web addresses, phone or ID numbers, honorifics ("Dr.", "د."), person labels, author lists, credits/thanks, or any name the platform already holds for the paper are removed; everything after a person label on the cover is dropped except a bare date. Declarations, dedications, acknowledgements and the body are never included. One request is made; the model is told the excerpt has had names removed and is never asked for authors or a supervisor; anything about people in its answer is discarded. The exact excerpt sent is kept with the extraction record (not shown in the browser), so an operator can see what left the server.

**When nothing is sent.** No text layer (a scan), unreadable text, too little left after removal, the names held for the paper unavailable, or a residual personal detail found in the final check: the paper goes to hand entry with its own explanation, and no retry is offered (it would make the same decision). Recorded as `failure_code = 'excerpt_unavailable'` with an `ai_generations` row whose provider is `none`.

**Limitations, stated in section 6 and to be accepted by the founder (D1):**
- researchers always type the **authors** and the **supervisor** themselves (they are never requested);
- a **scanned PDF** (common for older Sudanese theses) gets hand entry: no OCR is done locally, and sending page images would send names;
- a cover whose title cannot be told apart from a name (for example three capitalised words with no "of", "in", "and"…) loses the title, which the researcher types;
- the rules are **not an anonymizer** and are not infallible: a name printed without any label, honorific or contact detail, inside a line that reads like a title, and not among the names the platform holds, would be sent (`scripts/test-excerpt.js` records this case on purpose). Section 6 says so and asks researchers to choose manual entry when their title or abstract contains personal, sensitive or confidential information.

**What version 3 says (section 6):** what is sent and why; what is never sent; when nothing is sent; that removal is automatic and can miss things; Google's use for product and model improvement, human review, 55-day abuse logging, processing in any country, and that no deletion period is stated and withdrawal from the Platform deletes nothing at Google; that acceptance cannot override Google's restriction or authorize use of others' information; that suggestions can be wrong and must be checked; that manual entry sends nothing. The blanket "we do not permit their use for general-purpose AI model training" promise of version 2 is removed, because under the unpaid terms Google may use what it is sent to develop machine-learning technologies; what remains is narrower and true: the Platform does not itself train AI models on submitted documents.

**How the software enforces it (migration 0019 on top of 0018).** Version 3 rows carry `external_ai_processing = 'gemini_api_unpaid'`. A paper is read only when the server attests `GEMINI_DATA_TERMS=unpaid`, the researcher accepted version 3 and chose automatic reading, and the policy, mode and offer allow it; then only the excerpt is sent. A version 2 acceptance is never read under `unpaid`, and a version 3 acceptance never under `paid`. Papers from the legacy form, or created before 0018, have no applicable acceptance and are never read. No existing row is changed by 0019.

## Version 2 (2026-10-04, paid terms): superseded before activation

*Kept as the record of the paid-terms text. Never to be activated for this project: the founder confirmed on 2026-10-04 that the Gemini API project is free tier.*

The founder decided on 2026-10-04 that automatic Gemini reading is the default submission experience, with "Enter details manually" as a clear alternative, and that the agreement must match what actually happens. Version 2 therefore explains, in section 6:

- **what is sent to Google, and why:** the first 10 pages of a PDF (up to 25 if a second reading is needed), or for a Word file up to its first 6,000 characters including page headers (and if needed up to 12,000 characters or selected passages), plus the instructions; never the contact details from the form; only to suggest bibliographic details. This mirrors `lib/extraction/orchestrator.js` exactly; a change there needs a new agreement version.
- **the arrangement:** Google's **paid-service** terms only. Under them Google states it does not use prompts, documents or responses to improve its products, logs them for 55 days solely for abuse monitoring and legally required disclosures, lets authorized Google personnel review them for that purpose, and does not use them to train models other than those used for policy enforcement. Data may be stored transiently or cached in any country where Google or its agents have facilities. (Sources read on 2026-10-04: Google's Gemini API terms, last updated 2026-04-28; its abuse-monitoring page, last updated 2026-06-09.)
- **retention, without inventing deletion guarantees:** we do not control Google's retention, and withdrawing a submission does not delete what Google holds;
- **accuracy:** suggestions can be wrong and must be checked before confirming;
- **manual entry:** choosing it before submitting means the document is not sent to Gemini; switching to it after a failure needs no new upload;
- **other people's information:** the researcher's acceptance covers their own information only and is not consent on behalf of co-authors, supervisors or others named in the document.

The Initial Version's blanket sentence ("External AI extraction may operate only under provider arrangements consistent with that restriction") is replaced by these specific statements. The remaining commitment is narrower and true under the paid terms: the Platform does not train AI models on submitted documents and does not permit their use for general-purpose AI model training.

**Why version 2 did not cover unpaid terms.** Under Google's unpaid (free-quota) terms, Google may use submitted content to improve its products and machine-learning technologies, human reviewers may read it, and Google asks users not to submit personal information. A research document always names people, a submitter's consent cannot override the provider's own restriction, and a submitter cannot consent for the other people named. Version 3 resolves this by changing what is sent (a minimized excerpt), not by asking for consent.

**How the software enforces it (migration 0018).** Each agreement version records which external AI arrangement it describes (`agreement_versions.external_ai_processing`; the Initial Version: none). A document is read only when (1) the server attests the arrangement with `GEMINI_DATA_TERMS=paid`, (2) the researcher accepted a version that describes exactly that arrangement and chose automatic reading, and (3) everything else already required (mode, policy, offer) allows it. Papers from the legacy form, or created before this change, carry no such acceptance and are never read automatically: no broader permission applies retroactively. Historical records and acceptances are untouched.

### The billing question (resolved 2026-10-04: free tier)

**Answered by the founder on 2026-10-04: no — the project is free tier, and billing is not to be enabled.** The original question, kept for the record: is the Google Cloud project that owns the production `GEMINI_API_KEY` linked to an active Cloud Billing account? Only then does Google treat its Gemini API use as a Paid Service. This could not be checked from the repository or the connected services: there is no Google Cloud access, and the key is stored as a sensitive Vercel value and was not read.

Evidence that it was **not** paid recently: production's own extraction history (`ai_generations`) holds three Gemini refusals, on 2026-09-19, 2026-09-20 and 2026-09-21, reading `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests`. Those requests were counted against the free (unpaid) quota. Production has made 18 further Gemini calls since (model `gemini-3.5-flash-lite`, the most recent on 2026-10-03), under whatever terms applied at the time; if the project is still unpaid, those documents were sent under the unpaid terms. Whether billing has been enabled since is unknown.

To check (founder, with the Google account that owns the key): Google AI Studio → API keys → the key's project shows its plan or tier (a paid tier means billing is linked); or Google Cloud console → Billing → Account management → linked projects. If it is not paid, the choices are to link a billing account (a per-use charge; check current Gemini pricing first) or to keep automatic reading off. Either way, `GEMINI_DATA_TERMS=paid` must not be set until the answer is "paid".

## Status: NOT ACTIVE (all three versions)

The agreement is **written but not in effect**, in any version. Version 2 is seeded inactive by migration 0018 and version 3 by migration 0019, alongside the Initial Version rows (unchanged). **Version 3 is the one to activate** (release session, `docs/release-runbook.md`); version 2 is never to be activated for this project. Only one version should be active at a time: the offer is automatic only when **every** active agreement describes the attested arrangement, so activating another version alongside version 3 turns automatic reading off. The live submission form (as of production commit `f45dc690`) still shows the Phase 1/2 processing-consent checkbox and the three legacy publication checkboxes. Nobody has accepted this agreement, and no acceptance may be recorded, inferred or backdated for any existing submission. The date in the agreement is its version date, not an acceptance date; an acceptance timestamp is always the server's time at the moment of acceptance.

Completed wording does not mean the software already does what the agreement says. The agreement may only be activated (shown and accepted in the live form) when every commitment below is true of the running system. Each maps to a milestone in `PHASE_3_PLAN.md`. A completed milestone is not enough on its own: the commitment must actually be supported and verified in production.

## Activation conditions

| Agreement commitment | Required before activation | Plan milestone | Status |
|---|---|---|---|
| §6 (version 3): Gemini reading by default under Google's free-tier terms, sending only a minimized excerpt; nothing sent when one cannot be made; manual entry sends nothing | `GEMINI_DATA_TERMS=unpaid` in Production (the confirmed arrangement); migrations 0018 and 0019; the excerpt path verified with the mock on the Preview (H12) and **with real Gemini on synthetic documents (R1)**; the founder's approval of the text and its limitations | Release session (`docs/release-runbook.md` §4) | **Built and tested locally** (unit, real-Postgres and browser suites; the built server sent only a name-free excerpt). Not deployed; not yet tested against the real Gemini API (needs the separate free-tier test key described in the runbook, R1). |
| §6 (version 2): paid terms | — | — | **Superseded; never to be activated** (the project is free tier). |
| §4, §3: one publication setting chosen from two; permissions bound to the submission | Server-side acceptance record binding the submission, agreement version and language, setting, file and server timestamp; direct uploads/RPC calls without it rejected | M2 (B) | **Built and tested locally, not deployed** (PR #18 and the stacked M2B PR; `docs/submission-flow.md`). **Not met in production:** storage still allows anonymous inserts into the `papers` bucket, and `submit_paper` is still granted to `anon`, until migration 0014 is applied at cutover (after activation, by design, since the legacy form needs that path until the new form is live). |
| §7: optional LinkedIn link public only if the person chooses; no other social profile collected | Facebook collection removed from the flow; LinkedIn display is an explicit, independent choice | M3 (C) | **Built and tested locally, not deployed** (migration 0013). Production still collects Facebook links on the confirmation screen until this release is deployed. |
| §4, §5, §8: nothing public until reviewed; withdrawal stops public access and removes the item from active search | Administrative review and publication state; withdrawal applied to pages, files, search, exports | M4 (D), M5 (E) | **Review side built and tested locally, not deployed** (`docs/admin-review.md`): administrators record decisions; an approval is tied to the exact content, evidence and document version reviewed; withdrawal and embargo are separate restrictions; one function, `publication_eligibility()`, is the rule M5 must use. **The public side is built and off by default (M5, `docs/public-research.md`): pages, search, sitemap and files all use that one function; citation exports are M6.** Nothing is published today, so this condition is met trivially until public pages exist. |
| §8: requests handled via the contact address | A private record of each request's receipt, action and resolution | Operational (founder) | Process, not code. No fixed response deadline is promised. |

Two further conditions apply before **public full-text release** specifically (not before activation):

- The project has been advised that Article 8(2) of Sudan's 2013 Copyright and Related Rights Act (written authorization) may bear on whether an electronic, checkbox-only acceptance is sufficient authorization for public release. Obtain Sudan-qualified legal advice on that narrow point before relying on checkbox-only authorization to publish full text. Do not claim that every submission must be notarized, and do not claim a checkbox satisfies every requirement.
- A reviewed dissemination copy (see M4/M5) must exist for any document made public, so an original upload containing signatures or unnecessary personal details is never exposed.

**Volunteer confidentiality commitment (M4).** `volunteer-confidentiality.en.md` / `.ar.md` are **drafts for the founder to review and approve**; the Arabic is not an official translation. They are seeded as an inactive version (`confidentiality_versions`); until the founder approves the wording and it is activated by SQL, no volunteer can open any submission. A changed wording is a new version that must be acknowledged again; old acknowledgements are kept as evidence. See `docs/admin-review.md`.

**Full-text release restriction (M4).** The legal advice condition above is enforced in the database as an active `release_restrictions` row (`fulltext_legal_advice`). While it is active no record is eligible for public full text, whatever its review status. Approving a record does not lift it; only the founder does, by SQL, and the change is audited.

Nothing in this folder is legal advice or a certification of enforceability.
