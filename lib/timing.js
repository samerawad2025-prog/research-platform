// lib/timing.js
//
// Stage timing for the submission journey, measured where the person
// actually experiences it: in the browser, from the moment they click
// Submit to the moment the confirmation page is readable.
//
// Why this exists: every timestamp the system had was server-side, and
// the earliest of them (`papers.created_at`) is written AFTER the file
// has already finished uploading. So the two stages most likely to be
// slow on a Sudanese connection — picking up the click, and pushing a
// multi-megabyte PDF — were invisible, and "the logs say 11 seconds"
// was being compared against a wall-clock experience that included
// minutes this system never saw.
//
// The marks survive the navigation from /submit to /confirm/[token] in
// sessionStorage, keyed by the confirmation token, because the journey
// spans two pages and a stage boundary sits exactly on that seam.
//
// Storage is strictly best-effort. Safari in private mode throws on
// sessionStorage access rather than returning null, so every read and
// write is guarded: losing a measurement must never break a
// submission.

const KEY_PREFIX = 'rp_timing_'

// The ordered stages of the journey. Each mark records when that stage
// COMPLETED, so a stage's duration is its own mark minus the previous.
const STAGES = [
  'submit_clicked',
  'upload_complete',
  'paper_created',
  'extract_triggered',
  'confirm_page_mounted',
  'first_poll_response',
  'extraction_observed',
  'fields_visible',
]

function storage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null // private mode, blocked cookies, embedded webview
  }
}

function read(token) {
  const s = storage()
  if (!s) return {}
  try {
    return JSON.parse(s.getItem(KEY_PREFIX + token) || '{}')
  } catch {
    return {}
  }
}

function write(token, marks) {
  const s = storage()
  if (!s) return
  try {
    s.setItem(KEY_PREFIX + token, JSON.stringify(marks))
  } catch {
    // Quota, or a storage-disabled browser. Nothing to do and nothing
    // worth telling the person about.
  }
}

// Records that `stage` completed now. `token` may be null before the
// paper exists — those early marks are held in memory and flushed by
// adoptPendingMarks() once the token is known.
let pendingMarks = {}

function mark(token, stage, extra) {
  const at = Date.now()
  const entry = extra ? { at, ...extra } : { at }

  if (!token) {
    pendingMarks[stage] = entry
    return
  }

  const marks = { ...pendingMarks, ...read(token) }
  marks[stage] = entry
  write(token, marks)
}

// Moves the pre-token marks (the click, the upload) onto the token now
// that submit_paper has returned one.
function adoptPendingMarks(token) {
  if (!token) return
  const marks = { ...pendingMarks, ...read(token) }
  write(token, marks)
  pendingMarks = {}
}

// Turns the marks into per-stage durations. Stages that were never
// reached are simply absent rather than reported as zero — a zero here
// would read as "instant" when it means "never happened".
function summarize(token) {
  const marks = { ...pendingMarks, ...read(token) }
  const present = STAGES.filter((s) => marks[s]?.at)
  if (present.length < 2) return null

  const stages = {}
  for (let i = 1; i < present.length; i++) {
    stages[`${present[i - 1]}__to__${present[i]}`] = marks[present[i]].at - marks[present[i - 1]].at
  }

  const first = marks[present[0]].at
  const last = marks[present[present.length - 1]].at

  return {
    token_prefix: String(token).slice(0, 8), // never log a whole credential
    total_ms: last - first,
    reached: present,
    missing: STAGES.filter((s) => !marks[s]?.at),
    stages,
    meta: {
      file_bytes: marks.upload_complete?.file_bytes ?? null,
      poll_attempts: marks.extraction_observed?.poll_attempts ?? null,
      extraction_status: marks.extraction_observed?.extraction_status ?? null,
      triggered_by: marks.extract_triggered?.by ?? null,
    },
  }
}

function clear(token) {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(KEY_PREFIX + token)
  } catch {
    /* ignore */
  }
}

// Sends the summary to the server so it lands in the same log stream as
// the extraction diagnostics, where the two can finally be compared.
//
// `keepalive` matters here: this fires as the confirmation page becomes
// readable, and without it a person who immediately navigates away
// would have the request cancelled and the measurement lost.
async function report(token) {
  const summary = summarize(token)
  if (!summary) return null

  try {
    await fetch('/api/timing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
      keepalive: true,
    })
  } catch {
    // Timing is diagnostic. A failure to report one is never allowed
    // to surface to the person or interrupt the flow.
  }

  return summary
}

module.exports = { STAGES, mark, adoptPendingMarks, summarize, report, clear }
