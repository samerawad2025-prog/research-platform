'use client'

// The confirmation screen. Structure appears immediately, never a blank
// waiting page. While extraction runs, fields show honest shimmer
// placeholders: we don't claim to know which field is "currently being
// detected", because extraction is a single call that returns
// everything at once. Faking per-field progress on a platform built
// around "we extract, we don't invent" isn't a trade worth making.
//
// Once extraction lands, every field is inline editable, fields the
// model was unsure about are visibly flagged, and one action at the
// bottom confirms the whole thing.

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { normalizeYear } from '../lib/extraction/applyResult'
import { isFieldVisible, needsLanguageLabel, routeByScript } from '../lib/fields/languagePairs'
import { seedResearchers } from '../lib/fields/researcherSeed'
import { mark, report } from '../lib/timing'
import Button from './ui/Button'
import styles from './ConfirmationScreen.module.css'

// Extraction completes in 5-32 seconds in every production run
// measured so far (median ~16s). A flat 2500ms poll therefore spent
// most of its budget waiting on an answer that was already sitting in
// the database, and added up to 2.5s of pure lag to every submission.
//
// This backs off instead: tight while the answer is plausibly imminent,
// then relaxed so a genuinely slow run doesn't hammer a metered plan.
// Totals ~2 minutes, the same overall budget as before.
function pollDelayMs(attempt) {
  if (attempt < 10) return 600 // first 6s - covers a fast DOCX run
  if (attempt < 30) return 1200 // to ~30s - covers the median and the tail
  return 3000
}

const MAX_POLL_ATTEMPTS = 60 // ~2 minutes, then offer a real retry

// How long to wait before firing the safety-net trigger. The
// submission form already fired one with keepalive; firing a second
// immediately just put two invocations of a 300s-maxDuration function
// in flight against a CAS guard that only one could ever win. This
// gives the form's call time to land first.
const SAFETY_NET_DELAY_MS = 2500

// A paper stuck in 'processing' gets no automatic rescue from the
// safety net above, because that only fires on 'pending'. Without this,
// an abandoned extraction waits for a human to notice and click "Try
// again" - and if nobody does, it is stuck forever. So once the poll
// has run long enough that a healthy extraction would have finished,
// re-trigger periodically and let the SERVER decide whether the claim
// is actually stale. A call that arrives too early is refused cheaply
// (alreadyHandled), so this can never shorten the staleness window or
// cause a duplicate extraction.
const STUCK_RETRIGGER_AFTER_ATTEMPTS = 24 // ~30s of polling
const STUCK_RETRIGGER_EVERY_ATTEMPTS = 20 // then roughly once a minute

// title_ar and abstract_ar were extracted, stored, and returned by
// get_paper_for_confirmation from the start - but were missing from
// THIS list, so the confirmation screen never rendered them. On an
// Arabic-only paper that meant the submitter saw an empty "Title"
// field inviting them to type one, while their real (correctly
// extracted) Arabic title sat invisible in the database. See
// BUG_HISTORY.md #20 for the production evidence.
//
// `dir` is per-field, not per-page: the form is bilingual and an
// Arabic title inside a left-to-right form renders with its
// punctuation in the wrong place unless the field itself says rtl.
const METADATA_FIELDS = [
  { key: 'title', label: 'Title / العنوان', langLabel: 'Title (English)', multiline: true, pair: 'title_ar', primary: true },
  { key: 'title_ar', label: 'Title / العنوان', langLabel: 'Title (Arabic) / العنوان', multiline: true, dir: 'rtl', pair: 'title' },
  { key: 'supervisor_name', label: 'Supervisor' },
  { key: 'university', label: 'University' },
  { key: 'faculty', label: 'Faculty or school' },
  { key: 'degree_type', label: 'Degree' },
  { key: 'year', label: 'Year' },
  { key: 'abstract', label: 'Abstract / الملخص', langLabel: 'Abstract (English)', multiline: true, pair: 'abstract_ar', primary: true },
  { key: 'abstract_ar', label: 'Abstract / الملخص', langLabel: 'Abstract (Arabic) / الملخص', multiline: true, dir: 'rtl', pair: 'abstract' },
]

