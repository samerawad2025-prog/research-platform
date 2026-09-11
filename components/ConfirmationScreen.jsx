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
import styles from './ConfirmationScreen.module.css'

const POLL_INTERVAL_MS = 2500
const MAX_POLL_ATTEMPTS = 48 // ~2 minutes, then offer a manual retry

const METADATA_FIELDS = [
  { key: 'title', label: 'Title', multiline: true },
  { key: 'supervisor_name', label: 'Supervisor' },
  { key: 'university', label: 'University' },
  { key: 'faculty', label: 'Faculty or school' },
  { key: 'degree_type', label: 'Degree' },
  { key: 'year', label: 'Year' },
  { key: 'abstract', label: 'Abstract', multiline: true },
]

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

function InlineField({ label, value, entry, multiline, onChange, disabled }) {
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
            autoFocus
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <input
            className={styles.editInput}
            value={value}
            autoFocus
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
          />
        )
      ) : (
        <button type="button" className={styles.valueButton} onClick={() => setEditing(true)}>
          {value ? (
            <span className={styles.value}>{value}</span>
          ) : (
            <span className={styles.emptyValue}>Not found in your paper. Tap to add it.</span>
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

        const extracted = detail.researchers
        const seedResearchers =
          !data.metadata_confirmed_at && extracted?.status === 'found' && extracted.value?.length > 0
            ? extracted.value.map((r) => ({ full_name: r.name, author_order: r.author_order, linkedin_url: '', facebook_url: '' }))
            : (data.researchers || []).map((r) => ({
                researcher_id: r.researcher_id,
                full_name: r.full_name,
                author_order: r.author_order,
                linkedin_url: r.linkedin_url || '',
                facebook_url: r.facebook_url || '',
              }))
        setResearchers(seedResearchers.length > 0 ? seedResearchers : [{ full_name: '', author_order: 1, linkedin_url: '', facebook_url: '' }])

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

    async function pollLoop(attempt) {
      if (cancelled) return

      const { data, error } = await supabase.rpc('get_paper_for_confirmation', { p_token: token })
      if (cancelled) return

      if (error || !data) {
        setLinkInvalid(true)
        return
      }

      const stillWorking = applyPaperData(data)
      if (!stillWorking) return

      if (attempt === 0) {
        // Make sure extraction was actually triggered. Safe to call
        // even if it's already running: the server only ever acts on a
        // paper genuinely still 'pending'.
        fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).catch(() => {})
      }

      if (attempt >= MAX_POLL_ATTEMPTS) {
        setPollTimedOut(true)
        return
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      pollLoop(attempt + 1)
    }

    pollLoop(0)
    return () => { cancelled = true }
  }, [token])

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

    if (researchers.some((r) => !r.full_name.trim())) {
      setErrorMsg('Please fill in every researcher\u2019s name, or remove the empty row.')
      return
    }
    if (!values.title?.trim()) {
      setErrorMsg('Please add the title of your research before confirming.')
      return
    }
    if (values.year && !/^\d{4}$/.test(values.year.trim())) {
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
    const corrections = {}
    for (const f of METADATA_FIELDS) {
      corrections[f.key] = (values[f.key] || '').trim()
    }

    const { error } = await supabase.rpc('confirm_researcher_metadata', {
      p_token: token,
      p_researchers: researchers,
      p_corrections: corrections,
    })

    if (error) {
      setErrorMsg(
        error.code === 'P0001' && error.message
          ? error.message
          : 'We couldn\u2019t save your confirmation. Please try again in a moment.'
      )
      setStatus('error')
      return
    }

    setStatus('done')
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

  const detail = paper?.extraction_detail || {}
  // Backward compatibility only: records stored before this fix used
  // the key "supervisor" (confirmed directly against production data).
  // New extractions never produce this anymore - see gemini.js - so
  // this only ever applies to already-stored historical records.
  if (!detail.supervisor_name && detail.supervisor) {
    detail.supervisor_name = detail.supervisor
  }
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
          most word processors offer this under a "Protect Document" or "Encrypt" setting when saving.
        </p>
        <a href="/submit" className={styles.primaryLink}>Start a new submission</a>
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
  const attentionCount = extracting
    ? 0
    : METADATA_FIELDS.filter((f) => needsAttention(detail[f.key])).length

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
        {METADATA_FIELDS.map((f) => (
          <InlineField
            key={f.key}
            label={f.label}
            value={values[f.key] || ''}
            entry={detail[f.key]}
            multiline={f.multiline}
            disabled={extracting}
            onChange={(v) => setValue(f.key, v)}
          />
        ))}
      </section>

      <button type="submit" className={styles.confirmButton} disabled={extracting || status === 'saving'}>
        {extracting ? 'Reading your research\u2026' : status === 'saving' ? 'Saving\u2026' : 'Confirm these details'}
      </button>

      {pollTimedOut && extracting && (
        <p className={styles.timeoutNote}>
          This is taking longer than usual.{' '}
          <button type="button" className={styles.linkButton} onClick={() => window.location.reload()}>Try again</button>
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
