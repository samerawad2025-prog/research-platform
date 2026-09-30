'use client'

// Session, role and the confidentiality gate for the whole review area.
// Nothing here grants anything: the server re-checks every request.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '../LocaleProvider'
import { messagesFor } from '../../lib/i18n'
import { api, authClient } from '../../lib/admin/adminClient'
import s from './admin.module.css'

const Ctx = createContext(null)
export function useAdmin() { return useContext(Ctx) }

export function errorText(t, res) {
  const r = res?.data?.reason
  return t.errors[r] || t.errors.generic
}

function SignIn({ t, onDone }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function submit(e) {
    e.preventDefault()
    const c = authClient()
    if (!c) { setMsg(t.signIn.unavailable); return }
    setBusy(true); setMsg('')
    const { error } = await c.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) { setMsg(!error.status || error.status >= 500 ? t.signIn.unavailable : t.signIn.failed); return }
    setPassword('')
    onDone()
  }
  return (
    <section className={s.card} aria-labelledby="signin-h">
      <h1 id="signin-h" className={s.h1}>{t.signIn.heading}</h1>
      <p className={s.lead}>{t.signIn.intro}</p>
      <form onSubmit={submit} className={s.form} noValidate>
        <label className={s.field}><span>{t.signIn.email}</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        </label>
        <label className={s.field}><span>{t.signIn.password}</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
        </label>
        {msg && <p role="alert" className={s.error}>{msg}</p>}
        <button className={s.primary} type="submit" disabled={busy || !email || !password}>{busy ? t.signIn.working : t.signIn.submit}</button>
      </form>
    </section>
  )
}

function Gate({ t, locale, onDone, signOut }) {
  const [state, setState] = useState({ loading: true })
  const [lang, setLang] = useState(locale)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    let live = true
    api('GET', 'confidentiality').then((r) => { if (live) setState({ loading: false, res: r }) })
    return () => { live = false }
  }, [])
  if (state.loading) return <p className={s.muted} role="status">{t.loading}</p>
  const v = state.res?.data?.version
  if (!state.res.ok) return <section className={s.card}><p role="alert" className={s.error}>{errorText(t, state.res)}</p></section>
  if (!v) {
    return (
      <section className={s.card}><h1 className={s.h1}>{t.confidentiality.heading}</h1>
        <p>{t.confidentiality.none}</p>
        <button className={s.secondary} onClick={signOut}>{t.confidentiality.signOut}</button>
      </section>
    )
  }
  const text = v.texts?.[lang]?.text || ''
  async function agree() {
    setBusy(true); setMsg('')
    const r = await api('POST', 'confidentiality/acknowledge', { versionId: v.id, language: lang })
    setBusy(false)
    if (!r.ok) { setMsg(errorText(t, r)); return }
    onDone()
  }
  return (
    <section className={s.card} aria-labelledby="conf-h">
      <h1 id="conf-h" className={s.h1}>{t.confidentiality.heading}</h1>
      <p className={s.lead}>{t.confidentiality.intro}</p>
      <p className={s.muted}>{t.confidentiality.version(v.label, v.date)}</p>
      <div role="group" aria-label={t.confidentiality.readIn} className={s.row}>
        {['en', 'ar'].map((l) => (
          <button key={l} type="button" className={l === lang ? s.tabOn : s.tab} aria-pressed={l === lang} onClick={() => setLang(l)}>
            {l === 'en' ? t.confidentiality.languageEn : t.confidentiality.languageAr}
          </button>
        ))}
      </div>
      <div className={s.legal} tabIndex={0} role="region" aria-label={t.confidentiality.textRegion} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <pre>{text}</pre>
      </div>
      {msg && <p role="alert" className={s.error}>{msg}</p>}
      <div className={s.row}>
        <button className={s.primary} onClick={agree} disabled={busy}>{busy ? t.confidentiality.working : t.confidentiality.submit}</button>
        <button className={s.secondary} onClick={signOut}>{t.confidentiality.signOut}</button>
      </div>
    </section>
  )
}

export default function AdminProvider({ children }) {
  const { locale } = useLocale()
  const t = messagesFor(locale).admin
  const [phase, setPhase] = useState('loading')
  const [me, setMe] = useState(null)

  const load = useCallback(async () => {
    const c = authClient()
    if (!c) { setPhase('unavailable'); return }
    const { data } = await c.auth.getSession()
    if (!data?.session) { setPhase('signedout'); return }
    const r = await api('GET', 'me')
    if (r.status === 401) { await c.auth.signOut(); setPhase('signedout'); return }
    if (r.status === 404) { setPhase('unavailable'); return }
    if (r.status === 403) { setPhase('forbidden'); return }
    if (!r.ok) { setPhase('unavailable'); return }
    setMe(r.data)
    // Keep this browser's visits out of the public activity counts.
    api('POST', 'metrics-exclusion', {}).catch(() => {})
    setPhase(r.data.confidentiality_required && !r.data.acknowledged ? 'gate' : 'ready')
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
  useEffect(() => { load() }, [load])

  const signOut = useCallback(async () => {
    const c = authClient()
    if (c) await c.auth.signOut()
    setMe(null); setPhase('signedout')
  }, [])

  const value = useMemo(() => ({ me, t, locale, signOut, reload: load }), [me, t, locale, signOut, load])

  let body
  if (phase === 'loading') body = <p className={s.muted} role="status">{t.loading}</p>
  else if (phase === 'signedout') body = <SignIn t={t} onDone={load} />
  else if (phase === 'unavailable') body = <section className={s.card}><h1 className={s.h1}>{t.unavailable.heading}</h1><p>{t.unavailable.body}</p></section>
  else if (phase === 'forbidden') body = <section className={s.card}><h1 className={s.h1}>{t.forbidden.heading}</h1><p>{t.forbidden.body}</p><button className={s.secondary} onClick={signOut}>{t.nav.signOut}</button></section>
  else if (phase === 'gate') body = <Gate t={t} locale={locale} onDone={load} signOut={signOut} />
  else body = children

  return (
    <Ctx.Provider value={value}>
      <div className={s.wrap} data-admin-area>
        {phase === 'ready' && me && (
          <nav className={s.nav} aria-label={t.areaName}>
            <Link href="/admin">{t.nav.queue}</Link>
            {me.role === 'administrator' && <Link href="/admin/settings">{t.nav.settings}</Link>}
            <span className={s.spacer} />
            <span className={s.muted}>{t.nav.signedInAs(t.roles[me.role])}</span>
            <button className={s.link} onClick={signOut}>{t.nav.signOut}</button>
          </nav>
        )}
        {body}
      </div>
    </Ctx.Provider>
  )
}
