'use client'

// Phase 3 M2B: the submission form on the server-controlled acceptance
// flow (docs/submission-flow.md).
//
//   GET  /api/submissions/terms     agreement text + signed processing offer
//   POST /api/submissions/intent    acceptance recorded by the server, and
//                                   an upload link for one private path
//   (upload with that link)
//   POST /api/submissions/finalize  the server checks the file and creates
//                                   the submission exactly once
//
// The browser never decides processing, paths, hashes or legal text; it
// shows what the server offered and sends back the signed offer. Decision
// logic lives in lib/submission/clientFlow.js, where it is tested.
//
// There is deliberately no fallback to the legacy anonymous path: if the
// new flow is unavailable, the form says so and submits nothing.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabaseClient'
import PhoneField from './PhoneField'
import AgreementText from './AgreementText'
import Button from './ui/Button'
import { DEFAULT_COUNTRY, validateWhatsApp, formatAsYouType } from '../lib/validation/phone'
import { useLocale } from './LocaleProvider'
import { dirFor, messagesFor } from '../lib/i18n'
import {
  intentBody,
  snapshotKey,
  reusableIntent,
  classifyIntent,
  classifyUpload,
  classifyFinalize,
  savePending,
  readPending,
  clearPending,
  markReceived,
} from '../lib/submission/clientFlow'
import styles from './SubmissionForm.module.css'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const FILE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const ROLES = ['author', 'coauthor', 'authorized_depositor']
const SETTINGS = ['record_abstract', 'record_abstract_fulltext']
// Refresh an offer a little before it expires, so a researcher is never
// sent to accept one the server is about to refuse.
const OFFER_REFRESH_MARGIN_MS = 60_000

