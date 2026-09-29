'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api, authClient } from '../../lib/admin/adminClient'
import { useAdmin, errorText } from './AdminProvider'
import s from './admin.module.css'

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILE_TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }

function Section({ id, title, children }) {
  return <section className={s.section} aria-labelledby={id} data-section={id}><h2 id={id} className={s.h2}>{title}</h2>{children}</section>
}
function Msg({ m }) {
  if (!m) return null
  return <p role={m.ok ? 'status' : 'alert'} className={m.ok ? s.ok : s.error}>{m.text}</p>
}
function Dl({ rows }) {
  return <dl className={s.dl}>{rows.filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, val]) => (<div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd className={s.bidi}>{val}</dd></div>))}</dl>
}

export default function AdminReview({ paperId }) {
  const { me, t, locale } = useAdmin()
  const r = t.review
  const isAdmin = me.role === 'administrator'
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [institutions, setInstitutions] = useState([])
  const [staff, setStaff] = useState([])
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState('')
  const fmt = (x) => (x ? new Date(x).toLocaleString(locale === 'ar' ? 'ar-SD-u-nu-latn' : 'en-GB') : '')
  const day = (x) => (x ? new Date(x).toLocaleDateString(locale === 'ar' ? 'ar-SD-u-nu-latn' : 'en-GB') : '')
  const instName = (i) => (locale === 'ar' && i?.name_ar) || i?.name_en

  const load = useCallback(async () => {
    const res = await api('GET', `reviews/${paperId}`)
    if (!res.ok) { setErr(res); return }
    setErr(null); setD(res.data)
  }, [paperId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
  useEffect(() => { load() }, [load])
  useEffect(() => {
    api('GET', 'institutions').then((x) => x.ok && setInstitutions(x.data))
    if (isAdmin) api('GET', 'staff').then((x) => x.ok && setStaff(x.data))
  }, [isAdmin])

  const say = (k, m) => setMsg((p) => ({ ...p, [k]: m }))
  // One action: run, show the result under its own section, reload.
  const act = async (key, fn, okText) => {
    setBusy(key); say(key, null)
    const res = await fn()
    setBusy('')
    if (res.ok) { await load(); say(key, { ok: true, text: okText || t.saved }) }
    else {
      say(key, { ok: false, text: errorText(t, res) })
      if (res.data?.reason === 'stale_revision') { await load(); say(key, { ok: false, text: t.errors.stale_revision }) }
    }
    return res
  }

  if (err) return <div><Link href="/admin">{t.back}</Link><p role="alert" className={s.error}>{errorText(t, err)}</p></div>
  if (!d) return <p className={s.muted} role="status">{t.loading}</p>

  const p = d.paper
  const openIssues = d.issues.filter((i) => i.state === 'open')
  const isLegacy = !!d.acceptance?.legacy
  const fullText = d.evidence?.setting === 'record_abstract_fulltext'

  return (
    <div>
      <p><Link href="/admin">{t.back}</Link></p>
      <h1 className={`${s.h1} ${s.bidi}`}>{p.title || p.title_ar || t.queue.untitled}</h1>
      <p className={s.banner}>{r.banner}</p>

      <Section id="st-h" title={r.statesHeading}>
        <ul className={s.states}>
          <li><strong>{t.states.submitted}</strong><br />{fmt(p.submitted_at)}</li>
          <li><strong>{t.states.confirmed}</strong><br />{d.states.confirmed ? fmt(d.states.confirmed_at) : t.no}</li>
          <li><strong>{t.states.reviewed}</strong><br />{t.status[d.review.status]}</li>
          <li><strong>{t.states.approval_recorded}</strong><br />{d.states.approval_recorded ? t.yes : t.no}</li>
          <li><strong>{t.states.publication_approved}</strong><br />{d.states.publication_approved ? t.states.approval_in_effect : d.states.approval_recorded ? t.states.approval_not_in_effect : t.no}</li>
        </ul>
        <p className={s.muted}>{r.notPublic}</p>
      </Section>

      <div className={s.two}>
        <div>
          <Section id="md-h" title={r.metadataHeading}>
            <Dl rows={[
              [r.labels.title, p.title], [r.labels.title_ar, p.title_ar], [r.labels.abstract, p.abstract], [r.labels.abstract_ar, p.abstract_ar],
              [r.labels.supervisor_name, p.supervisor_name], [r.labels.year, p.year], [r.labels.university, p.university], [r.labels.faculty, p.faculty],
              [r.labels.degree_type, p.degree_type], [r.labels.document_type, p.document_type],
              [r.labels.extraction, p.manual_entry_source ? r.extractionValues.manual : r.extractionValues.automatic],
            ]} />
            <h3 className={s.h3}>{r.authors}</h3>
            {d.authors.length === 0 ? <p>{r.authorsNone}</p> : <ol>{d.authors.map((a, i) => <li key={i} className={s.bidi}>{a.name}</li>)}</ol>}
          </Section>

          <Section id="sub-h" title={r.submitter}>
            {isAdmin
              ? <Dl rows={[[r.submitterName, d.submitter.name], [r.submitterEmail, d.submitter.email], [r.submitterWhatsapp, d.submitter.whatsapp_number]]} />
              : <p className={s.muted}>{r.contactHidden}</p>}
            <p>{r.claimedRole}: <strong>{r.role?.[d.submitter.claimed_role] || t.role[d.submitter.claimed_role] || t.role.unknown}</strong></p>
            <p className={s.muted}>{r.identityNotVerified}</p>
          </Section>

          <Section id="ev-h" title={r.evidenceHeading}>
            {isLegacy ? <p>{r.evidenceLegacy}</p> : (
              <Dl rows={[
                [r.acceptedAt, fmt(d.acceptance.accepted_at)], [r.agreement, d.acceptance.agreement_version_id],
                [r.processing, r.processingValues[d.acceptance.processing_decision] || d.acceptance.processing_decision],
                [r.declaredAuthors, d.acceptance.declared_authors ? String(d.acceptance.declared_authors) : null],
              ]} />
            )}
            {isLegacy && <p>{r.legacyScope}: <strong>{r.legacyScopeValues[p.legacy_publication_scope] || p.legacy_publication_scope || t.unknown}</strong></p>}
            <p>{r.effectiveSetting}: <strong>{t.setting[d.evidence.setting || 'none']}</strong></p>
            <ul>{(d.evidence.problems || []).map((c) => <li key={c}>{r.problems[c] || c}</li>)}</ul>
          </Section>

          <Section id="ck-h" title={r.checklistHeading}>
            <p className={s.muted}>{r.checklistRule}</p>
            {d.metadata_check.missing.length === 0 ? <p className={s.ok}>{r.checklistOk}</p> : (<><h3 className={s.h3}>{r.checklistBlocking}</h3><ul>{d.metadata_check.missing.map((c) => <li key={c}>{r.missing[c] || c}</li>)}</ul></>)}
            {d.metadata_check.advisory.length > 0 && (<><h3 className={s.h3}>{r.checklistAdvisory}</h3><ul>{d.metadata_check.advisory.map((c) => <li key={c}>{r.missing[c] || c}</li>)}</ul></>)}
          </Section>

          <Section id="dup-h" title={r.duplicatesHeading}>
            <p className={s.muted}>{r.duplicatesIntro}</p>
            {d.duplicates.items.length === 0 && d.duplicates.hidden_count === 0 && <p>{r.duplicatesNone}</p>}
            <ul className={s.list}>{d.duplicates.items.map((x) => (
              <li key={x.paper_id} className={s.item}>
                <Link href={`/admin/review/${x.paper_id}`} className={s.bidi}>{x.title || t.queue.untitled}</Link>
                <div className={s.meta}><span>{r.duplicateKinds[x.kind]}</span>{x.kind === 'similar_title' && <span>{r.duplicateScore(x.score)}</span>}{x.year && <span>{x.year}</span>}<span>{t.status[x.status] || ''}</span></div>
              </li>))}</ul>
            {d.duplicates.hidden_count > 0 && <p className={s.muted}>{r.duplicatesHidden(d.duplicates.hidden_count)}</p>}
          </Section>

          <Documents {...{ d, t, r, isAdmin, act, busy, msg, say, paperId, fullText, fmt }} />

          <Section id="is-h" title={r.issuesHeading}>
            {d.issues.length === 0 && <p>{r.issuesNone}</p>}
            <ul className={s.list}>{d.issues.map((i) => <IssueItem key={i.id} i={i} t={t} r={r} act={act} paperId={paperId} busy={busy} />)}</ul>
            <IssueForm t={t} r={r} act={act} paperId={paperId} busy={busy} msg={msg.issue} approved={d.states.approval_recorded} />
          </Section>

          <Section id="nt-h" title={r.notesHeading}>
            <p className={s.muted}>{r.notesIntro}</p>
            {d.notes.length === 0 && <p>{r.notesNone}</p>}
            <ul className={s.list}>{d.notes.map((n) => <li key={n.id} className={s.item}><span className={s.bidi} style={{ whiteSpace: 'pre-wrap' }}>{n.body}</span><div className={s.meta}><span>{t.roles[n.author_role]}</span><span>{fmt(n.created_at)}</span></div></li>)}</ul>
            <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const x = await act('note', () => api('POST', `reviews/${paperId}/notes`, { body: note })); if (x.ok) setNote('') }}>
              <label className={s.field}><span>{r.noteText}</span><textarea value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} /></label>
              <div><button className={s.secondary} disabled={!note.trim() || busy === 'note'}>{r.addNote}</button></div>
              <Msg m={msg.note} />
            </form>
          </Section>

          <Recommend {...{ t, r, act, busy, paperId, msg }} />
        </div>

        <aside>
          <Section id="bl-h" title={r.blockersHeading}>
            {d.preconditions.ok ? <p className={s.ok}>{r.blockersNone}</p> : (
              <ul>{d.preconditions.failures.map((f, i) => {
                const fn = r.blockers[f.code]
                let text = f.code
                if (typeof fn === 'function') {
                  const dt = f.detail
                  text = fn(f.code === 'institution_not_eligible' ? dt : f.code === 'blocking_issue_open' ? Number(dt) : Array.isArray(dt) ? dt.map((x) => r.missing[x] || r.problems[x] || x).join(', ').replace(/\.+$/, '') : dt)
                } else if (fn) text = fn
                return <li key={i}>{text}</li>
              })}</ul>
            )}
          </Section>

          {isAdmin && <Decide {...{ d, t, r, act, busy, paperId, msg, fullText }} />}

          <InstitutionBox {...{ d, t, r, institutions, act, busy, paperId, msg, isAdmin, instName, lang: locale }} />
          {isAdmin && isLegacy && <LegacyBox {...{ d, t, r, act, busy, paperId, msg }} />}
          {isAdmin && <AuthorityBox {...{ d, t, r, act, busy, paperId, msg, day }} />}
          {isAdmin && <EmbargoBox {...{ d, t, r, act, busy, paperId, msg }} />}
          {isAdmin && <Eligibility {...{ d, t, r }} />}
          {d.approvals?.length > 0 && (
            <Section id="ap-h" title={r.approvalsHeading}>
              <p className={s.muted}>{r.approvalsIntro}</p>
              <ul className={s.list}>{d.approvals.map((a, i) => (
                <li key={a.id} className={s.item}>
                  {fmt(a.approved_at)} · {t.setting[a.publication_setting] || a.publication_setting}
                  <div className={s.chips}>
                    {i === 0 && <span className={s.chip}>{r.approvalLatest}</span>}
                    {a.suspended_by_issue && <span className={`${s.chip} ${s.chipBad}`}>{r.approvalSuspended}</span>}
                  </div>
                </li>))}</ul>
            </Section>
          )}
          {isAdmin && <Assignments {...{ d, t, r, staff, act, busy, paperId, msg }} />}

          <Section id="hi-h" title={r.historyHeading}>
            <p className={s.muted}>{r.historyIntro}</p>
            {d.events.length === 0 && <p>{r.historyNone}</p>}
            <ol className={s.events} reversed>{d.events.map((e) => (
              <li key={e.id}>
                <strong>{r.actions[e.action] || e.action}</strong>
                <div className={s.muted}>{fmt(e.at)} · {r.by(e.actor_role === 'submitter' ? r.submitterActor : e.actor_role?.startsWith('database') ? r.databaseActor : e.actor_email || t.roles[e.actor_role] || r.unknownActor)}</div>
                {e.detail?.reason && <div className={s.bidi}>{e.detail.reason}</div>}
                {e.detail?.changed_fields && <div className={s.muted}>{r.changedFields(e.detail.changed_fields.join(', '))}</div>}
              </li>))}</ol>
          </Section>
        </aside>
      </div>
    </div>
  )
}

