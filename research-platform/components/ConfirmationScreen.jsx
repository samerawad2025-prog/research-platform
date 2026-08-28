'use client'

// The confirmation screen: "We read your research. Here's what we
// found. Please check it before we use it." Researchers are the
// visual center, per the agreed design; everything else is shown
// for context with a light correction affordance, not a full form.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import styles from './ConfirmationScreen.module.css'

const FIELD_LABELS = {
  abstract: 'Abstract',
  abstract_ar: 'الملخص',
  methodology: 'Methodology',
  supervisor_name: 'Supervisor',
  year: 'Year',
  keywords: 'Keywords',
}

function StatusNote({ field }) {
  if (!field) return null
  if (field.status === 'not_found') {
    return <p className={styles.notFound}>We couldn&rsquo;t find this in your paper.</p>
  }
  if (field.status === 'ambiguous') {
    return <p className={styles.uncertain}>We&rsquo;re not fully sure about this one.</p>
  }
  if (field.status === 'conflicting') {
    return (
      <div className={styles.conflict}>
        <p>Your paper says two different things here:</p>
        <ul>
          {field.candidates.map((c, i) => (
            <li key={i}>
              <strong>{String(c.value)}</strong>
              {c.source && <span className={styles.source}> ({c.source})</span>}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return field.source ? <p className={styles.source}>Found on {field.source}</p> : null
}

export default function ConfirmationScreen({ token }) {
  const [loading, setLoading] = useState(true)
  const [paper, setPaper] = useState(null)
  const [notFoundLink, setNotFoundLink] = useState(false)
  const [researchers, setResearchers] = useState([])
  const [status, setStatus] = useState('idle') // idle | saving | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const [correctionsOpen, setCorrectionsOpen] = useState({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase.rpc('get_paper_for_confirmation', { p_token: token })
      if (cancelled) return

      if (error || !data) {
        setNotFoundLink(true)
        setLoading(false)
        return
      }

      setPaper(data)

      const extracted = data.extraction_detail?.researchers
      const initialResearchers =
        !data.metadata_confirmed_at && extracted?.status === 'found' && extracted.value.length > 0
          ? extracted.value.map((r) => ({ full_name: r.name, author_order: r.author_order, linkedin_url: '', facebook_url: '' }))
          : (data.researchers || []).map((r) => ({
              researcher_id: r.researcher_id,
              full_name: r.full_name,
              author_order: r.author_order,
              linkedin_url: r.linkedin_url || '',
              facebook_url: r.facebook_url || '',
            }))

      setResearchers(initialResearchers.length > 0 ? initialResearchers : [{ full_name: '', author_order: 1, linkedin_url: '', facebook_url: '' }])
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [token])

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

    setStatus('saving')
    setErrorMsg('')

    const { error } = await supabase.rpc('confirm_researcher_metadata', {
      p_token: token,
      p_researchers: researchers,
      p_corrections: null,
    })

    if (error) {
      setErrorMsg('Something went wrong saving your confirmation. Please try again.')
      setStatus('error')
      return
    }

    setStatus('done')
  }

  const showSocialLinks = paper?.publication_scope?.includes('metadata_and_article')

  if (loading) {
    return <div className={styles.centered}><p>Reading through your submission, one moment.</p></div>
  }

  if (notFoundLink) {
    return (
      <div className={styles.centered}>
        <p>We couldn&rsquo;t find a submission for this link. If you believe this is a mistake, please contact us directly.</p>
      </div>
    )
  }

  if (paper.extraction_status === 'pending' || paper.extraction_status === 'processing') {
    return (
      <div className={styles.centered}>
        <p>We&rsquo;re still reading through your paper. This page will be ready in a moment, feel free to refresh shortly.</p>
      </div>
    )
  }

  if (status === 'done') {
    return (
      <div className={styles.centered}>
        <p className={styles.doneMessage}>
          شكراً لك. Thank you for confirming. Your research team is recorded, and we&rsquo;ll be in touch as your work moves toward publication.
        </p>
      </div>
    )
  }

  if (paper.extraction_status === 'failed') {
    return (
      <div className={styles.centered}>
        <p>We ran into trouble reading your document automatically. This happens sometimes with unusual file formats. We have your submission and will follow up by email.</p>
      </div>
    )
  }

  const detail = paper.extraction_detail || {}

  return (
    <form onSubmit={handleConfirm} className={styles.page}>
      <header className={styles.header}>
        <h1>We read your research. Here&rsquo;s what we found.</h1>
        <p className={styles.subtitle}>Please make sure we got it right before we use it.</p>
        {paper.title && <p className={styles.paperTitle}>{paper.title}</p>}
      </header>

      <section className={styles.section}>
        <h2>Your research team</h2>
        <p className={styles.hint}>This is the order your paper lists you in. Not a ranking, just the order.</p>

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
      </section>

      <section className={styles.section}>
        <h2>What else we found</h2>

        {['abstract', 'methodology', 'supervisor_name', 'year', 'keywords'].map((field) => (
          <div key={field} className={styles.foundField}>
            <h3>{FIELD_LABELS[field]}</h3>
            {detail[field]?.status === 'found' && (
              <p className={styles.foundValue}>
                {Array.isArray(detail[field].value) ? detail[field].value.join(', ') : String(detail[field].value)}
              </p>
            )}
            <StatusNote field={detail[field]} />
          </div>
        ))}

        <p className={styles.correctionHint}>
          If anything above looks wrong, let us know when we follow up, we&rsquo;ll fix it together.
        </p>
      </section>

      <button type="submit" className={styles.confirmButton} disabled={status === 'saving'}>
        {status === 'saving' ? 'Saving\u2026' : 'Yes, this is right'}
      </button>

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