function isEmailish(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

// Some browsers report no MIME type for a DOCX; the extension decides and
// the server checks the real content at finalization.
function fileTypeOf(file) {
  const ext = (file?.name.split('.').pop() || '').toLowerCase()
  return FILE_TYPES[ext] ? { ext, type: FILE_TYPES[ext] } : null
}

async function postJson(url, body) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json().catch(() => null) }
  } catch {
    return { status: 0, body: null } // network
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export default function AcceptanceSubmissionForm() {
  const router = useRouter()
  const { locale } = useLocale()
  const all = messagesFor(locale)
  const t = all.submission
  const a = all.acceptance
  const dir = dirFor(locale)
  const fileId = useId()
  const fileInputRef = useRef(null)

  const [terms, setTerms] = useState({ status: 'loading', data: null })
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    whatsappCountry: DEFAULT_COUNTRY,
    role: '',
    authors: [''],
    setting: 'record_abstract',
    // The researcher's own processing choice. Gemini reading is the
    // default; manual entry keeps the document away from it entirely. Only
    // honoured as 'automatic' when the server offered automatic reading.
    processing: 'automatic',
    // The agreement id the box was ticked for. Acceptance counts only for
    // the agreement currently shown, so a language switch withdraws it.
    acceptedFor: null,
    website: '',
  })
  const [file, setFile] = useState(null)
  const fileSerial = useRef(0)
  const [touched, setTouched] = useState({})
  // idle | intent | upload | finalize | narrowed | opening. 'opening' is
  // progress (stored; the next page is loading), never a completion screen.
  const [phase, setPhase] = useState('idle')
  const [notice, setNotice] = useState(null) // key in a.notices
  const [error, setError] = useState(null) // key in a.errors
  const [recovery, setRecovery] = useState(null) // pending intent from an earlier attempt
  // The agreement the current intent accepted. While an intent is being
  // created, awaits "Continue" or is uploading and finalizing, the form is
  // locked to that snapshot: this agreement stays shown whatever the
  // interface language, and no control can change.
  const [pinnedAgreementId, setPinnedAgreementId] = useState(null)
  const busy = useRef(false)
  // Set once a submission has been finalized: the form stays closed while
  // the browser navigates, so a queued click or Enter cannot start another.
  const done = useRef(false)
  const [finished, setFinished] = useState(false)
  const intentRef = useRef(null)
  // A notice appears at the top of the form while the person is at its
  // Submit button; focus moves to it so it is seen and announced.
  const noticeRef = useRef(null)
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const whatsapp = useMemo(() => validateWhatsApp(form.whatsapp, form.whatsappCountry), [form.whatsapp, form.whatsappCountry])

  // The agreement shown: the one in the interface language, else the
  // first one offered (with a note). What is shown is what is accepted.
  const agreement = useMemo(() => {
    const list = terms.data?.agreements || []
    if (pinnedAgreementId) return list.find((x) => x.id === pinnedAgreementId) || null
    return list.find((x) => x.language === locale) || list[0] || null
  }, [terms.data, locale, pinnedAgreementId])

  const loadTerms = useCallback(async (why) => {
    let res
    try {
      const r = await fetch('/api/submissions/terms', { cache: 'no-store' })
      res = { status: r.status, body: await r.json().catch(() => null) }
    } catch {
      res = { status: 0, body: null }
    }
    if (res.status === 200 && res.body?.available && res.body?.offer?.token) {
      setTerms({ status: 'ready', data: res.body })
      if (why) {
        // Any refresh after the researcher has seen the terms clears their
        // acceptance: they accept again, knowingly.
        setForm((f) => (f.acceptedFor ? { ...f, acceptedFor: null } : f))
        setNotice(why)
      }
      return true
    }
    setTerms({ status: res.status === 200 || res.status === 404 ? 'unavailable' : 'error', data: null })
    return false
  }, [])

  useEffect(() => {
    // Loaded on mount only; loadTerms sets state after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTerms(null)
    // The server decides what became of an earlier attempt: it may have
    // been finalized even though the answer never arrived, or even after
    // the intent's own expiry. So any pending attempt is offered for
    // completion; only the server's answer (or the person) clears it.
    const pending = readPending()
    if (pending) setRecovery(pending)
  }, [loadTerms])

  // Offer expiry: refresh before it lapses, but never under an attempt
  // that has already recorded its acceptance.
  const offerExpiresAt = terms.data?.offer?.expiresAt
  useEffect(() => {
    if (!offerExpiresAt) return undefined
    const ms = Math.max(0, Date.parse(offerExpiresAt) - Date.now() - OFFER_REFRESH_MARGIN_MS)
    const timer = setTimeout(() => {
      if (!busy.current && !intentRef.current) loadTerms('offer_expired')
    }, ms)
    return () => clearTimeout(timer)
  }, [offerExpiresAt, loadTerms])

  const accepted = Boolean(agreement && form.acceptedFor === agreement.id)
  // Ticked for the other language's text: it must be accepted again.
  const languageNotice = Boolean(form.acceptedFor && agreement && form.acceptedFor !== agreement.id)

  const kind = file ? fileTypeOf(file) : null
  const fileOk = Boolean(file && kind && file.size > 0 && file.size <= MAX_FILE_BYTES)
  const authorsOk = form.role !== 'authorized_depositor' || (form.authors.some((x) => x.trim()) && form.authors.every((x) => x.trim().length <= 200))
  const working = phase === 'intent' || phase === 'upload' || phase === 'finalize'
  // Locked to the accepted snapshot (see pinnedAgreementId).
  const locked = working || phase === 'narrowed' || finished

  const outstanding = []
  if (!form.fullName.trim()) outstanding.push(t.outstanding.name)
  if (!isEmailish(form.email)) outstanding.push(t.outstanding.email)
  if (whatsapp.state === 'invalid') outstanding.push(t.outstanding.whatsapp)
  if (!form.role) outstanding.push(a.outstanding.role)
  if (!authorsOk) outstanding.push(a.outstanding.authors)
  if (!fileOk) outstanding.push(t.outstanding.file)
  if (!accepted) outstanding.push(a.outstanding.accept)
  const ready = terms.status === 'ready' && agreement && outstanding.length === 0
  const canSubmit = ready && !working && phase !== 'narrowed' && !recovery

  function update(field, value) {
    if (locked) return // the disabled controls already refuse; never drift
    setForm((f) => ({ ...f, [field]: value }))
  }

  // Unlocks the form: the snapshot is dropped, so any submission after an
  // edit is a new intent with a fresh acceptance record.
  function unlock() {
    setPinnedAgreementId(null)
    setPhase('idle')
  }
  function touch(field) {
    setTouched((x) => ({ ...x, [field]: true }))
  }

  function discardIntent() {
    intentRef.current = null
    clearPending()
  }

  // Terminal outcomes clear the recovery offer; temporary ones keep it.
  function endRecovery() {
    clearPending()
    setRecovery(null)
  }

  // ---------------------------------------------------------------- steps
  async function finalize(intent) {
    setPhase('finalize')
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await postJson('/api/submissions/finalize', { intentId: intent.intentId, intentToken: intent.intentToken })
      const out = res.status === 0 ? { kind: 'retry' } : classifyFinalize(res.status, res.body)
      if (out.kind === 'done') {
        done.current = true
        setFinished(true)
        setPhase('opening')
        clearPending()
        intentRef.current = null
        markReceived()
        if (res.body.extraction?.mayStart) {
          // keepalive: the request must survive the navigation below.
          fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: res.body.confirmationToken }),
            keepalive: true,
          }).catch(() => {})
        }
        router.push(`/confirm/${res.body.confirmationToken}`)
        return 'done'
      }
      if (out.kind === 'reupload') return 'reupload'
      if (out.kind === 'expired') {
        discardIntent()
        setError('submissionExpired')
        return 'terminal'
      }
      if (out.kind === 'error') {
        if (out.discard) discardIntent()
        setError(out.error)
        return out.discard ? 'terminal' : 'transient'
      }
      // retry: a lost response or a transient failure. Same call, same
      // result on the server; wait a little longer each time.
      await wait(1000 * (attempt + 1))
    }
    setError('network')
    return 'transient'
  }

  async function uploadAndFinalize(intent) {
    for (let round = 0; round < 2; round++) {
      if (!intent.uploaded) {
        // Always the File captured when this intent was created, never
        // whatever the file input holds now.
        if (!intent.file) {
          setError('uploadFailed')
          return
        }
        setPhase('upload')
        let outcome
        try {
          const { error: upErr } = await supabase.storage.from('papers').uploadToSignedUrl(intent.upload.path, intent.upload.token, intent.file, {
            contentType: intent.fileType,
          })
          outcome = classifyUpload(upErr)
        } catch {
          outcome = 'failed'
        }
        if (outcome === 'linkExpired') {
          discardIntent()
          setError('uploadLinkExpired')
          return
        }
        if (outcome === 'tooLarge') {
          discardIntent()
          setError('objectMismatch')
          return
        }
        if (outcome !== 'uploaded') {
          setError('uploadFailed') // the intent is kept: a retry reuses it
          return
        }
        intent.uploaded = true
        savePending(intent)
      }
      const r = await finalize(intent)
      if (r !== 'reupload') return
      intent.uploaded = false
    }
    setError('uploadFailed')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.website || busy.current || done.current || !canSubmit) return
    busy.current = true
    setError(null)
    setNotice(null)
    // Lock to exactly what is on screen now: this agreement, these
    // choices, this File object.
    setPinnedAgreementId(agreement.id)
    const chosenFile = file
    const chosenType = kind.type
    let awaitingContinue = false
    try {
      const offered = terms.data.offer.decision === 'automatic'
      const body = intentBody({
        offerToken: terms.data.offer.token,
        agreementId: agreement.id,
        accepted,
        publicationSetting: form.setting,
        claimedRole: form.role,
        // Never 'automatic' unless the server offered it.
        processingChoice: offered && form.processing === 'automatic' ? 'automatic' : 'manual',
        fullName: form.fullName,
        email: form.email,
        whatsappE164: whatsapp.state === 'valid' ? whatsapp.e164 : null,
        authors: form.authors,
        file: { name: chosenFile.name, size: chosenFile.size, type: chosenType },
      })
      const key = snapshotKey(body, fileSerial.current)
      let intent = reusableIntent(intentRef.current, key)
      if (!intent) {
        discardIntent()
        setPhase('intent')
        const res = await postJson('/api/submissions/intent', body)
        const out = res.status === 0 ? { kind: 'error', error: 'network' } : classifyIntent(res.status, res.body)
        if (out.kind === 'stale') {
          const ok = await loadTerms(out.why)
          if (!ok) setError('unavailable')
          return
        }
        if (out.kind === 'error') {
          setError(out.error)
          return
        }
        intent = { ...res.body, key, uploaded: false, file: chosenFile, fileType: chosenType }
        intentRef.current = intent
        savePending(intent)
        if (intent.processing?.changedFromOffer) {
          // Narrower than what was shown: explained, and uploaded only on
          // the researcher's say-so.
          setPhase('narrowed')
          awaitingContinue = true
          return
        }
      }
      await uploadAndFinalize(intent)
    } finally {
      busy.current = false
      if (!awaitingContinue && !done.current) unlock()
    }
  }

  // Continues exactly the intent that was accepted; the form has been
  // locked to it since, so nothing on screen can differ from it.
  async function continueNarrowed() {
    if (busy.current || !intentRef.current || phase !== 'narrowed') return
    busy.current = true
    try {
      await uploadAndFinalize(intentRef.current)
    } finally {
      busy.current = false
      if (!done.current) unlock()
    }
  }

  function cancelNarrowed() {
    // The recorded acceptance is left unused and expires; nothing uploads.
    discardIntent()
    unlock()
  }

  async function completeRecovery() {
    if (busy.current || !recovery) return
    busy.current = true
    setError(null)
    try {
      const r = await finalize(recovery)
      if (r === 'reupload') {
        // The file never reached storage and is not in this tab any more.
        endRecovery()
        setError('recoveryIncomplete')
      } else if (r === 'terminal') {
        endRecovery()
      }
      // 'transient' (network, 5xx, rate limit): keep the offer and its
      // retry; 'done' navigates away.
    } finally {
      busy.current = false
      setPhase('idle')
    }
  }

  // ---------------------------------------------------------------- render
  if (terms.status === 'loading') {
    return (
      <div className={styles.form} lang={locale} dir={dir}>
        <p role="status">{a.loading}</p>
      </div>
    )
  }
  if (terms.status !== 'ready') {
    return (
      <div className={styles.form} lang={locale} dir={dir}>
        <h1 className={styles.unavailableHeading}>{a.unavailableHeading}</h1>
        <p>{a.unavailableBody}</p>
        <Button onClick={() => { setTerms({ status: 'loading', data: null }); loadTerms(null) }}>{a.retry}</Button>
      </div>
    )
  }

  const decision = terms.data.offer.decision === 'automatic' ? 'automatic' : 'manual'
  // Which of Google's terms automatic reading runs under, so the
  // explanation matches what is done (an unknown value reads as the more
  // restrictive free-tier description).
  const processingTerms = terms.data.processing?.terms || null
  const workingText = phase === 'intent' ? a.working.intent : phase === 'upload' ? a.working.upload : phase === 'finalize' ? a.working.finalize : phase === 'opening' ? a.working.opening : null
  const noticeText = notice ? a.notices[notice] : languageNotice ? a.notices.language : null

  return (
    <form onSubmit={handleSubmit} className={styles.form} lang={locale} dir={dir} noValidate>
      <input
        type="text"
        value={form.website}
        onChange={(e) => update('website', e.target.value)}
        className={styles.honeypot}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      {recovery && (
        <div className={styles.callout} role="region" aria-labelledby="recovery-heading">
          <h2 id="recovery-heading" className={styles.calloutHeading}>{a.recoveryHeading}</h2>
          <p>{a.recoveryBody}</p>
          <div className={styles.buttonRow}>
            <Button onClick={completeRecovery} disabled={working}>{working ? a.working.finalize : a.recoveryAction}</Button>
            <button type="button" className={styles.secondaryButton} onClick={endRecovery} disabled={working}>
              {a.recoveryDiscard}
            </button>
          </div>
        </div>
      )}

      {noticeText && (
        <p role="status" className={styles.notice} ref={noticeRef} tabIndex={-1}>{noticeText}</p>
      )}

      {/* Every control that makes up the accepted snapshot. Disabled as a
          group while locked, so nothing can drift from the intent. */}
      <fieldset className={styles.lockGroup} disabled={locked} aria-describedby={phase === 'narrowed' ? 'locked-note' : undefined}>
      <fieldset className={styles.section}>
        <legend>{t.aboutYou}</legend>
        <label className={styles.field}>
          {t.fullName}
          <input
            required
            autoComplete="name"
            value={form.fullName}
            onChange={(e) => { update('fullName', e.target.value); touch('fullName') }}
            onBlur={() => touch('fullName')}
            aria-invalid={touched.fullName && !form.fullName.trim() ? true : undefined}
          />
        </label>
        <label className={styles.field}>
          {t.email}
          <input
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(e) => { update('email', e.target.value); touch('email') }}
            onBlur={() => touch('email')}
            aria-invalid={touched.email && !isEmailish(form.email) ? true : undefined}
            aria-describedby={touched.email && form.email.trim() && !isEmailish(form.email) ? 'email-error' : undefined}
          />
        </label>
        {touched.email && form.email.trim() !== '' && !isEmailish(form.email) && (
          <p id="email-error" role="alert" className={styles.fieldError}>{t.emailInvalid}</p>
        )}
        <PhoneField
          label={t.whatsappLabel}
          hint={t.whatsappHint}
          country={form.whatsappCountry}
          onCountryChange={(c) =>
            setForm((f) => ({ ...f, whatsappCountry: c, whatsapp: f.whatsapp.trim() ? formatAsYouType(f.whatsapp, c) : f.whatsapp }))
          }
          value={form.whatsapp}
          onValueChange={(v) => { update('whatsapp', v); touch('whatsapp') }}
          validation={whatsapp}
          errorText={whatsapp.error ? t.phoneError(whatsapp.error) : null}
          showError={Boolean(touched.whatsapp)}
          onBlur={() => touch('whatsapp')}
        />
      </fieldset>

      <fieldset className={styles.section}>
        <legend>{a.roleLegend}</legend>
        {ROLES.map((role) => (
          <label key={role} className={styles.radioOption}>
            <input type="radio" name="role" value={role} checked={form.role === role} onChange={() => update('role', role)} />
            <span>
              <span className={styles.optionLabel}>{a.roles[role].label}</span>
              <span className={styles.optionHint}>{a.roles[role].hint}</span>
            </span>
          </label>
        ))}
        {form.role === 'authorized_depositor' && (
          <div className={styles.authors} role="group" aria-labelledby="authors-legend">
            <p id="authors-legend" className={styles.subLegend}>{a.authorsLegend}</p>
            <p className={styles.hint}>{a.authorsHint}</p>
            {form.authors.map((name, i) => (
              <div key={i} className={styles.authorRow}>
                <input
                  aria-label={a.authorName(i + 1)}
                  value={name}
                  dir="auto"
                  maxLength={200}
                  onChange={(e) => setForm((f) => ({ ...f, authors: f.authors.map((x, j) => (j === i ? e.target.value : x)) }))}
                />
                {form.authors.length > 1 && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    aria-label={a.removeAuthor(i + 1)}
                    onClick={() => setForm((f) => ({ ...f, authors: f.authors.filter((_, j) => j !== i) }))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {form.authors.length < 50 && (
              <button type="button" className={styles.secondaryButton} onClick={() => setForm((f) => ({ ...f, authors: [...f.authors, ''] }))}>
                {a.addAuthor}
              </button>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className={styles.section}>
        <legend>{t.yourResearch}</legend>
        <div className={styles.field} role="group" aria-labelledby={`${fileId}-label`}>
          <label id={`${fileId}-label`} htmlFor={fileId}>
            {t.uploadLabel}{' '}<span className={styles.requiredTag}>{t.required}</span>
          </label>
          <input
            ref={fileInputRef}
            id={fileId}
            type="file"
            accept=".pdf,.docx"
            className={styles.fileInput}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              if (locked) {
                // A disabled input should never fire; if it does, the
                // selection is refused visibly, not silently swapped in.
                e.target.value = ''
                setNotice('locked')
                return
              }
              fileSerial.current += 1
              setFile(e.target.files[0] || null)
            }}
          />
          <div className={styles.filePicker}>
            <button type="button" className={styles.fileButton} onClick={() => fileInputRef.current?.click()} aria-describedby={`${fileId}-name`}>
              {t.chooseFile}
            </button>
            <span id={`${fileId}-name`} className={file ? styles.fileName : styles.fileNameEmpty} dir={file ? 'auto' : undefined}>
              {file ? file.name : t.noFileSelected}
            </span>
          </div>
          {file && !fileOk && (
            <p role="alert" className={styles.fieldError}>
              {!kind ? t.errors.wrongType : t.errors.tooBig((file.size / (1024 * 1024)).toFixed(1))}
            </p>
          )}
        </div>
      </fieldset>

      <fieldset className={styles.section}>
        <legend>{a.settingLegend}</legend>
        <p className={styles.hint}>{a.settingIntro}</p>
        {SETTINGS.map((s) => (
          <label key={s} className={styles.radioOption}>
            <input type="radio" name="setting" value={s} checked={form.setting === s} onChange={() => update('setting', s)} />
            <span>
              <span className={styles.optionLabel}>{a.settings[s].label}</span>
              <span className={styles.optionHint}>{a.settings[s].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.section}>
        <legend>{a.processingLegend}</legend>
        <p className={styles.processing} data-decision={decision} data-terms={processingTerms || undefined}>
          {decision === 'automatic' ? a.processing.automaticBy[processingTerms] || a.processing.automaticBy.gemini_api_unpaid : a.processing.manual}
        </p>
        {decision === 'automatic' &&
          ['automatic', 'manual'].map((choice) => (
            <label key={choice} className={styles.radioOption}>
              <input
                type="radio"
                name="processing"
                value={choice}
                checked={form.processing === choice}
                onChange={() => update('processing', choice)}
              />
              <span>
                <span className={styles.optionLabel}>{a.processingChoices[choice].label}</span>
                <span className={styles.optionHint}>{a.processingChoices[choice].hint}</span>
              </span>
            </label>
          ))}
      </fieldset>

      <fieldset className={styles.section}>
        <legend>{a.termsLegend}</legend>
        <p className={styles.summary}>{a.summary}</p>
        {agreement.language !== locale && (
          <p className={styles.hint}>{pinnedAgreementId ? a.pinnedLanguage : a.otherLanguage}</p>
        )}
        <details className={styles.terms}>
          <summary>
            {a.readTerms} <span className={styles.version}>({a.version(agreement.versionLabel, agreement.versionDate)})</span>
          </summary>
          <section
            data-agreement-language={agreement.language}
            className={styles.termsBody}
            aria-label={a.termsRegion}
            tabIndex={0}
            lang={agreement.language}
            dir={dirFor(agreement.language)}
          >
            <AgreementText text={agreement.text} />
          </section>
        </details>
        <label className={styles.checkboxOption}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => { update('acceptedFor', e.target.checked ? agreement.id : null); if (e.target.checked) setNotice(null) }}
          />
          <span lang={agreement.language} dir={dirFor(agreement.language)}>{agreement.acceptanceSentence}</span>
        </label>
      </fieldset>
      </fieldset>

      {phase === 'narrowed' && (
        <div className={styles.callout} role="alertdialog" aria-labelledby="narrowed-heading" aria-describedby="narrowed-body">
          <h2 id="narrowed-heading" className={styles.calloutHeading}>{a.narrowedHeading}</h2>
          <p id="narrowed-body">{a.narrowedBody}</p>
          <p id="locked-note">{a.lockedNote}</p>
          <div className={styles.buttonRow}>
            <Button onClick={continueNarrowed} autoFocus>{a.narrowedContinue}</Button>
            <button type="button" className={styles.secondaryButton} onClick={cancelNarrowed}>
              {a.narrowedCancel}
            </button>
          </div>
        </div>
      )}

      <div className={styles.submitButtonWrap}>
        <Button type="submit" disabled={!canSubmit} aria-describedby={!canSubmit && outstanding.length ? 'still-needed' : undefined}>
          {workingText || a.submit}
        </Button>
      </div>
      {workingText && <p role="status" className={styles.pendingNote}>{workingText}</p>}
      {!working && outstanding.length > 0 && (
        <p id="still-needed" className={styles.pendingNote}>{t.stillNeeded(outstanding)}</p>
      )}
      {error && <p role="alert" className={styles.errorMessage}>{a.errors[error]}</p>}
    </form>
  )
}
