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
function deploymentEnv() {
  return process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development')
}

function isPreview() {
  return deploymentEnv() === 'preview'
}

// An explicit, deliberate opt-in for the times someone genuinely needs
// to exercise extraction on a preview build. Set
// ALLOW_PREVIEW_EXTRACTION=true on that preview deployment only, and be
// aware it writes to the production database and spends real quota.
function extractionAllowed() {
  if (!isPreview()) return { allowed: true }

  if (String(process.env.ALLOW_PREVIEW_EXTRACTION).toLowerCase() === 'true') {
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

module.exports = { deploymentEnv, isPreview, extractionAllowed }
