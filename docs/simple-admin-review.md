# Simple administrator review

Default view: research summary, original document access, Approve, Decline, Archive and Edit. Edit exposes existing institution, rights, document, embargo and review-history tools. Research metadata remains read-only in this screen; Edit changes publication/review settings, not author-confirmed content.

Approve uses the existing revision-checked decision endpoint. A single available dissemination version is selected automatically; multiple versions require an explicit choice and no version is invented. Publication gates remain server-enforced. Decline and Archive store the action label as the internal decision reason. Archive maps to withdrawn, retains data, and removes public eligibility. Removing an approved record requires confirmation. No submitter message is sent or required. The former notification warning is removed.

Browser coverage: EN desktop and AR mobile, default uncluttered state, Edit disclosure, approval, decline, archive, cancellation and revision payload. No live paper decision is made by these tests.
