// lib/submission/routeHelpers.js
//
// Small helpers shared by the /api/submissions routes.

// The first address in x-forwarded-for is the client as seen by Vercel's
// edge. It is only ever used, hashed with a server secret, as a request
// limit key (acceptanceHandlers.js); it is never stored or logged as-is.
function clientKeyOf(request) {
  const forwarded = request.headers.get('x-forwarded-for') || ''
  return forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
}

// No service-role key (a preview) means the flow is simply unavailable.
function adminOrNull(getSupabaseAdmin) {
  try {
    return getSupabaseAdmin()
  } catch {
    return null
  }
}

module.exports = { clientKeyOf, adminOrNull }