function IssueItem({ i, t, r, act, paperId, busy }) {
  const [res, setRes] = useState('')
  return (
    <li className={s.item}>
      <span className={s.bidi}>{i.description}</span>
      <div className={s.chips}>
        <span className={s.chip}>{r.issueKinds[i.kind]}</span>
        <span className={`${s.chip} ${i.blocking ? s.chipWarn : ''}`}>{i.blocking ? r.issueBlocking : r.issueNonBlocking}</span>
        <span className={`${s.chip} ${i.state === 'open' ? '' : s.chipOk}`}>{i.state === 'open' ? r.issueOpen : r.issueResolved}</span>
      </div>
      {i.suspends_approval_id && <p className={s.muted}>{r.issueSuspends}</p>}
      {i.resolution && <p className={s.bidi}>{i.resolution}</p>}
      {i.state === 'open' && (
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); act('issue', () => api('POST', `reviews/${paperId}/issues/${i.id}/resolve`, { resolution: res })) }}>
          <label className={s.field}><span>{r.resolution}</span><input value={res} onChange={(e) => setRes(e.target.value)} /></label>
          <button className={s.secondary} disabled={!res.trim() || busy === 'issue'}>{r.resolveIssue}</button>
        </form>
      )}
    </li>
  )
}

function IssueForm({ t, r, act, paperId, busy, msg, approved }) {
  const [f, setF] = useState({ kind: 'metadata', description: '', blocking: true })
  return (
    <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const x = await act('issue', () => api('POST', `reviews/${paperId}/issues`, f)); if (x.ok) setF({ ...f, description: '' }) }}>
      <h3 className={s.h3}>{r.raiseIssue}</h3>
      <label className={s.field}><span>{r.issueKind}</span>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(r.issueKinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className={s.field}><span>{r.issueDescription}</span><textarea value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      {f.blocking && approved && <p className={s.banner}>{r.blockingIssueWarning}</p>}
      <label className={s.check}><input type="checkbox" checked={f.blocking} onChange={(e) => setF({ ...f, blocking: e.target.checked })} /><span>{r.issueBlockingCheck}</span></label>
      <div><button className={s.secondary} disabled={!f.description.trim() || busy === 'issue'}>{r.raiseIssue}</button></div>
      <Msg m={msg} />
    </form>
  )
}

