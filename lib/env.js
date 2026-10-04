// lib/env.js
//
// Which deployment environment this code is running in, and what it is
// therefore allowed to do.
//
// Why this exists (BUG_HISTORY.md #30): every environment variable on
// this project is scoped to BOTH `production` and `preview` in Vercel —
// verified directly against the Vercel API on 2026-09-20, including
// `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY`. There is only one
// Supabase project and one Gemini key, so a preview deployment of any
// branch talks to the real database with the real service-role
// credential (which bypasses RLS entirely) and spends the real AI
// quota.
//
// The correct long-term fix is a second Supabase project for preview,
// and removing the service-role key from the preview scope. Both need
// a decision from the project owner. This module is the part that can
// be fixed in code today: a preview deployment refuses to run the
// pipeline that writes extraction results and spends quota, so a
// branch build cannot quietly mutate production papers or burn the
// budget.
//
// Deliberately NOT a blanket block on all database access. The
// submission form must still work on a preview for the preview to be
// worth having at all, and a submitted row is visible, attributable and
// harmless. What it stops is the expensive, mutating, hard-to-notice
// half: AI calls and the writes that follow them.

// Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development'.
// Absent locally unless `vercel dev` is used.
function deploymentEnv(env = process.env) {
  return env.VERCEL_ENV || (env.NODE_ENV === 'production' ? 'production' : 'development')
}

function isPreview(env = process.env) {
  return deploymentEnv(env) === 'preview'
}

// An explicit, deliberate opt-in for the times someone genuinely needs
// to exercise extraction on a preview build. Set
// ALLOW_PREVIEW_EXTRACTION=true on that preview deployment only, and be
// aware it writes to the production database and spends real quota.
function extractionAllowed(env = process.env) {
  if (!isPreview(env)) return { allowed: true }

  if (String(env.ALLOW_PREVIEW_EXTRACTION).toLowerCase() === 'true') {
    return { allowed: true, warning: 'preview_extraction_explicitly_enabled' }
  }

  return {
    allowed: false,
    reason: 'preview_extraction_disabled',
    detail:
      'This is a preview deployment. Extraction is disabled here because it would write to the ' +
      'production database and spend the production AI quota. Set ALLOW_PREVIEW_EXTRACTION=true ' +
      'on this deployment to override.',
  }
}

// EXTRACTION_MODE decides whether a submitted document may be sent to
// the external AI provider at all (PHASE_3_PLAN.md M1).
//
//   automatic  the existing two-pass extraction, unchanged.
//   manual     no document content, and no text taken from it, is sent
//              anywhere. The researcher enters the details themselves.
//
// Missing or unrecognised means MANUAL, never automatic. A typo in a
// deployment setting must not be able to send research to a provider;
// the cost of failing safe is that people type their details by hand.
// Automatic is the intended production setting (founder decision of
// 2026-10-04: Gemini reading is the default). It is necessary but not
// sufficient: a document is read only when the paper's own acceptance of
// an applicable agreement allows it and GEMINI_DATA_TERMS is attested
// (resolveAiProcessingTerms below; docs/release-runbook.md, stage B).
//
// Takes the environment as an argument so it can be tested without
// mutating process.env, and so a page and the API route read the same
// rule.
const EXTRACTION_MODES = ['automatic', 'manual']

function resolveExtractionMode(env = process.env) {
  const raw = env.EXTRACTION_MODE
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { mode: 'manual', reason: 'missing' }
  }
  const value = String(raw).trim().toLowerCase()
  if (EXTRACTION_MODES.includes(value)) return { mode: value, reason: 'configured' }
  return { mode: 'manual', reason: 'invalid' }
}

// GEMINI_DATA_TERMS states which of Google's data terms the configured
// Gemini API project is under (founder decisions of 2026-10-04).
//
//   paid   the project has an active Cloud Billing account, so Google's
//          paid-service terms apply: prompts, documents and responses are
//          not used to improve Google's products (logged for 55 days for
//          abuse monitoring only). This is the arrangement agreement
//          version 2 describes ('gemini_api_paid').
//
// Missing or anything else means NOT attested, and no document is sent to
// Gemini at all. Unpaid (free-quota) use is deliberately not a value: under
// those terms Google may use submitted content to improve its products,
// human reviewers may read it, and Google asks that no personal
// information be submitted. A research document always names people, and
// a submitter's consent cannot override the provider's own restriction.
//
// An operator sets this only after checking the billing state of the
// project that owns GEMINI_API_KEY (docs/release-runbook.md). Like
// EXTRACTION_MODE, a missing value fails safe.
const AI_PROCESSING_TERMS = { paid: 'gemini_api_paid' }

function resolveAiProcessingTerms(env = process.env) {
  const raw = env.GEMINI_DATA_TERMS
  if (raw === undefined || raw === null || String(raw).trim() === '') return { terms: null, reason: 'missing' }
  const terms = AI_PROCESSING_TERMS[String(raw).trim().toLowerCase()]
  return terms ? { terms, reason: 'configured' } : { terms: null, reason: 'invalid' }
}

module.exports = { deploymentEnv, isPreview, extractionAllowed, resolveExtractionMode, resolveAiProcessingTerms, EXTRACTION_MODES }
