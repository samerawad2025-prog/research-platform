'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLocale } from './LocaleProvider'
import { KNOWLEDGE_MESSAGES } from '../lib/i18nKnowledge'
import KnowledgePermission from './KnowledgePermission'
import s from './research/knowledge.module.css'

export default function SubmissionPreview({ token }) {
  const { locale } = useLocale(), t = KNOWLEDGE_MESSAGES[locale]
  const [paper, setPaper] = useState(null), [status, setStatus] = useState(null), [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true, loaded = false
    const ac = new AbortController(), timeout = setTimeout(() => ac.abort(), 10000)
    async function load() {
      try {
        const result = await supabase.rpc('get_paper_for_confirmation', { p_token: token }).abortSignal(ac.signal)
        if (!live) return
        if (result.error || !result.data?.metadata_confirmed_at) { setFailed(true); return }
        loaded = true
        setPaper(result.data)
        const res = await fetch('/api/submissions/publication-status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
          cache: 'no-store', referrerPolicy: 'no-referrer', signal: ac.signal,
        })
        const data = await res.json()
        if (live) setStatus(res.ok ? data : { state: 'unavailable' })
      } catch { if (live) { if (loaded) setStatus({state:'unavailable'}); else setFailed(true) } }
      finally { clearTimeout(timeout) }
    }
    load()
    return () => { live = false; clearTimeout(timeout); ac.abort() }
  }, [token])
  if (failed) return <p role="alert">{t.previewUnavailable}</p>
  if (!paper) return <p role="status">{t.working}</p>
  const title = locale === 'ar' ? paper.title_ar || paper.title : paper.title || paper.title_ar
  const abstract = locale === 'ar' ? paper.abstract_ar || paper.abstract : paper.abstract || paper.abstract_ar
  const published = status?.state === 'published' && status.publicUrl
  return <section className={s.pending} aria-labelledby="own-research-title">
    <p className={s.pendingLabel}>{published ? t.publicNow : status?.state === 'not_public' ? t.pending : status?.state === 'unavailable' ? t.statusUnavailable : t.statusChecking}</p>
    <h2 id="own-research-title" dir="auto">{title}</h2>
    <p dir="auto">{(paper.researchers || []).map(r => r.full_name).filter(Boolean).join(locale === 'ar' ? '، ' : ', ')}</p>
    <p className={s.hint} dir="auto">{[paper.university, paper.faculty, paper.year].filter(Boolean).join(' · ')}</p>
    <p className={s.hint}>{t.onlyYou}</p>
    {published && <p><a className={s.button} href={status.publicUrl} referrerPolicy="no-referrer">{t.openPublished}</a></p>}
    <details className={s.paperPreview}>
      <summary>{t.publicPreview}</summary>
      <p className={s.hint}>{t.previewNote}</p>
      <article>
        <h3 dir="auto">{title}</h3>
        {abstract && <><h4>{t.abstractLabel}</h4><p dir="auto">{abstract}</p></>}
        <dl>
          {[[t.institutionLabel,paper.university],[t.facultyLabel,paper.faculty],[t.yearLabel,paper.year],[t.degreeLabel,paper.degree_type],[t.supervisorLabel,paper.supervisor_name]].filter(([,v])=>v).map(([label,value])=><div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}
        </dl>
      </article>
    </details>
    <details className={s.manage}>
      <summary>{t.researchSettings}</summary>
      <KnowledgePermission token={token} />
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href={`/confirm/${token}`} referrerPolicy="no-referrer">{t.editDetails}</a>
    </details>
  </section>
}