function Recommend({ t, r, act, busy, paperId, msg }) {
  const [f, setF] = useState({ recommendation: 'approve', reason: '' })
  return (
    <Section id="rc-h" title={r.recommendHeading}>
      <p className={s.muted}>{r.recommendIntro}</p>
      <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const x = await act('rec', () => api('POST', `reviews/${paperId}/recommendation`, f)); if (x.ok) setF({ ...f, reason: '' }) }}>
        <label className={s.field}><span>{r.recommendChoose}</span>
          <select value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })}>{Object.entries(r.recommendOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className={s.field}><span>{r.recommendReason}</span><textarea value={f.reason} maxLength={2000} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <div><button className={s.secondary} disabled={!f.reason.trim() || busy === 'rec'}>{r.recommend}</button></div>
        <Msg m={msg.rec} />
      </form>
    </Section>
  )
}

function Decide({ d, t, r, act, busy, paperId, msg, fullText }) {
  const [f, setF] = useState({ decision: 'reviewed', reason: '', version: '' })
  const needReason = ['needs_changes', 'declined', 'withdrawn'].includes(f.decision)
  const versions = d.documents.versions.filter((v) => ['proposed', 'approved'].includes(v.state))
  const [note, setNote] = useState(null)
  async function submit(e) {
    e.preventDefault()
    setNote(null)
    const body = { decision: f.decision, reason: f.reason || null, expectedRevision: d.revision, disseminationVersionId: f.decision === 'approved' && fullText ? f.version || null : null }
    const x = await act('decide', () => api('POST', `reviews/${paperId}/decision`, body), r.decided(r.decideOptions[f.decision]))
    if (x.ok) setNote(f.decision)
  }
  return (
    <Section id="dc-h" title={r.decideHeading}>
      <form className={s.form} onSubmit={submit}>
        <label className={s.field}><span>{r.decideHeading}</span>
          <select value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}>{Object.entries(r.decideOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className={s.field}><span>{r.decideReason}{needReason ? ` (${t.required})` : ` (${t.optional})`}</span>
          <textarea value={f.reason} maxLength={2000} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-required={needReason} /></label>
        {f.decision === 'approved' && fullText && (
          <label className={s.field}><span>{r.decideDissemination}</span>
            <select value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })}>
              <option value="">{r.decideDisseminationNone}</option>
              {versions.map((v) => <option key={v.id} value={v.id}>{r.versionOrigins[v.origin]} · {(v.sha256 || '').slice(0, 10)}</option>)}
            </select></label>
        )}
        <div><button className={s.primary} disabled={busy === 'decide' || (needReason && !f.reason.trim())}>{busy === 'decide' ? r.decideWorking : r.decideSubmit}</button></div>
        <Msg m={msg.decide} />
        {msg.decide?.ok && <p className={s.banner}>{r.notNotified}</p>}
        {note === 'approved' && <p className={s.muted}>{r.approvedNote}</p>}
        {note === 'withdrawn' && <p className={s.muted}>{r.withdrawnNote}</p>}
      </form>
    </Section>
  )
}

