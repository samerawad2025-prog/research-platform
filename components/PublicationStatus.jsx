'use client'

import { useEffect, useState } from 'react'
import KnowledgePermission from './KnowledgePermission'
import { useLocale } from './LocaleProvider'
import { messagesFor } from '../lib/i18n'
import styles from './ConfirmationScreen.module.css'

export default function PublicationStatus({ token }) {
  const { locale } = useLocale()
  const t = messagesFor(locale).confirmation.publication
  const [result, setResult] = useState({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    const timeout = setTimeout(() => controller.abort(), 8000)
    async function check() {
      try {
        const res = await fetch('/api/submissions/publication-status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }), cache: 'no-store',
          referrerPolicy: 'no-referrer', signal: controller.signal,
        })
        const data = await res.json()
        if (live) setResult(res.ok ? data : { state: 'unavailable' })
      } catch {
        if (live) setResult({ state: 'unavailable' })
      } finally {
        clearTimeout(timeout)
      }
    }
    check()
    return () => { live = false; clearTimeout(timeout); controller.abort() }
  }, [token, attempt])
  return (
    <>
    <section className={styles.receipt} aria-labelledby="publication-status-heading">
      <h2 id="publication-status-heading">{t.heading}</h2>
      <p role="status">{result.state === 'loading' ? t.loading : result.state === 'published' ? t.published : result.state === 'not_public' ? t.notPublic : t.unavailable}</p>
      {result.state === 'published' && result.publicUrl && <p><a className={styles.primaryLink} href={result.publicUrl} referrerPolicy="no-referrer">{t.open}</a></p>}
      <p>{t.privateLink}</p>
      <button type="button" className={styles.secondaryAction} disabled={result.state === 'loading'} onClick={() => { setResult({ state: 'loading' }); setAttempt((n) => n + 1) }}>{t.refresh}</button>
      {/* Full navigation keeps the private confirmation URL out of router requests. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <p><a href="/research" referrerPolicy="no-referrer">{t.browse}</a></p>
    </section>
    <KnowledgePermission token={token} />
    </>
  )
}
