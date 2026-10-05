'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/admin/adminClient'
import { useAdmin, errorText } from './AdminProvider'
import s from './admin.module.css'

function useAction(t) {
  const [msg, setMsg] = useState(null)
  const run = async (fn, okText) => {
    setMsg(null)
    const r = await fn()
    setMsg(r.ok ? { ok: true, text: okText || t.saved } : { ok: false, text: errorText(t, r) })
    return r
  }
  return [msg, run]
}

function Staff({ t }) {
  const [list, setList] = useState(null)
  const [form, setForm] = useState({ who: '', role: 'volunteer' })
  const [msg, run] = useAction(t)
  const st = t.settings
  const load = useCallback(async () => { const r = await api('GET', 'staff'); if (r.ok) setList(r.data) }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
  useEffect(() => { load() }, [load])
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  async function add(e) {
    e.preventDefault()
    const w = form.who.trim()
    const body = uuid.test(w) ? { userId: w, role: form.role, active: true } : { email: w, role: form.role, active: true }
    const r = await run(() => api('POST', 'staff', body))
    if (r.ok) { setForm({ who: '', role: form.role }); load() }
  }
  async function toggle(u) {
    const r = await run(() => api('POST', 'staff', { userId: u.user_id, role: u.role, active: !u.active }))
    if (r.ok) load()
  }
  return (
    <section className={s.section} aria-labelledby="staff-h">
      <h2 id="staff-h" className={s.h2}>{st.staffHeading}</h2>
      <p className={s.muted}>{st.staffIntro}</p>
      {list && list.length === 0 && <p>{st.staffNone}</p>}
      {list && list.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>{st.email}</th><th>{st.role}</th><th>{st.active}</th><th /></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.user_id}>
                  <td dir="ltr">{u.email}</td>
                  <td>{t.roles[u.role]}</td>
                  <td>{u.active ? st.active : st.inactive}{u.role === 'volunteer' && <div className={s.muted}>{u.acknowledged ? st.acknowledged(new Date(u.acknowledged_at).toLocaleDateString('en-GB')) : st.notAcknowledged}</div>}</td>
                  <td><button className={s.secondary} onClick={() => toggle(u)}>{u.active ? st.deactivate : st.activate}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className={s.form} onSubmit={add}>
        <h3 className={s.h3}>{st.addStaff}</h3>
        <label className={s.field}><span>{st.emailOrId}</span><input dir="ltr" required value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} /></label>
        <label className={s.field}><span>{st.role}</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="volunteer">{t.roles.volunteer}</option><option value="administrator">{t.roles.administrator}</option>
          </select></label>
        <div><button className={s.primary} type="submit" disabled={!form.who.trim()}>{st.addStaff}</button></div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? s.ok : s.error}>{msg.text}</p>}
      </form>
    </section>
  )
}