function InstitutionBox({ d, t, r, institutions, act, busy, paperId, msg, isAdmin, instName, lang }) {
  const i = d.institution
  const [f, setF] = useState({ inst: i.institution_id || '', unit: i.unit_id || '' })
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
  useEffect(() => { setF({ inst: i.institution_id || '', unit: i.unit_id || '' }) }, [i.institution_id, i.unit_id])
  const chosen = institutions.find((x) => x.id === f.inst)
  return (
    <Section id="in-h" title={r.institutionHeading}>
      <Dl rows={[[r.institutionSubmitted, [i.submitted_university, i.submitted_faculty].filter(Boolean).join(' / ')]]} />
      {i.institution_id
        ? <p>{r.institutionResolved}: <strong className={s.bidi}>{instName(i)}</strong> · {t.queue.institutionBasis[i.basis] || ''}<br />{i.eligible ? r.institutionEligible : r.institutionNotEligible}</p>
        : <p>{i.basis === 'reviewer_none' ? t.queue.institutionBasis.reviewer_none : r.institutionUnresolved}</p>}
      <p className={s.muted}>{r.unit}: {i.unit_id ? <span className={s.bidi}>{(lang === 'ar' && i.unit_name_ar) || i.unit_name_en}{i.unit_verification === 'verified' ? '' : ` (${r.unitUnverified})`}</span> : r.unitNone}</p>
      {isAdmin && (
        <form className={s.form} onSubmit={(e) => { e.preventDefault(); act('inst', () => api('POST', `reviews/${paperId}/institution`, f.inst === 'none' ? { none: true } : { institutionId: f.inst || null, unitId: f.unit || null })) }}>
          <label className={s.field}><span>{r.chooseInstitution}</span>
            <select value={f.inst} onChange={(e) => setF({ inst: e.target.value, unit: '' })}>
              <option value="">—</option><option value="none">{r.noInstitution}</option>
              {institutions.map((x) => <option key={x.id} value={x.id}>{instName(x)}</option>)}
            </select></label>
          {chosen && chosen.units.length > 0 && (
            <label className={s.field}><span>{r.chooseUnit}</span>
              <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
                <option value="">—</option>{chosen.units.map((u) => <option key={u.id} value={u.id}>{u.name_en || u.name_ar}</option>)}
              </select></label>
          )}
          <div><button className={s.secondary} disabled={!f.inst || busy === 'inst'}>{r.saveInstitution}</button></div>
          <Msg m={msg.inst} />
        </form>
      )}
    </Section>
  )
}