const FIELD_BY_KEY = Object.fromEntries(METADATA_FIELDS.map((f) => [f.key, f]))

function pairPartner(key) {
  return FIELD_BY_KEY[key]?.pair || null
}

function firstCandidateValue(entry) {
  if (!entry?.candidates?.length) return ''
  const first = entry.candidates[0]
  return typeof first === 'object' && first !== null ? String(first.value ?? '') : String(first)
}

// The value a field should start with, given what extraction reported.
// Deliberately empty for anything not confidently found: an ambiguous
// or conflicting guess must not be silently promoted into the record
// as though it were established.
function initialValueFor(entry) {
  if (!entry) return ''
  if (entry.status === 'found') {
    return Array.isArray(entry.value) ? entry.value.join(', ') : String(entry.value ?? '')
  }
  return ''
}

function needsAttention(entry) {
  return !entry || entry.status !== 'found'
}

function InlineField({ label, value, entry, multiline, dir, onChange, disabled, emptyHint }) {
  const [editing, setEditing] = useState(false)
  const attention = needsAttention(entry)

  if (disabled) {
    return (
      <div className={styles.field}>
        <h3 className={styles.fieldLabel}>{label}</h3>
        <div className={styles.shimmer} aria-hidden="true" />
        {multiline && <div className={`${styles.shimmer} ${styles.shimmerShort}`} aria-hidden="true" />}
      </div>
    )
  }

  return (
    <div className={`${styles.field} ${attention ? styles.fieldAttention : ''}`}>
      <h3 className={styles.fieldLabel}>
        {label}
        {attention && <span className={styles.attentionDot} aria-label="Needs your attention" />}
      </h3>

      {editing ? (
        multiline ? (
          <textarea
            className={styles.editInput}
            value={value}
            rows={4}
            dir={dir}
            autoFocus
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <input
            className={styles.editInput}
            value={value}
            dir={dir}
            autoFocus
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
          />
        )
      ) : (
        <button type="button" className={styles.valueButton} onClick={() => setEditing(true)}>
          {value ? (
            <span className={styles.value} dir={dir}>{value}</span>
          ) : (
            // The old text said "Not found in your paper. Tap to add
            // it." for EVERY empty field. On a field that legitimately
            // does not exist in a one-language paper that reads as an
            // instruction, and a real submitter answered it by typing
            // a sentence explaining the absence, which then became the
            // paper's permanent title (BUG_HISTORY.md #20).
            <span className={styles.emptyValue}>{emptyHint || 'Not found in your paper. Tap to add it.'}</span>
          )}
          <span className={styles.editHint} aria-hidden="true">Edit</span>
        </button>
      )}

      <FieldNote entry={entry} onPick={onChange} />
    </div>
  )
}

