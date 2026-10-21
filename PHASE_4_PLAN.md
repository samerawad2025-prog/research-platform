# Phase 4: adoption, usability and research directions

Started 2026-10-18 after the founder authorized continuing beyond Phase 3. This is an implementation sequence, not a claim that these features already exist. Phase 3 publication is live with one genuine approved record.

## M0: reconcile the launch and define the next work

This document and the dated status/runbook updates record the actual launch settings and next steps. No new application feature is included in M0.

## M1: make the live workflow clear and dependable

First remove stale admin wording that says there are no public pages. Explain the distinction between "Reviewed: keep private" and "Approve for publication" beside the decision control, and make an approval-to-private transition explicit before saving. Preserve server authorization, revision checks and all existing publication gates.

Show a public record link when eligible, and ensure the private confirmation/status experience helps an author reach that link after approval without ever exposing the private token. Inspect the current implementation first and change only missing behavior.

Acceptance: bilingual EN/AR; mobile and keyboard usable; reviewed/private stays unpublished; approved eligible records link correctly; withdrawing or making private removes public access. Verify in hosted CI and an isolated preview. Do not use a production-connected preview to submit fixtures.

M1 is released through PR #27 (merge `139ca803`), with passing hosted tests and a verified production deployment. It includes explicit publication decisions, removal confirmation and a private author status panel. No database migration was needed.

## Approved value-feature package: 2026-10-21

The founder approved this implementation order. It supersedes the earlier sequence below; optional recruitment is not a prerequisite.
1. Simplify admin review with progressive disclosure, preserve all server publication checks.
2. Apply the overview's navy/gold identity and Nile-confluence motif selectively to public editorial surfaces; improve mobile navigation and reading.
3. Intelligent reader in Arabic and English, grounded in identified source passages.
4. Bilingual accessible article drafts, explicitly reviewed before publication.
5. Later: question search, study comparisons and Explore research directions.

Separate optional permission for the intelligent reader and articles was approved on 2026-10-21. Existing agreement acceptances must remain unchanged. Current Version 4 explicitly excludes public AI summaries/translations, so the new uses require a new recorded opt-in before processing or publication. Do not silently infer permission from existing public status. This is an implementation requirement, not a blocker to usability improvements.

No provider change, paid service, required participant contact or invitation campaign is included. Continue cloud-only. The first interface change is being verified in hosted CI; the reader, articles and optional permission are not yet released.

## M2: validate the service with a small genuine collection

Founder-led outreach to a small UofK cohort. An initial target of 10-20 permission-reviewed records is a planning target, not a launch requirement or a promise. Track confirmed submissions, approved records, missing-data reasons, review backlog and founder/volunteer time. Do not treat volunteer time as a cash expense or platform activity as academic citations.

Ask users to complete three tasks: submit and confirm a paper, find a relevant record, obtain a citation/document. Record friction before expanding features. External invitations or messages need explicit authorization; no campaign is sent by this plan. Participation remains free.

M2 preparation (2026-10-20): [pilot kit](docs/pilot-kit.md) and [EN/AR invitation drafts](docs/pilot-invitations.md) are ready. No recruitment or participant testing has occurred. Complete the real sessions and review findings before marking M2 complete.

## M3: Explore research directions, a bounded pilot

Start with a source-grounded evidence-card prototype using eligible public metadata and abstracts only. Do not send private deposits or full texts to another provider under existing permissions. Public accessibility alone does not authorize arbitrary reuse or AI processing.

Each card contains:
- A possible question and the exact qualification: "A possible research direction based on the sources reviewed."
- Named linked sources and the actual passages supporting the suggestion.
- Separate fields for a limitation explicitly stated in a source and an inferred opportunity.
- Context date, feasible methods/data needs, constraints and questions for a supervisor.
- The number and scope of sources reviewed; no exhaustive novelty or originality claim.

With one record, the prototype must say its evidence is narrow and must not imply a literature-wide gap. Use human-curated cards before introducing automated generation. Any provider integration needs a separate review of current licensing, terms, cost and data scope. No extra provider or paid tier is approved by this plan.

Acceptance: every factual claim can be traced to a source; missing evidence stays missing; no invented quotations or findings; academic judgment remains with student/supervisor; administrator approves cards before publication.

## Deferred

Citation notifications require verified citation evidence, recipient verification and preferences. Similarity screening requires its own authorization and human review; it is not an originality certificate. Other institutions, researcher identity pages, volunteer onboarding and custom-domain migration remain separate scoped work.

## Reference repositories

Official sources checked 2026-10-18:
- Sudan University of Science and Technology: https://repository.sustech.edu/ . Closest local comparator for graduation projects, theses and collections.
- University of Pretoria UPSpace: https://repository.up.ac.za/ . Study departmental collections and browsing by author, supervisor and subject.
- MIT Open Scholarship: https://dspace.mit.edu/home . Study research collections and permanent records. MIT thesis access guide: https://libguides.mit.edu/diss .

These validate the repository model, not demand for SARP specifically. Sudan already has repositories. SARP should demonstrate easier bilingual submission/discovery and useful connections between research. Do not copy institutional branding or import their documents without checking rights.