function LegacyBox({ d, t, r, act, busy, paperId, msg }) {
  const [f, setF] = useState({ setting: d.review.legacy_setting || 'hold', note: '' })
  return (
    <Section id="lg-h" title={r.legacyHeading}>
      <p className={s.muted}>{r.legacyIntro}</p>
      <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const x = await act('legacy', () => api('POST', `reviews/${paperId}/legacy-setting`, f)); if (x.ok) setF({ ...f, note: '' }) }}>
        <label className={s.field}><span>{r.legacyChoose}</span>
          <select value={f.setting} onChange={(e) => setF({ ...f, setting: e.target.value })}>{Object.entries(r.legacyOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className={s.field}><span>{r.legacyNote}</span><textarea value={f.note} maxLength={2000} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <div><button className={s.secondary} disabled={!f.note.trim() || busy === 'legacy'}>{r.saveLegacy}</button></div>
        <Msg m={msg.legacy} />
      </form>
    </Section>
  )
}

function AuthorityBox({ d, t, r, act, busy, paperId, msg, day }) {
  const [n, setN] = useState('')
  const on = !!d.review.authority_verified_at
  return (
    <Section id="au-h" title={r.authorityHeading}>
      <p className={s.muted}>{r.authorityIntro}</p>
      <p>{on ? r.authorityVerified(day(d.review.authority_verified_at)) : r.authorityNotVerified}</p>
      <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const x = await act('auth', () => api('POST', `reviews/${paperId}/authority`, { verified: !on, note: n })); if (x.ok) setN('') }}>
        <label className={s.field}><span>{r.authorityNote}</span><textarea value={n} maxLength={2000} onChange={(e) => setN(e.target.value)} /></label>
        <div><button className={s.secondary} disabled={!n.trim() || busy === 'auth'}>{on ? r.authorityClear : r.authorityMark}</button></div>
        <Msg m={msg.auth} />
      </form>
    </Section>
  )
}

