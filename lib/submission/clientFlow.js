// lib/submission/clientFlow.js
//
// The browser side of the acceptance flow (docs/submission-flow.md), as
// pure functions so each decision is tested without a browser
// (scripts/test-submission-client.js). The component
// (components/AcceptanceSubmissionForm.jsx) only wires them to the page.
//
// Rules this encodes:
//   - An issued intent is an immutable snapshot of what was accepted: the
//     offer, agreement, setting, role, contact details, author list and
//     the exact file selection. Any change means a new intent (and a new
//     acceptance record); an unchanged retry reuses the existing one
//     while it is still open.
//   - Upload-link expiry (Storage's lifetime, read from the server, never
//     assumed) and submission expiry (the 30-minute intent) are different
//     failures with different recoveries.
//   - Finalization is idempotent on the server, so a lost response is
//     recovered by calling it again, never by creating a new intent.

const PENDING_KEY = 'sarp_pending_submission'
const RECEIPT_KEY = 'sarp_submission_received'

function intentBody({ offerToken, agreementId, accepted, publicationSetting, claimedRole, fullName, email, whatsappE164, authors, file }) {
  const body = {
    offerToken,
    agreementId,
    accepted: accepted === true,
    publicationSetting,
    claimedRole,
    fullName: String(fullName || '').trim(),
    email: String(email || '').trim(),
    file: { name: file.name, size: file.size, type: file.type },
  }
  // Sent already in E.164, so no country is needed to read it.
  if (whatsappE164) body.whatsapp = whatsappE164
  if (claimedRole === 'authorized_depositor') body.authors = authors.map((a) => String(a).trim()).filter(Boolean)
  return body
}

// fileSerial changes on every file selection, so choosing a file again
// (even one with the same name and size) never reuses an intent whose
// upload may already hold the previous bytes.
function snapshotKey(body, fileSerial) {
  return JSON.stringify([body, fileSerial])
}

function reusableIntent(current, key, now = Date.now()) {
  if (!current || current.key !== key) return null
  // A margin, so a reuse never races the intent's own expiry.
  return Date.parse(current.expiresAt) - now > 60_000 ? current : null
}

// What /api/submissions/intent answered.
function classifyIntent(status, body) {
  const reason = body?.reason || null
  if (status === 201 && body?.intentId && body?.upload?.token) return { kind: 'ok' }
  if (status === 409 && reason === 'offer_stale') return { kind: 'stale', why: body.staleBecause || 'offer_expired' }
  if (status === 400 && reason === 'offer_invalid') return { kind: 'stale', why: 'offer_invalid' }
  if (status === 429) return { kind: 'error', error: 'rateLimited' }
  if (status === 404 || status === 503) return { kind: 'error', error: 'unavailable' }
  if (status === 400) return { kind: 'error', error: 'invalid', reason }
  return { kind: 'error', error: 'internal' }
}

// A supabase-js uploadToSignedUrl error. Storage answers an existing
// object with 409/"already exists" (with upsert:false it is never
// replaced), and an expired or invalid authorization with a 400/403 about
// the token.
function classifyUpload(error) {
  if (!error) return 'uploaded'
  const text = `${error.statusCode ?? ''} ${error.status ?? ''} ${error.error ?? ''} ${error.message ?? ''}`.toLowerCase()
  if (/already exists|duplicate|\b409\b/.test(text)) return 'uploaded'
  if (/expired|jwt|signature|unauthori[sz]ed|\b403\b|\b401\b/.test(text)) return 'linkExpired'
  if (/exceeded|too large|maximum|\b413\b/.test(text)) return 'tooLarge'
  return 'failed'
}

// What /api/submissions/finalize answered.
function classifyFinalize(status, body) {
  const reason = body?.reason || null
  if (status === 200 && body?.confirmationToken) return { kind: 'done' }
  if (status === 409 && reason === 'upload_missing') return { kind: 'reupload' }
  if (status === 410) return { kind: 'expired' }
  if (status === 422 && reason === 'object_size_mismatch') return { kind: 'error', error: 'objectMismatch', discard: true }
  if (status === 422) return { kind: 'error', error: 'objectType', discard: true }
  if (status === 404 && reason === 'intent_not_found') return { kind: 'error', error: 'internal', discard: true }
  if (status === 429) return { kind: 'error', error: 'rateLimited' }
  // 5xx and 404 not_available: safe to retry the same call.
  if (status >= 500 || status === 404) return { kind: 'retry' }
  return { kind: 'error', error: 'internal' }
}

function storage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

// The minimum needed to finish after a lost response or a reload: never
// the file, never the confirmation token (finalize returns it again).
// sessionStorage keeps it in this tab only.
function savePending(p) {
  try { storage()?.setItem(PENDING_KEY, JSON.stringify({ intentId: p.intentId, intentToken: p.intentToken, expiresAt: p.expiresAt, uploaded: Boolean(p.uploaded) })) } catch { /* best effort */ }
}
function readPending(now = Date.now()) {
  try {
    const p = JSON.parse(storage()?.getItem(PENDING_KEY) || 'null')
    if (!p || typeof p.intentId !== 'string' || typeof p.intentToken !== 'string') return null
    return { ...p, expired: !(Date.parse(p.expiresAt) > now) }
  } catch {
    return null
  }
}
function clearPending() {
  try { storage()?.removeItem(PENDING_KEY) } catch { /* best effort */ }
}

// A one-time flag for the confirmation page: "you arrived here from a
// completed submission", so it shows the receipt. No token is stored.
function markReceived() {
  try { storage()?.setItem(RECEIPT_KEY, '1') } catch { /* best effort */ }
}
function takeReceived() {
  try {
    const s = storage()
    const v = s?.getItem(RECEIPT_KEY) === '1'
    s?.removeItem(RECEIPT_KEY)
    return v
  } catch {
    return false
  }
}

module.exports = {
  intentBody,
  snapshotKey,
  reusableIntent,
  classifyIntent,
  classifyUpload,
  classifyFinalize,
  savePending,
  readPending,
  clearPending,
  markReceived,
  takeReceived,
}
