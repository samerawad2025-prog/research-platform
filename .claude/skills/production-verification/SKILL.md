---
name: Production Verification
description: Evidence-based release verification for the Research Center Platform. Use when checking whether a change is truly implemented, tested, merged, deployed, and working in production, or when a suspected regression may actually be deployment lag.
disable-model-invocation: true
argument-hint: "[optional feature, bug, PR, or commit]"
model: inherit
effort: high
---

# Production verification — Research Center Platform

Use this skill to answer one question: **what is actually live and verified?**

Do not modify production data, Vercel settings, environment variables, code, or deployments while running this verification unless the user separately asks for a change.

Argument: `$ARGUMENTS`

## Never collapse these states

Treat each as separate evidence:
1. implemented in working tree
2. locally tested
3. committed
4. pushed to GitHub
5. CI green
6. merged to the production branch
7. Vercel production deployment built from that exact commit
8. production behavior verified

Never describe an earlier state using the label of a later one.

## Step 1 — establish source state

Check:
- repository: `samerawad2025-prog/research-platform`
- production branch: `research-platform`
- working tree status
- local HEAD
- remote production-branch HEAD
- relevant PR/commit if one is named

If the working tree is dirty, report it. Do not hide uncommitted differences behind a production-verification conclusion.

## Step 2 — GitHub evidence

Verify the exact commit and, when relevant:
- PR merge status
- CI/check status for that commit
- changed files
- whether the commit is actually reachable from `research-platform`

Do not infer “merged” from an open PR containing the desired code.

## Step 3 — Vercel evidence

Verify the production project and deployment:
- target is `production`
- state is healthy/ready
- deployment source branch is `research-platform`
- deployment commit SHA equals the GitHub production-branch SHA
- the production alias is serving that deployment when the connector exposes this evidence

A READY deployment with the wrong SHA is **not** current production.

If a suspected regression exists and SHAs do not match, classify it as deployment lag before debugging application code.

## Step 4 — Supabase evidence

Use read-only queries tailored to the feature. Query only what is necessary.

For extraction/confirmation issues, prefer real rows and diagnostics over assumptions from source:
- `papers.extraction_status`
- `papers.failure_code`
- relevant `papers` fields
- `ai_generations.notes` / result metadata
- relevant relationship rows

The exact stored shape is often a fingerprint of which code version ran.

Do not mutate production merely to create evidence.

## Step 5 — browser evidence

When the change is user-facing, verify the deployed UI with the available Playwright/Chromium capability.

Production browsing is read-only by default:
- do not submit forms
- do not create users/papers
- do not confirm metadata
- do not trigger extraction

unless the user explicitly requests a production test transaction.

Check only the routes and behaviors relevant to `$ARGUMENTS`. Include:
- expected content/state
- console errors
- broken navigation
- obvious responsive/RTL regressions when relevant

## Step 6 — classify the result

Use exactly one of these final states:

- **NOT IMPLEMENTED** — required code is absent.
- **IMPLEMENTED, NOT COMMITTED** — present only in working tree.
- **COMMITTED, NOT PUSHED/MERGED** — exists in Git history but not production branch.
- **MERGED, CI NOT GREEN** — on production branch but checks are failing/incomplete.
- **MERGED, NOT DEPLOYED** — branch has it; production deployment SHA does not.
- **DEPLOYED, NOT PRODUCTION-VERIFIED** — exact SHA is live but required runtime/user evidence was not checked.
- **PRODUCTION-VERIFIED** — exact deployed SHA plus relevant runtime/browser/database evidence confirm the behavior.
- **INCONCLUSIVE** — a required connector/evidence source is unavailable; state exactly what is missing.

Never upgrade an inconclusive state based on confidence.

## Scope control

This is not a repository audit.

If verification uncovers an unrelated problem:
- note it briefly
- do not fix it
- do not reopen Phase 1
- continue verifying the requested change unless the unrelated issue blocks the evidence

## Final response format

Keep the report compact:

**VERDICT:** <one state>

**GitHub:** branch + SHA + CI/PR evidence  
**Vercel:** production deployment + SHA match/mismatch  
**Supabase:** relevant read-only evidence, or “not needed”  
**Browser:** relevant deployed behavior, or “not needed”  
**Gap:** anything preventing full verification

If the verdict is not `PRODUCTION-VERIFIED`, state the single next action required to reach it.