function EmbargoBox({ d, t, r, act, busy, paperId, msg }) {
  const [f, setF] = useState({ until: d.review.embargo_until || '', note: '' })
  return (
    <Section id="em-h" title={r.embargoHeading}>
      <p className={s.muted}>{r.embargoIntro}</p>
      <form className={s.form} onSubmit={(e) => { e.preventDefault(); act('emb', () => api('POST', `reviews/${paperId}/embargo`, { until: f.until || null, note: f.note || null })) }}>
        <label className={s.field}><span>{r.embargoUntil}</span><input type="date" value={f.until || ''} onChange={(e) => setF({ ...f, until: e.target.value })} /></label>
        <label className={s.field}><span>{r.embargoNote}</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <div className={s.row}>
          <button className={s.secondary} disabled={!f.until || busy === 'emb'}>{r.saveEmbargo}</button>
          {d.review.embargo_until && <button type="button" className={s.secondary} onClick={() => { setF({ until: '', note: '' }); act('emb', () => api('POST', `reviews/${paperId}/embargo`, { until: null, note: null })) }}>{r.clearEmbargo}</button>}
        </div>
        <Msg m={msg.emb} />
      </form>
    </Section>
  )
}

function Eligibility({ d, t, r }) {
  const e = d.eligibility
  const list = (arr) => <ul>{(arr || []).map((c) => <li key={c}>{r.reasons[c] || c}</li>)}</ul>
  return (
    <Section id="el-h" title={r.eligibilityHeading}>
      <p className={s.muted}>{r.eligibilityIntro}</p>
      <p><strong>{r.eligibilityRecord}:</strong> {e.record_public ? r.eligibilityAllowed : r.eligibilityBlocked}</p>
      {!e.record_public && list(e.reasons)}
      <p><strong>{r.eligibilityFulltext}:</strong> {e.fulltext_public ? r.eligibilityAllowed : r.eligibilityBlocked}</p>
      {!e.fulltext_public && list(e.fulltext_reasons)}
    </Section>
  )
}

function Assignments({ d, t, r, staff, act, busy, paperId, msg }) {
  const [v, setV] = useState('')
  const assigned = new Set((d.assignments || []).map((a) => a.volunteer_id))
  const options = staff.filter((u) => u.role === 'volunteer' && u.active && !assigned.has(u.user_id))
  return (
    <Section id="as-h" title={r.assignmentsHeading}>
      {(d.assignments || []).length === 0 && <p>{r.assignmentsNone}</p>}
      <ul className={s.list}>{(d.assignments || []).map((a) => (
        <li key={a.volunteer_id} className={s.item}><span dir="ltr">{a.email}</span>{' '}
          <button className={s.link} onClick={() => act('assign', () => api('POST', `reviews/${paperId}/assignments/${a.volunteer_id}/end`, {}))}>{r.endAssignment}</button></li>))}</ul>
      <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const x = await act('assign', () => api('POST', `reviews/${paperId}/assignments`, { volunteerId: v })); if (x.ok) setV('') }}>
        <label className={s.field}><span>{r.chooseVolunteer}</span>
          <select value={v} onChange={(e) => setV(e.target.value)}><option value="">—</option>{options.map((u) => <option key={u.user_id} value={u.user_id}>{u.email}</option>)}</select></label>
        <div><button className={s.secondary} disabled={!uuidRe.test(v) || busy === 'assign'}>{r.assign}</button></div>
        <Msg m={msg.assign} />
      </form>
    </Section>
  )
}