function FieldNote({ entry, onPick }) {
  if (!entry) return null

  if (entry.status === 'conflicting') {
    return (
      <div className={styles.note}>
        <p>Your paper gives two different answers here. Which is right?</p>
        <div className={styles.candidates}>
          {entry.candidates.map((c, i) => (
            <button key={i} type="button" className={styles.candidateChip} onClick={() => onPick(String(c.value))}>
              {String(c.value)}
              {c.source && <span className={styles.candidateSource}>{c.source}</span>}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (entry.status === 'ambiguous') {
    return (
      <div className={styles.note}>
        <p>We weren&rsquo;t certain about this one. Please check it.</p>
        {entry.candidates?.length > 0 && (
          <div className={styles.candidates}>
            {entry.candidates.map((c, i) => (
              <button key={i} type="button" className={styles.candidateChip} onClick={() => onPick(typeof c === 'object' ? String(c.value) : String(c))}>
                {typeof c === 'object' ? String(c.value) : String(c)}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (entry.status === 'found' && entry.source) {
    return <p className={styles.source}>Found on {entry.source}</p>
  }

  return null
}

export default function ConfirmationScreen({ token }) {
  const [paper, setPaper] = useState(null)
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [researchers, setResearchers] = useState([])
  const [values, setValues] = useState({})
  const [status, setStatus] = useState('idle') // idle | saving | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const [pollTimedOut, setPollTimedOut] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // Bumped by a manual retry to re-run the polling effect in place,
  // rather than reloading the page.
  const [retryNonce, setRetryNonce] = useState(0)
  const seededRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    seededRef.current = false

    // One place that turns a fetch result into UI state, used by the
    // first load and every poll tick alike, so the two can never drift.
    function applyPaperData(data) {
      setPaper(data)
      const stillWorking = data.extraction_status === 'pending' || data.extraction_status === 'processing'

      if (!seededRef.current) {
        const detail = data.extraction_detail || {}

        // Carries researcher_id across from anyone already on the
        // paper whose name extraction also found. Without it the RPC
        // inserts a duplicate for every author and then deletes the
        // submitter's own link - see BUG_HISTORY.md #33.
        setResearchers(
          seedResearchers({
            extracted: detail.researchers,
            existing: data.researchers,
            alreadyConfirmed: Boolean(data.metadata_confirmed_at),
          })
        )

        const seedValues = {}
        for (const f of METADATA_FIELDS) {
          // Prefer whatever is already committed on the paper (an admin
          // correction, or a previous confirmation), then fall back to
          // what extraction reported.
          seedValues[f.key] = data[f.key] != null && data[f.key] !== ''
            ? String(data[f.key])
            : initialValueFor(detail[f.key])
        }
        setValues(seedValues)

        // Lock seeding once extraction reaches a final state, so a
        // stray later tick can never overwrite what the person typed.
        if (!stillWorking) seededRef.current = true
      }

      return stillWorking
    }

    function triggerExtraction(by) {
      fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        keepalive: true,
      }).catch(() => {})
      mark(token, 'extract_triggered', { by })
    }

    async function pollLoop(attempt) {
      if (cancelled) return

      const { data, error } = await supabase.rpc('get_paper_for_confirmation', { p_token: token })
      if (cancelled) return

      if (error || !data) {
        setLinkInvalid(true)
        return
      }

      if (attempt === 0) mark(token, 'first_poll_response')

      const stillWorking = applyPaperData(data)

      if (!stillWorking) {
        // The moment the client can actually see a finished extraction.
        // This is the number to compare against the server's own
        // duration - the gap between them is the lag this page adds.
        mark(token, 'extraction_observed', {
          poll_attempts: attempt + 1,
          extraction_status: data.extraction_status,
        })
        mark(token, 'fields_visible')
        report(token)
        return
      }

      // Safety net in case the form's trigger never landed. Delayed
      // rather than immediate: the form already fired one with
      // keepalive, and firing a second straight away only raced it.
      // Re-checks `pending` at fire time so a paper already claimed in
      // the meantime is left alone.
      if (attempt === 0 && data.extraction_status === 'pending') {
        setTimeout(() => {
          if (cancelled) return
          triggerExtraction('confirm_page')
        }, SAFETY_NET_DELAY_MS)
      }

      // Periodic nudge for a paper that has been 'processing' too long.
      // The server enforces the staleness rule, so an early nudge is a
      // cheap no-op rather than a duplicate extraction.
      if (
        attempt >= STUCK_RETRIGGER_AFTER_ATTEMPTS &&
        (attempt - STUCK_RETRIGGER_AFTER_ATTEMPTS) % STUCK_RETRIGGER_EVERY_ATTEMPTS === 0
      ) {
        triggerExtraction('stuck_nudge')
      }

      if (attempt >= MAX_POLL_ATTEMPTS) {
        setPollTimedOut(true)
        // Report what we have even on a timeout. A submission that
        // never finished is exactly the one whose stage timings are
        // worth having.
        mark(token, 'extraction_observed', {
          poll_attempts: attempt + 1,
          extraction_status: `timeout:${data.extraction_status}`,
        })
        report(token)
        return
      }

      await new Promise((resolve) => setTimeout(resolve, pollDelayMs(attempt)))
      pollLoop(attempt + 1)
    }

    mark(token, 'confirm_page_mounted')
    pollLoop(0)
    return () => { cancelled = true }
  }, [token, retryNonce])

  // Asks the server to restart extraction, then restarts the poll
  // without a page reload so the timings already recorded for this
  // submission survive.
  async function retryExtraction() {
    setPollTimedOut(false)
    setRetrying(true)
    try {
      await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
    } catch {
      // Nothing to show: the poll below reports the real outcome.
    }
    setRetrying(false)
    setRetryNonce((n) => n + 1) // re-runs the polling effect
  }

  function setValue(key, v) {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  function updateResearcher(index, patch) {
    setResearchers((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function moveResearcher(index, direction) {
    setResearchers((list) => {
      const next = [...list]
      const target = index + direction
      if (target < 0 || target >= next.length) return list
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((r, i) => ({ ...r, author_order: i + 1 }))
    })
  }

  function removeResearcher(index) {
    setResearchers((list) => list.filter((_, i) => i !== index).map((r, i) => ({ ...r, author_order: i + 1 })))
  }

  function addResearcher() {
    setResearchers((list) => [...list, { full_name: '', author_order: list.length + 1, linkedin_url: '', facebook_url: '' }])
  }

  async function handleConfirm(e) {
    e.preventDefault()

    // String(...) rather than .trim() directly: a researcher row whose
    // name is null or undefined would throw here, and a throw in this
    // handler is invisible (see the try/catch below).
    if (researchers.some((r) => !String(r.full_name ?? '').trim())) {
      setErrorMsg('Please fill in every researcher\u2019s name, or remove the empty row.')
      return
    }
    // "A title in at least one language", not "an English title".
    // Requiring values.title specifically made an Arabic-only paper
    // impossible to confirm honestly: the field could not be left
    // empty, so a real submitter typed "No title appeared for this
    // research" into it and that became the paper's title, while the
    // correctly extracted Arabic title sat unused (BUG_HISTORY.md #20).
    if (!values.title?.trim() && !values.title_ar?.trim()) {
      setErrorMsg('Please add the title of your research, in English or Arabic, before confirming.')
      return
    }
    // Accepts Arabic-Indic digits, matching how the server normalizes
    // a year (lib/extraction/applyResult.js). Rejecting "٢٠١٩" here
    // while the extractor happily reads it would be the form telling
    // the submitter their own document's year is invalid.
    if (values.year?.trim() && normalizeYear(values.year) === null) {
      setErrorMsg('Please enter the year as four digits, for example 2023.')
      return
    }

    setStatus('saving')
    setErrorMsg('')

    // Send every field the submitter was shown, including ones they
    // deliberately cleared. An empty value here means "the extraction
    // was wrong and there is no correct value", which the RPC treats
    // as a real correction. Omitting empties instead would silently
    // discard that, leaving a hallucinated value in place.
    let corrections = {}
    for (const f of METADATA_FIELDS) {
      corrections[f.key] = (values[f.key] || '').trim()
    }
    // When a pair was empty and the submitter typed into the single
    // fallback box, put the text in the column that matches the script
    // they actually used. Without this an Arabic title typed into the
    // one visible box would land in `title` and the Arabic column
    // would stay empty, which is the same split this change removes.
    corrections = routeByScript(corrections, METADATA_FIELDS)

    // confirm_researcher_metadata only accepts a year matching
    // ^[0-9]{4}$ and silently keeps the old value otherwise, so an
    // Arabic-Indic year typed here has to be converted to ASCII before
    // it is sent or the correction is dropped without any error.
    if (corrections.year) {
      const y = normalizeYear(corrections.year)
      corrections.year = y === null ? '' : String(y)
    }

    // Everything from here is wrapped, because this handler had no
    // try/catch at all. `setStatus('saving')` disables the confirm
    // button, and the only path that ever cleared it again was the
    // `error` RETURN VALUE from the RPC. A thrown exception - a dropped
    // connection, a rejected fetch, anything at all - left the button
    // disabled on "Saving..." forever with no message on screen and no
    // trace anywhere. From the submitter's side, pressing Confirm
    // simply did nothing (BUG_HISTORY.md #38).
    try {
      const { error } = await supabase.rpc('confirm_researcher_metadata', {
        p_token: token,
        p_researchers: researchers,
        p_corrections: corrections,
      })

      if (error) {
        // P0001 is one of our own `raise exception` messages in the RPC,
        // written as user-facing text. Anything else carries a code the
        // submitter cannot act on, so it is shown alongside a plain
        // message rather than raw - without it, a failure is
        // unreportable and therefore undiagnosable.
        setErrorMsg(
          error.code === 'P0001' && error.message
            ? error.message
            : `We couldn\u2019t save your confirmation. Please try again in a moment.${
                error.code ? ` (reference: ${error.code})` : ''
              }`
        )
        setStatus('error')
        return
      }

      setStatus('done')
    } catch (err) {
      console.error('confirm_researcher_metadata threw:', err)
      setErrorMsg(
        'We couldn\u2019t reach the server to save your confirmation. ' +
          'Please check your connection and try again \u2014 nothing has been lost.'
      )
      setStatus('error')
    }
  }

  if (linkInvalid) {
    return (
      <div className={styles.centered}>
        <p>We couldn&rsquo;t find a submission for this link. If you believe this is a mistake, please contact us directly.</p>
      </div>
    )
  }

  if (status === 'done') {
    return (
      <div className={styles.completionPage}>
        <div className={styles.completionMark}>&#10003;</div>
        <h1>Thank you for confirming</h1>
        <p className={styles.completionLead}>
          Your research details are recorded exactly as you approved them.
        </p>
        <p>
          Your work now enters the platform&rsquo;s review process, where it will be prepared for publication.
          We&rsquo;ll reach out using the details you provided if anything else is needed.
        </p>
        <p className={styles.completionClosing}>
          Thank you for contributing your work to the Sudanese Research Platform.
        </p>
      </div>
    )
  }

  // Backward compatibility only: records stored before this fix used
  // the key "supervisor" (confirmed directly against production data).
  // New extractions never produce this anymore - see gemini.js - so
  // this only ever applies to already-stored historical records.
  //
  // Built as a NEW object rather than by assigning onto
  // paper.extraction_detail: that object belongs to React state, and
  // mutating it in the render path is a real hazard (a later render
  // reading the same object would see the patch already applied and
  // could not tell a stored value from a derived one).
  const rawDetail = paper?.extraction_detail || {}
  const detail =
    !rawDetail.supervisor_name && rawDetail.supervisor
      ? { ...rawDetail, supervisor_name: rawDetail.supervisor }
      : rawDetail
  // document_type is specified and returned as a plain string, not a
  // {status, value} object (see lib/ai/schema.js). Reading .value off
  // it was always undefined, so this check could never actually fire.
  // paper.document_type is the reliable source: it's the top-level
  // papers column, written directly in the route regardless of which
  // generation ends up "applied".
  const docType = paper?.document_type
  const extracting = !paper || paper.extraction_status === 'pending' || paper.extraction_status === 'processing'
  const failed = paper?.extraction_status === 'failed'
  const partial = paper?.extraction_status === 'partial'
  const encrypted = failed && paper?.failure_code === 'encrypted_document'
  // A failure in OUR pipeline or the AI provider's, not in the
  // submitter's file. Telling someone their document is unreadable
  // because Google's model was busy is both wrong and insulting to the
  // work they just uploaded - and it is the exact collapse of distinct
  // failures into one message that BUG_HISTORY.md #7 exists to stop.
  // Observed in production: two real submissions failed this way on a
  // 503 "This model is currently experiencing high demand".
  const TRANSIENT_FAILURES = ['api_error', 'timeout', 'empty_response', 'malformed_json', 'internal']
  const transientFailure = failed && TRANSIENT_FAILURES.includes(paper?.failure_code)

  // A CV, invoice, or anything that isn't research. Say so plainly
  // rather than dropping the person into a confirmation screen full of
  // empty fields, or worse, a generic error.
  if (failed && docType === 'not_research') {
    return (
      <div className={styles.centered}>
        <h1 className={styles.noticeHeading}>This doesn&rsquo;t look like an academic paper</h1>
        <p>
          The file you uploaded doesn&rsquo;t appear to be an academic paper, thesis, dissertation,
          conference paper, or journal article.
        </p>
        <p>
          If you uploaded the wrong file by mistake, you can start a new submission with the right one.
          If you believe this is an error, please contact us and we&rsquo;ll take a look.
        </p>
        <a href="/submit" className={styles.primaryLink}>Start a new submission</a>
      </div>
    )
  }

  // A password-protected file. Distinct from the generic failure
  // below: this one is correctable by the person themselves (remove
  // the password and resubmit), so it gets a specific, accurate
  // message rather than the catch-all.
  if (encrypted) {
    return (
      <div className={styles.centered}>
        <h1 className={styles.noticeHeading}>This document is password-protected</h1>
        <p>This document is password-protected and cannot be processed automatically.</p>
        <p>
          Please remove the password from the file and submit it again. If you&rsquo;re not sure how,
          most word processors offer this under a &ldquo;Protect Document&rdquo; or &ldquo;Encrypt&rdquo; setting when saving.
        </p>
        <a href="/submit" className={styles.primaryLink}>Start a new submission</a>
      </div>
    )
  }

  // Temporary, on our side, and retryable by the person right now.
  if (transientFailure) {
    return (
      <div className={styles.centered}>
        <h1 className={styles.noticeHeading}>We couldn&rsquo;t finish reading it just now</h1>
        <p>
          There&rsquo;s nothing wrong with your document. Our reading service was
          temporarily busy and didn&rsquo;t respond in time.
        </p>
        <p>Your submission is saved. You can try again right now, or leave it and we&rsquo;ll follow up by email.</p>
        <button type="button" className={styles.primaryLink} onClick={retryExtraction} disabled={retrying}>
          {retrying ? 'Trying again\u2026' : 'Try again'}
        </button>
        {errorMsg && <p role="alert" className={styles.errorMessage}>{errorMsg}</p>}
      </div>
    )
  }

  if (failed) {
    return (
      <div className={styles.centered}>
        <h1 className={styles.noticeHeading}>We couldn&rsquo;t read this document</h1>
        <p>
          Something about this file stopped us from reading it automatically. This sometimes happens
          with unusual formats or scanned pages of low quality.
        </p>
        <p>We still have your submission, and we&rsquo;ll follow up with you by email.</p>
      </div>
    )
  }

  const showSocialLinks = paper?.publication_scope?.includes('metadata_and_article')
  // A not_found English title on a paper that HAS an Arabic title is
  // not something the submitter needs to act on, so it must not be
  // counted or flagged - otherwise every Arabic paper opens claiming
  // two fields are wrong when nothing is.
  // Narrow on purpose: this only ever downgrades a plain ABSENCE.
  // An 'ambiguous' or 'conflicting' entry means the model did find
  // competing values and the submitter still needs to resolve them,
  // so those keep their flag and their candidate chips regardless of
  // what the other language's field says.
  const satisfiedByPartner = (key) => {
    const entry = detail[key]
    const absent = !entry || entry.status === 'not_found'
    if (!absent) return false
    const partner = pairPartner(key)
    return Boolean(partner) && !needsAttention(detail[partner])
  }
  const attentionCount = extracting
    ? 0
    : METADATA_FIELDS.filter(
        (f) =>
          isFieldVisible(f, values) &&
          needsAttention(detail[f.key]) &&
          !satisfiedByPartner(f.key)
      ).length

  return (
    <form onSubmit={handleConfirm} className={styles.page}>
      <header className={styles.header}>
        <h1>{extracting ? 'Reading your research' : 'Here\u2019s what we found'}</h1>
        <p className={styles.subtitle}>
          {extracting
            ? 'This usually takes under a minute. The page will fill in on its own.'
            : 'Please check everything below, and correct anything we got wrong.'}
        </p>
        {!extracting && attentionCount > 0 && (
          <p className={styles.attentionBanner}>
            {attentionCount === 1
              ? '1 field needs your attention.'
              : `${attentionCount} fields need your attention.`}
          </p>
        )}
        {!extracting && partial && (
          <p className={styles.attentionBanner}>
            We read the beginning of your document, but couldn&rsquo;t automatically verify every field.
            Please look over everything below carefully.
          </p>
        )}
      </header>

      <section className={styles.section}>
        <h2>Research team</h2>
        <p className={styles.hint}>Listed in the order your paper presents them. Not a ranking, just the order.</p>

        {extracting ? (
          <>
            <div className={styles.shimmer} aria-hidden="true" />
            <div className={`${styles.shimmer} ${styles.shimmerShort}`} aria-hidden="true" />
          </>
        ) : (
          <>
            <ul className={styles.researcherList}>
              {researchers.map((r, i) => (
                <li key={i} className={styles.researcherRow}>
                  <div className={styles.orderControls}>
                    <button type="button" onClick={() => moveResearcher(i, -1)} disabled={i === 0} aria-label="Move up">&#8593;</button>
                    <button type="button" onClick={() => moveResearcher(i, 1)} disabled={i === researchers.length - 1} aria-label="Move down">&#8595;</button>
                  </div>
                  <input
                    className={styles.nameInput}
                    value={r.full_name}
                    onChange={(e) => updateResearcher(i, { full_name: e.target.value })}
                    placeholder="Full name"
                  />
                  <button type="button" className={styles.removeButton} onClick={() => removeResearcher(i)} aria-label="Remove">&times;</button>
                  {showSocialLinks && (
                    <SocialLinks researcher={r} onChange={(patch) => updateResearcher(i, patch)} />
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className={styles.addButton} onClick={addResearcher}>+ Add a researcher</button>
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2>Research details</h2>
        {METADATA_FIELDS.filter((f) => isFieldVisible(f, values)).map((f) => (
          <InlineField
            key={f.key}
            // Only qualify by language when BOTH halves of a pair are
            // on screen. A lone box saying "Title (English)" invites
            // the same "where do I put my Arabic title?" confusion
            // this change exists to remove.
            label={needsLanguageLabel(f, values) ? f.langLabel : f.label}
            value={values[f.key] || ''}
            entry={satisfiedByPartner(f.key) ? { status: 'found' } : detail[f.key]}
            multiline={f.multiline}
            dir={f.dir}
            disabled={extracting}
            emptyHint={
              // Only the language wording when the OTHER language is
              // also on screen; a lone box is just "we didn't find it".
              f.pair && (values[f.pair] || '').trim()
                ? 'Your paper doesn\u2019t appear to have this in this language. You can leave it empty.'
                : 'Not found in your paper. Tap to add it.'
            }
            onChange={(v) => setValue(f.key, v)}
          />
        ))}
      </section>

      <Button type="submit" disabled={extracting || status === 'saving'}>
        {extracting ? 'Reading your research\u2026' : status === 'saving' ? 'Saving\u2026' : 'Confirm these details'}
      </Button>

      {pollTimedOut && extracting && (
        <p className={styles.timeoutNote}>
          This is taking longer than usual.{' '}
          {/*
            Reloading used to be the whole retry. It re-ran the poll but
            could not restart a stalled extraction, because the route
            refused to claim any paper not 'pending' - so a stuck paper
            just waited out another two minutes, and the person did it
            again. That loop is what turned a 15-second extraction into
            a multi-minute wait. This asks the server to actually pick
            the work back up, then resumes polling in place.
          */}
          <button type="button" className={styles.linkButton} onClick={retryExtraction} disabled={retrying}>
            {retrying ? 'Restarting…' : 'Try again'}
          </button>
        </p>
      )}

      {errorMsg && <p role="alert" className={styles.errorMessage}>{errorMsg}</p>}
    </form>
  )
}

function SocialLinks({ researcher, onChange }) {
  const [open, setOpen] = useState(Boolean(researcher.linkedin_url || researcher.facebook_url))

  if (!open) {
    return (
      <button type="button" className={styles.addLinkButton} onClick={() => setOpen(true)}>
        Add a LinkedIn or Facebook link
      </button>
    )
  }

  return (
    <div className={styles.socialInputs}>
      <p className={styles.socialWhy}>
        Adding a profile lets us credit and tag this researcher when the work is featured, so it reaches
        their own network too. Both are optional.
      </p>
      <input
        placeholder="LinkedIn URL (optional)"
        value={researcher.linkedin_url}
        onChange={(e) => onChange({ linkedin_url: e.target.value })}
      />
      <input
        placeholder="Facebook URL (optional)"
        value={researcher.facebook_url}
        onChange={(e) => onChange({ facebook_url: e.target.value })}
      />
    </div>
  )
}
