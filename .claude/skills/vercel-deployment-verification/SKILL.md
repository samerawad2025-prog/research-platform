---
name: Vercel Deployment Verification
description: Verify Vercel production deployment identity, commit alignment, environment targeting, runtime health, and preview/production separation for the Research Center Platform. Use after merges, releases, environment changes, or when deployment lag/configuration is suspected.
disable-model-invocation: true
argument-hint: "[optional commit, PR, deployment, or symptom]"
model: inherit
effort: high
---

# Vercel deployment verification — Research Center Platform

This skill verifies deployment state. It does not deploy, change environment variables, or alter project settings unless the user separately requests that action.

Argument: `$ARGUMENTS`

## Project identity

Establish the current production project from live Vercel evidence and repository documentation. Do not rely on an old project name if Vercel now reports something different.

Verify:
- project
- production branch
- production deployment ID
- target = `production`
- deployment state
- source commit SHA
- production alias/domain when available

Cross-check the source SHA against GitHub `research-platform` HEAD.

If GitHub HEAD and production SHA differ, stop calling the application “current.” Report deployment lag and the two SHAs.

## Environment separation

Verify environment metadata/scoping when the connector exposes it, without printing secret values.

Project expectations:
- private service credentials must not be exposed to the browser
- production-only private credentials should remain production-scoped unless there is a deliberate reason otherwise
- preview builds must not be allowed to write production extraction data
- `AI_PROVIDER` must not silently fall back to the mock provider in production
- environment targeting must match `lib/env.js` safeguards and current deployment documentation

Never reveal secret values in reports.

If the Vercel connector cannot inspect environment configuration, say **not verified via connector**. Do not infer it from successful deployment or from old notes.

## Deployment health

For the relevant deployment:
- confirm READY/healthy state
- inspect build/runtime errors relevant to `$ARGUMENTS`
- keep log searches scoped to the relevant deployment and time window
- compare exact error text with current source when debugging a suspected stale deployment

Do not treat an old log from a prior deployment as evidence against the current commit.

If runtime logs show an error string that cannot be produced by the deployed source SHA, investigate deployment identity/configuration before changing code.

## Preview vs production

Keep these states distinct:
- local
- preview
- production

A preview success does not verify production.
A production READY status does not verify user behavior.
A merged commit does not prove Vercel deployed it.

When reviewing a preview:
- confirm it is actually a preview target
- do not assume production credentials are unavailable unless environment scope is verified
- avoid actions that could create production data

## User-facing verification

For frontend or flow changes, pair deployment evidence with browser verification.

Use the available Playwright/Chromium capability against the deployed URL:
- navigation/render check
- relevant page state
- console errors
- responsive/RTL checks if the change affects them

Production checks are read-only by default. Do not submit a paper, confirm metadata, or trigger extraction unless explicitly authorized.

## Failure classification

Classify problems before proposing fixes:

- **SOURCE MISMATCH** — Vercel SHA differs from GitHub production branch.
- **BUILD FAILURE** — deployment did not reach READY because build failed.
- **RUNTIME FAILURE** — exact deployed SHA is live but server/runtime behavior fails.
- **ENVIRONMENT/CONFIG UNKNOWN** — needed env metadata cannot be verified.
- **PREVIEW/PRODUCTION CONFUSION** — evidence came from the wrong target.
- **DEPLOYED, UI FAILURE** — exact SHA is live, server is healthy, browser behavior still fails.
- **HEALTHY AND ALIGNED** — exact SHA, target, and relevant checks align.

Do not jump from a symptom to a code change until source mismatch and target confusion are ruled out.

## Final report

Return a compact report:

**VERDICT:** <classification>

**GitHub production HEAD:** <SHA>  
**Vercel production SHA:** <SHA>  
**Deployment:** <ID> — <state>  
**Target/branch:** <production / research-platform or actual live values>  
**Environment scope:** <verified summary / not verifiable>  
**Runtime:** <relevant evidence>  
**Browser:** <relevant evidence / not needed>  
**Next action:** <one concrete action, or “none”>

Do not perform unrelated repository audits.