function Documents({ d, t, r, isAdmin, act, busy, msg, say, paperId, fullText, fmt }) {
  const [file, setFile] = useState(null)
  const [redaction, setRedaction] = useState('')
  const [reasons, setReasons] = useState({})
  const doc = d.documents
  async function openFile(versionId) {
    say('open', null)
    const x = await api('POST', `reviews/${paperId}/files/access`, { versionId: versionId || null })
    if (!x.ok) { say('open', { ok: false, text: errorText(t, x) }); return }
    window.open(x.data.url, '_blank', 'noopener,noreferrer')
  }
  async function upload(e) {
    e.preventDefault()
    if (!file) return
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    say('up', null)
    const created = await act('up', () => api('POST', `reviews/${paperId}/documents`, { origin: 'redacted_copy', redactionNote: redaction, file: { name: file.name, size: file.size, type: FILE_TYPES[ext] || file.type } }), r.uploading)
    if (!created.ok) return
    const c = authClient()
    const up = created.data.upload
    const put = await c.storage.from(up.bucket).uploadToSignedUrl(up.path, up.token, file, { contentType: FILE_TYPES[ext] || file.type })
    if (put.error) { say('up', { ok: false, text: t.errors.storage_unavailable }); return }
    await act('up', () => api('POST', `reviews/${paperId}/documents/${created.data.versionId}/finalize`, {}))
    setFile(null); setRedaction('')
  }
  return (
    <Section id="dm-h" title={r.documentsHeading}>
      <p className={s.muted}>{r.filesLogged}</p>
      <p><strong>{r.original}</strong></p>
      <Dl rows={[[r.originalHash, doc.original.sha256 || r.hashUnknown]]} />
      <div className={s.row}><button className={s.secondary} onClick={() => openFile(null)}>{r.openOriginal}</button></div>
      <Msg m={msg.open} />
      <h3 className={s.h3}>{r.versionsHeading}</h3>
      {!fullText && <p className={s.muted}>{r.versionsNotNeeded}</p>}
      {doc.versions.length === 0 && <p>{r.versionsNone}</p>}
      <ul className={s.list}>{doc.versions.map((v) => (
        <li key={v.id} className={s.item}>
          <strong>{r.versionOrigins[v.origin]}</strong> · {r.versionStates[v.state]}
          <div className={s.meta}><span dir="ltr">{(v.sha256 || '').slice(0, 16)}</span><span>{fmt(v.created_at)}</span></div>
          {v.redaction_note && <p className={s.bidi}>{r.redactionNote}: {v.redaction_note}</p>}
          {['proposed', 'approved'].includes(v.state) && <button className={s.link} onClick={() => openFile(v.id)}>{r.openVersion}</button>}
          {isAdmin && ['pending_upload', 'recorded', 'proposed'].includes(v.state) && (
            <form className={s.row} onSubmit={(e) => { e.preventDefault(); act('vw', () => api('POST', `reviews/${paperId}/documents/${v.id}/withdraw`, { reason: reasons[v.id] || '' })) }}>
              <label className={s.field}><span>{r.withdrawVersionReason}</span><input value={reasons[v.id] || ''} onChange={(e) => setReasons({ ...reasons, [v.id]: e.target.value })} /></label>
              <button className={s.danger} disabled={!(reasons[v.id] || '').trim()}>{r.withdrawVersion}</button>
            </form>
          )}
        </li>))}</ul>
      <Msg m={msg.vw} />
      {isAdmin && fullText && (
        <>
          <div className={s.row}>
            <button className={s.secondary} disabled={busy === 'des'} onClick={() => act('des', () => api('POST', `reviews/${paperId}/documents`, { origin: 'original_reviewed' }))}>{busy === 'des' ? r.designating : r.designate}</button>
          </div>
          <p className={s.muted}>{r.designateHelp}</p>
          <Msg m={msg.des} />
          <form className={s.form} onSubmit={upload}>
            <h3 className={s.h3}>{r.uploadRedacted}</h3>
            <p className={s.muted}>{r.uploadHelp}</p>
            <label className={s.field}><span>{r.chooseFile}</span><input type="file" accept=".pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
            <label className={s.field}><span>{r.redactionNote}</span><textarea value={redaction} maxLength={2000} onChange={(e) => setRedaction(e.target.value)} /></label>
            <div><button className={s.secondary} disabled={!file || !redaction.trim() || busy === 'up'}>{busy === 'up' ? r.uploading : r.uploadRedacted}</button></div>
            <Msg m={msg.up} />
          </form>
        </>
      )}
    </Section>
  )
}
