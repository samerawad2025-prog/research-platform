'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../lib/admin/adminClient'
import { useAdmin, errorText } from './AdminProvider'
import s from './admin.module.css'

const PAGE = 25
const STATUSES = ['pending', 'needs_changes', 'reviewed', 'approved', 'declined', 'withdrawn']

export default function AdminQueue() {
  const { me, t, locale } = useAdmin()
  const q = t.queue
  const [draft, setDraft] = useState({ status: '', institution: '', confirmed: '', q: '' })
  const [applied, setApplied] = useState(draft)
  const [offset, setOffset] = useState(0)
  const [institutions, setInstitutions] = useState([])
  const [res, setRes] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { api('GET', 'institutions').then((r) => r.ok && setInstitutions(r.data)) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
    for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v)
    setRes(await api('GET', `queue?${p}`))
    setLoading(false)
  }, [applied, offset])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
  useEffect(() => { load() }, [load])

  const fmt = (d) => (d ? new Date(d).toLocaleDateString(locale === 'ar' ? 'ar-SD-u-nu-latn' : 'en-GB') : '')
  const name = (i) => (locale === 'ar' && i.name_ar) || i.name_en
  const items = res?.ok ? res.data.items : []
  const total = res?.ok ? res.data.total : 0
  const isVol = me.role === 'volunteer'

  return (
    <div>
      <h1 className={s.h1}>{q.heading}</h1>
      <p className={s.lead}>{q.intro}</p>
      <form className={s.section} aria-label={q.filters} onSubmit={(e) => { e.preventDefault(); setOffset(0); setApplied(draft) }}>
        <div className={s.filters}>
          <label className={s.field}><span>{q.status}</span>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">{q.statusAny}</option>
              {STATUSES.map((x) => <option key={x} value={x}>{t.status[x]}</option>)}
            </select></label>
          {!isVol && (
            <label className={s.field}><span>{q.institution}</span>
              <select value={draft.institution} onChange={(e) => setDraft({ ...draft, institution: e.target.value })}>
                <option value="">{q.institutionAny}</option>
                <option value="unresolved">{q.institutionUnresolved}</option>
                {institutions.map((i) => <option key={i.id} value={i.id}>{name(i)}</option>)}
              </select></label>
          )}
          <label className={s.field}><span>{q.confirmed}</span>
            <select value={draft.confirmed} onChange={(e) => setDraft({ ...draft, confirmed: e.target.value })}>
              <option value="">{q.confirmedAny}</option>
              <option value="yes">{q.confirmedYes}</option>
              <option value="no">{q.confirmedNo}</option>
            </select></label>
          <label className={s.field}><span>{q.search}</span>
            <input type="search" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} maxLength={200} />
          </label>
        </div>
        <div className={s.row}>
          <button className={s.primary} type="submit">{q.apply}</button>
          <button className={s.secondary} type="button" onClick={() => { const z = { status: '', institution: '', confirmed: '', q: '' }; setDraft(z); setApplied(z); setOffset(0) }}>{q.reset}</button>
        </div>
      </form>

      <div aria-live="polite">
        {loading && <p className={s.muted} role="status">{t.loading}</p>}
        {res && !res.ok && <p role="alert" className={s.error}>{errorText(t, res)} <button className={s.link} onClick={load}>{t.retry}</button></p>}
        {res?.ok && !loading && <p className={s.muted}>{q.count(items.length, total)}</p>}
        {res?.ok && !loading && items.length === 0 && <p>{isVol ? q.emptyVolunteer : q.empty}</p>}
      </div>

      <ul className={s.list}>
        {items.map((it) => (
          <li key={it.paper_id} className={s.item}>
            <Link href={`/admin/review/${it.paper_id}`} className={s.bidi}>{it.title || it.title_ar || q.untitled}</Link>
            <div className={s.meta}>
              <span>{q.submittedOn(fmt(it.submitted_at))}</span>
              {it.year && <span>{q.yearLabel(it.year)}</span>}
              <span>{it.institution?.id ? name(it.institution) : q.institutionUnresolved}</span>
            </div>
            <div className={s.chips}>
              <span className={`${s.chip} ${it.status === 'approved' ? s.chipOk : it.status === 'declined' || it.status === 'withdrawn' ? s.chipBad : s.chipWarn}`}>{t.status[it.status]}</span>
              <span className={s.chip}>{it.states.confirmed ? t.states.confirmed : q.confirmedNo}</span>
              {it.states.reviewed && <span className={s.chip}>{t.states.reviewed}</span>}
              {it.states.publication_approved && <span className={`${s.chip} ${s.chipOk}`}>{t.states.publication_approved}</span>}
              {it.status === 'approved' && !it.states.publication_approved && <span className={`${s.chip} ${s.chipBad}`}>{q.changedSinceApproval}</span>}
              {it.withdrawn && <span className={`${s.chip} ${s.chipBad}`}>{q.withdrawn}</span>}
              {it.embargo_until && <span className={s.chip}>{q.embargo(it.embargo_until)}</span>}
              <span className={s.chip}>{q.missing(it.missing_count)}</span>
              {it.exact_duplicates > 0 && <span className={`${s.chip} ${s.chipWarn}`}>{q.duplicates(it.exact_duplicates)}</span>}
              {!isVol && <span className={s.chip}>{q.assigned(it.assigned)}</span>}
            </div>
          </li>
        ))}
      </ul>
      {res?.ok && total > PAGE && (
        <div className={s.pager}>
          <button className={s.secondary} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{q.previous}</button>
          <button className={s.secondary} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{q.next}</button>
        </div>
      )}
    </div>
  )
}
