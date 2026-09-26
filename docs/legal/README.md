# Legal content

| File | What it is |
|---|---|
| `submission-terms.en.md` | Submission and Deposit Agreement and Privacy Notice — English, Initial Version, dated 25 SEP 2026 |
| `submission-terms.ar.md` | اتفاقية تقديم البحوث وإيداعها وإشعار الخصوصية — Arabic, الإصدار الأول, dated 25 سبتمبر 2026 |

These two files are the **single source of truth** for the agreement text. Any rendered terms page and the acceptance sentence shown beside the checkbox must be produced from these files, not retyped into components. The wording, version label and date are exactly as supplied by the founder; do not edit them in place. A wording change is a new version (a new file or a clearly versioned revision), never a silent edit, because every acceptance must be traceable to the exact text that was shown.

Integrity reference at the time of adding (2026-09-26):

```
77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da  submission-terms.en.md
54a78f8441426b5c2dd190235fb57cfaa0ae9e1a956d6aefb64ff0a13208795b  submission-terms.ar.md
```

## Status: NOT ACTIVE

The agreement is **written but not in effect**. The live submission form (as of production commit `f45dc690`) still shows the Phase 1/2 processing-consent checkbox and the three legacy publication checkboxes. Nobody has accepted this agreement, and no acceptance may be recorded, inferred or backdated for any existing submission. The date in the agreement is its version date, not an acceptance date; an acceptance timestamp is always the server's time at the moment of acceptance.

Completed wording does not mean the software already does what the agreement says. The agreement may only be activated (shown and accepted in the live form) when every commitment below is true of the running system. Each maps to a milestone in `PHASE_3_PLAN.md`.

## Activation conditions

| Agreement commitment | Required before activation | Plan milestone | Status |
|---|---|---|---|
| §6: submitted content is not used for general-purpose AI model training; external AI extraction runs only under compatible provider arrangements | Either (a) the Gemini API project's data-use arrangement is verified as compatible, or (b) external extraction is disabled for new submissions and the manual metadata path is used | M1 (A) | **Unverified.** The API project's billing/data-use arrangement has not been checked. Historical rate-limit behaviour is not accepted as proof either way. |
| §4, §3: one publication setting chosen from two; permissions bound to the submission | Server-side acceptance record binding the submission, agreement version and language, setting, file and server timestamp; direct uploads/RPC calls without it rejected | M2 (B) | Approved, not built. Storage currently allows anonymous inserts into the `papers` bucket without any acceptance check. |
| §7: optional LinkedIn link public only if the person chooses; no other social profile collected | Facebook collection removed from the flow; LinkedIn display is an explicit, independent choice | M3 (C) | Approved, not built. The confirmation screen still collects Facebook links. |
| §4, §5, §8: nothing public until reviewed; withdrawal stops public access and removes the item from active search | Administrative review and publication state; withdrawal applied to pages, files, search, exports | M4 (D), M5 (E) | Approved, not built. Nothing is published today, so this condition is met trivially until public pages exist. |
| §8: requests handled via the contact address | A private record of each request's receipt, action and resolution | Operational (founder) | Process, not code. No fixed response deadline is promised. |

Two further conditions apply before **public full-text release** specifically (not before activation):

- The project has been advised that Article 8(2) of Sudan's 2013 Copyright and Related Rights Act (written authorization) may bear on whether an electronic, checkbox-only acceptance is sufficient authorization for public release. Obtain Sudan-qualified legal advice on that narrow point before relying on checkbox-only authorization to publish full text. Do not claim that every submission must be notarized, and do not claim a checkbox satisfies every requirement.
- A reviewed dissemination copy (see M4/M5) must exist for any document made public, so an original upload containing signatures or unnecessary personal details is never exposed.

Nothing in this folder is legal advice or a certification of enforceability.
