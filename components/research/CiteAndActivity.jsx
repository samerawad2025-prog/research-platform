'use client'

// Phase 3 M6: "Cite this research", the activity counts, and the page-view
// beacon. Deliberately secondary to the research itself. None of it can
// block reading: every request here is fire-and-forget.

import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../LocaleProvider'
import { messagesFor } from '../../lib/i18n'
import s from './research.module.css'

function sendEvent(publicId, event) {
  try {
    return fetch(`/api/research/${publicId}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }),
      keepalive: true, credentials: 'same-origin', cache: 'no-store',
    }).catch(() => {})
  } catch {
    return Promise.resolve()
  }
}

// A page view is sent only after the page has been visible for 2 seconds,
// once per page load, and never from a prerendered or automated browser.
// Reloads and repeat visits on the same day are removed by the server.
export function PageViewBeacon({ publicId }) {
  const sent = useRef(false)
  useEffect(() => {
    if (typeof document === 'undefined' || navigator.webdriver || document.prerendering) return undefined
    let timer = null
    const arm = () => {
      clearTimeout(timer)
      if (!sent.current && document.visibilityState === 'visible') {
        timer = setTimeout(() => { if (!sent.current) { sent.current = true; sendEvent(publicId, 'page_view') } }, 2000)
      }
    }
    arm()
    document.addEventListener('visibilitychange', arm)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', arm) }
  }, [publicId])
  return null
}

export function CitePanel({ publicId, text, hasUrl }) {
  const { locale } = useLocale()
  const c = messagesFor(locale).research.record.cite
  const [state, setState] = useState(null) // 'copied' | 'failed'
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      setState('copied')
      // Counted only after the copy actually succeeded.
      sendEvent(publicId, 'citation_copy')
    } catch {
      setState('failed')
    }
  }
  return (
    <details className={s.cite}>
      <summary className={s.citeSummary}>{c.open}</summary>
      <div className={s.citeBody}>
        <label className={s.srOnly} htmlFor={`cite-${publicId}`}>{c.textLabel}</label>
        <textarea id={`cite-${publicId}`} className={s.citeText} readOnly value={text} rows={4} dir="auto" onFocus={(e) => e.target.select()} />
        <div className={s.actions} style={{ margin: 'var(--space-2) 0' }}>
          <button type="button" className={s.buttonSecondary} onClick={copy}>{c.copy}</button>
          <a className={s.buttonSecondary} href={`/research/${publicId}/cite?format=ris`} download>{c.ris}</a>
          <a className={s.buttonSecondary} href={`/research/${publicId}/cite?format=bibtex`} download>{c.bibtex}</a>
        </div>
        <p role="status" aria-live="polite" className={state === 'failed' ? s.error : s.muted}>{state === 'copied' ? c.copied : state === 'failed' ? c.copyFailed : ''}</p>
        <p className={s.muted}>{c.formats} {c.basis}</p>
        {!hasUrl && <p className={s.muted}>{c.noUrl}</p>}
      </div>
    </details>
  )
}

export function ActivityPanel({ activity, error }) {
  const { locale } = useLocale()
  const a = messagesFor(locale).research.record.activity
  const fmt = (n) => new Intl.NumberFormat(locale === 'ar' ? 'ar-SD-u-nu-latn' : 'en-GB').format(n)
  const rows = activity ? [
    [a.views, activity.page_view],
    activity.document_open != null && [a.opens, activity.document_open],
    activity.document_download != null && [a.downloads, activity.document_download],
    [a.exports, activity.citation_export],
  ].filter(Boolean) : []
  return (
    <section className={s.activity} aria-labelledby="activity-h">
      <h2 id="activity-h" className={s.activityTitle}>{a.title}</h2>
      {error || !activity ? <p className={s.muted}>{a.unavailable}</p> : (
        <>
          <dl className={s.stats}>
            {rows.map(([label, n]) => (<div key={label} className={s.stat}><dt>{label}</dt><dd>{fmt(n)}</dd></div>))}
          </dl>
          <p className={s.muted}>{a.note}</p>
        </>
      )}
    </section>
  )
}