function Institution({ inst, t, locale, reload }) {
  const st = t.settings
  const [note, setNote] = useState('')
  const [alias, setAlias] = useState('')
  const [unit, setUnit] = useState({ nameEn: '', nameAr: '', sourceUrl: '', retrievedOn: '' })
  const [msg, run] = useAction(t)
  const name = (locale === 'ar' && inst.name_ar) || inst.name_en
  return (
    <section className={s.section} aria-labelledby={`i-${inst.id}`}>
      <h3 id={`i-${inst.id}`} className={s.h2}>{name}</h3>
      <p><span className={`${s.chip} ${inst.public_collection_eligible ? s.chipOk : s.chipWarn}`}>{inst.public_collection_eligible ? st.eligible : st.notEligible}</span></p>
      <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api('POST', `institutions/${inst.id}/eligibility`, { eligible: !inst.public_collection_eligible, note })); if (r.ok) { setNote(''); reload() } }}>
        <label className={s.field}><span>{st.eligibleNote}</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div><button className={s.secondary} type="submit" disabled={!note.trim()}>{inst.public_collection_eligible ? st.makeNotEligible : st.makeEligible}</button></div>
      </form>
      <h3 className={s.h3}>{st.aliases}</h3>
      <p className={s.bidi}>{inst.aliases.map((a) => a.alias).join(' · ') || t.none}</p>
      <form className={s.row} onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api('POST', `institutions/${inst.id}/aliases`, { alias })); if (r.ok) { setAlias(''); reload() } }}>
        <label className={s.field}><span>{st.alias}</span><input value={alias} onChange={(e) => setAlias(e.target.value)} /></label>
        <button className={s.secondary} type="submit" disabled={!alias.trim()}>{st.addAlias}</button>
      </form>
      <h3 className={s.h3}>{st.units}</h3>
      <p className={s.muted}>{st.unitsNote}</p>
      {inst.units.length === 0 && <p>{st.unitsNone}</p>}
      <ul className={s.list}>
        {inst.units.map((u) => (
          <li key={u.id} className={s.item}>
            <span className={s.bidi}>{u.name_en}{u.name_ar ? ` / ${u.name_ar}` : ''}</span>
            <div className={s.meta}>{u.verification === 'verified' ? st.unitVerified(u.source_retrieved_on) : st.unitUnverified}</div>
            {u.verification !== 'verified' && u.source_url && (
              <button className={s.link} onClick={async () => { const r = await run(() => api('POST', `units/${u.id}/verify`, { sourceUrl: u.source_url, retrievedOn: u.source_retrieved_on })); if (r.ok) reload() }}>{st.verify}</button>
            )}
          </li>
        ))}
      </ul>
      <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api('POST', `institutions/${inst.id}/units`, { kind: 'faculty', nameEn: unit.nameEn || null, nameAr: unit.nameAr || null, sourceUrl: unit.sourceUrl || null, sourceRetrievedOn: unit.retrievedOn || null })); if (r.ok) { setUnit({ nameEn: '', nameAr: '', sourceUrl: '', retrievedOn: '' }); reload() } }}>
        <h3 className={s.h3}>{st.addUnit}</h3>
        <label className={s.field}><span>{st.unitNameEn}</span><input value={unit.nameEn} onChange={(e) => setUnit({ ...unit, nameEn: e.target.value })} /></label>
        <label className={s.field}><span>{st.unitNameAr}</span><input value={unit.nameAr} onChange={(e) => setUnit({ ...unit, nameAr: e.target.value })} dir="rtl" /></label>
        <label className={s.field}><span>{st.sourceUrl}</span><input type="url" dir="ltr" value={unit.sourceUrl} onChange={(e) => setUnit({ ...unit, sourceUrl: e.target.value })} /></label>
        <label className={s.field}><span>{st.retrievedOn}</span><input type="date" value={unit.retrievedOn} onChange={(e) => setUnit({ ...unit, retrievedOn: e.target.value })} /></label>
        <div><button className={s.secondary} type="submit" disabled={!unit.nameEn.trim() && !unit.nameAr.trim()}>{st.addUnit}</button></div>
      </form>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? s.ok : s.error}>{msg.text}</p>}
    </section>
  )
}

export default function AdminSettings() {
  const { me, t, locale } = useAdmin()
  const st = t.settings
  const [insts, setInsts] = useState(null)
  const [form, setForm] = useState({ slug: '', nameEn: '', nameAr: '' })
  const [msg, run] = useAction(t)
  const load = useCallback(async () => { const r = await api('GET', 'institutions'); if (r.ok) setInsts(r.data) }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
  useEffect(() => { load() }, [load])
  if (me.role !== 'administrator') return <p role="alert" className={s.error}>{t.errors.forbidden}</p>
  return (
    <div>
      <h1 className={s.h1}>{st.heading}</h1>
      <Staff t={t} />
      <h2 className={s.h2}>{st.institutionsHeading}</h2>
      <p className={s.muted}>{st.institutionsIntro}</p>
      {!insts && <p className={s.muted} role="status">{t.loading}</p>}
      {insts && insts.map((i) => <Institution key={i.id} inst={i} t={t} locale={locale} reload={load} />)}
      <form className={s.section} onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api('POST', 'institutions', { slug: form.slug, nameEn: form.nameEn, nameAr: form.nameAr || null })); if (r.ok) { setForm({ slug: '', nameEn: '', nameAr: '' }); load() } }}>
        <h3 className={s.h3}>{st.addInstitution}</h3>
        <p className={s.muted}>{st.createdNotEligible}</p>
        <div className={s.form}>
          <label className={s.field}><span>{st.slug}</span><input dir="ltr" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
          <label className={s.field}><span>{st.nameEn}</span><input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label>
          <label className={s.field}><span>{st.nameAr}</span><input dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></label>
          <div><button className={s.secondary} type="submit" disabled={!form.slug.trim() || !form.nameEn.trim()}>{st.addInstitution}</button></div>
          {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? s.ok : s.error}>{msg.text}</p>}
        </div>
      </form>
    </div>
  )
}
