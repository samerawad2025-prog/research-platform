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
// (resolveAiProcessingTerms below; docs/release-runbook.md).
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

// GEMINI_DATA_TERMS states which of Google's data terms the Gemini API
// project behind GEMINI_API_KEY is under. It decides what may be sent.
//
//   unpaid  the free tier (no active Cloud Billing account). Google uses
//           what it is sent, and its answers, to improve its products;
//           human reviewers may read them; and Google asks that no
//           sensitive, confidential or personal information be submitted.
//           Only a minimized excerpt is ever sent (lib/extraction/
//           excerpt.js), and only for a paper accepted under agreement
//           version 3 ('gemini_api_unpaid'). Founder decision of
//           2026-10-04: the project is confirmed free tier.
//   paid    an active Cloud Billing account, so Google's paid-service
//           terms apply (not used to improve products; 55-day abuse
//           logging). The front pages themselves are sent, as before; only
//           for a paper accepted under agreement version 2
//           ('gemini_api_paid'). Not the launch arrangement.
//
// The value must describe the real account. Setting `paid` for a free-tier
// key would send whole pages under terms that do not apply. Missing or
// anything else means NOT attested, and nothing is sent to Gemini. The
// arrangement a paper's agreement describes must also match this value
// (external_ai_permission), so changing it never widens what an earlier
// submission agreed to.
const AI_PROCESSING_TERMS = { unpaid: 'gemini_api_unpaid', paid: 'gemini_api_paid' }

// What each arrangement lets the extraction route send.
const PROCESSING_SCOPE = { gemini_api_unpaid: 'excerpt', gemini_api_paid: 'document' }

function resolveAiProcessingTerms(env = process.env) {
  const raw = env.GEMINI_DATA_TERMS
  if (raw === undefined || raw === null || String(raw).trim() === '') return { terms: null, reason: 'missing' }
  const terms = AI_PROCESSING_TERMS[String(raw).trim().toLowerCase()]
  return terms ? { terms, reason: 'configured' } : { terms: null, reason: 'invalid' }
}

module.exports = { deploymentEnv, isPreview, extractionAllowed, resolveExtractionMode, resolveAiProcessingTerms, EXTRACTION_MODES, AI_PROCESSING_TERMS, PROCESSING_SCOPE }
