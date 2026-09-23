'use client'

// Public research submission form — extraction-first.
// Collects only what cannot be extracted from the document:
// who's submitting, the file itself, and consent. Everything
// academic (title, authors, abstract, etc.) is filled in later
// by AI extraction (Step 3) or by an admin — never typed here.

import { useState, useMemo, useRef, useId } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabaseClient'
import PhoneField from './PhoneField'
import { DEFAULT_COUNTRY, validateWhatsApp, formatAsYouType } from '../lib/validation/phone'
import { mark, adoptPendingMarks } from '../lib/timing'
import Button from './ui/Button'
import { useLocale } from './LocaleProvider'
import { dirFor, messagesFor } from '../lib/i18n'
import styles from './SubmissionForm.module.css'

// Stored values sent to submit_paper. Their visible labels live in
// lib/i18n.jsx under submission.scope, keyed by these exact values.
const SCOPE_OPTIONS = ['full_paper', 'metadata_and_article', 'abstract_and_citation']

const MAX_FILE_BYTES = 20 * 1024 * 1024 // matches the storage bucket's own limit
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx']

// A Supabase Storage object key only accepts a conservative ASCII
// subset. Building one straight from the uploaded filename fails
// outright when that name is in Arabic script - the common case for
// this platform's own users, and a failure that leaves no trace at all
// (no storage object, no paper row, nothing to query afterwards).
//
// Only the extension is load-bearing: app/api/extract/route.js picks
// the parser from it. The readable part is cosmetic, kept purely so a
// human scanning the bucket can recognise a file, so anything not
// safely representable is dropped rather than transliterated.
function buildFilePath(fileName) {
  const dot = fileName.lastIndexOf('.')
  const ext = dot > -1 ? fileName.slice(dot).toLowerCase() : ''
  const label = (dot > -1 ? fileName.slice(0, dot) : fileName)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 80)

  return label
    ? `${crypto.randomUUID()}-${label}${ext}`
    : `${crypto.randomUUID()}${ext}`
}

// Turns a thrown error into something the person can actually act on.
//
// The key rule: a Postgres error with SQLSTATE P0001 is one of OUR
// deliberate `raise exception` messages in submit_paper, written as
// user-facing text. Anything else (constraint violations, connection
// failures, internal errors) carries a different code and must never
// be shown raw, since it would leak technical detail and help nobody.
//
// Returns which message applies rather than its wording, so the text is
// chosen at render time in the current interface language — an error
// already on screen follows a language switch.
function userFacingError(err) {
  if (err?.__stage === 'rpc' && err?.code === 'P0001' && err?.message) {
    return { key: 'rpc', message: err.message }
  }

  if (err?.__stage === 'upload') {
    const raw = String(err?.message || '').toLowerCase()
    if (raw.includes('exceeded') || raw.includes('too large') || raw.includes('maximum size')) {
      return { key: 'uploadTooLarge' }
    }
    if (raw.includes('mime') || raw.includes('type')) {
      return { key: 'uploadType' }
    }
    // Deliberately does not blame the connection. An upload can also be
    // rejected outright by storage, and telling someone to check their
    // network sends them chasing the wrong thing - which is exactly what
    // happened when an Arabic-named file failed (BUG_HISTORY.md #17).
    return { key: 'uploadGeneric' }
  }

  return { key: 'internal' }
}

function errorText(error, t) {
  if (!error) return ''
  if (error.key === 'rpc') return t.rpcError(error.message)
  if (error.key === 'phone') return t.phoneError(error.message)
  if (error.key === 'tooBig') return t.errors.tooBig(error.sizeMb)
  return t.errors[error.key]
}

const initialForm = {
  full_name: '',
  email: '',
  whatsapp_number: '', // as typed, in national format
  whatsapp_country: DEFAULT_COUNTRY,
  permission_to_process: false,
  publication_scope: [], // array — select all that apply
  website: '', // honeypot
}

// Email is checked here as well as by the browser's own type="email"
// so the submit button's enabled state and the browser agree. It is
// deliberately permissive - the only authority on whether an address
// works is whether mail to it arrives, and a strict pattern rejects
// real addresses.
function isEmailish(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export default function SubmissionForm() {
  const router = useRouter()
  const { locale } = useLocale()
  const t = messagesFor(locale).submission
  const dir = dirFor(locale)
  const [form, setForm] = useState(initialForm)
  const [file, setFile] = useState(null)
  const fileInputRef = useRef(null)
  const fileId = useId()
  const [status, setStatus] = useState('idle') // idle | submitting | extracting | error
  const [errorMsg, setErrorMsg] = useState(null) // { key, ... } — see errorText()
  // Which fields the person has already interacted with. An error is
  // only SHOWN once a field has been touched, so the form doesn't open
  // covered in red before anyone has typed anything - but validity
  // itself is computed from the first keystroke, which is what keeps
  // the submit button honest.
  const [touched, setTouched] = useState({})

  const whatsapp = useMemo(
    () => validateWhatsApp(form.whatsapp_number, form.whatsapp_country),
    [form.whatsapp_number, form.whatsapp_country]
  )

  // Every condition the submit button depends on, in one place, so the
  // button's disabled state and the checks inside handleSubmit can
  // never disagree about what "ready" means.
  const fileOk =
    Boolean(file) &&
    file.size <= MAX_FILE_BYTES &&
    ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))

  const canSubmit =
    form.full_name.trim().length > 0 &&
    isEmailish(form.email) &&
    whatsapp.state !== 'invalid' && // 'empty' is fine - the field is optional
    fileOk &&
    form.permission_to_process &&
    form.publication_scope.length > 0 &&
    status !== 'submitting'

  // What is still outstanding, in the order the form presents it.
  // Shown under the submit button so a disabled button is never a dead
  // end the person has to guess their way out of.
  const outstanding = []
  if (!form.full_name.trim()) outstanding.push(t.outstanding.name)
  if (!isEmailish(form.email)) outstanding.push(t.outstanding.email)
  if (whatsapp.state === 'invalid') outstanding.push(t.outstanding.whatsapp)
  if (!fileOk) outstanding.push(t.outstanding.file)
  if (!form.permission_to_process) outstanding.push(t.outstanding.permission)
  if (!form.publication_scope.length) outstanding.push(t.outstanding.scope)

  function touch(field) {
    setTouched((t) => ({ ...t, [field]: true }))
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function toggleScope(value) {
    setForm((f) => {
      const has = f.publication_scope.includes(value)
      return {
        ...f,
        publication_scope: has
          ? f.publication_scope.filter((v) => v !== value)
          : [...f.publication_scope, value],
      }
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (form.website) return // honeypot — bots fill every field

    if (!file) {
      setErrorMsg({ key: 'noFile' })
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
      setErrorMsg({ key: 'tooBig', sizeMb })
      return
    }
    if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setErrorMsg({ key: 'wrongType' })
      return
    }
    if (!form.permission_to_process) {
      setErrorMsg({ key: 'noPermission' })
      return
    }
    if (!form.publication_scope.length) {
      setErrorMsg({ key: 'noScope' })
      return
    }
    if (whatsapp.state === 'invalid') {
      // Reachable only if the button was bypassed (an Enter key on a
      // stale render, or scripted input). Kept as a real guard rather
      // than trusting the disabled attribute as a security boundary.
      setTouched((t) => ({ ...t, whatsapp: true }))
      setErrorMsg({ key: 'phone', message: whatsapp.error })
      return
    }

    setStatus('submitting')
    setErrorMsg(null)

    // Stage 1 begins here, at the click, not at the first server
    // timestamp. Everything before papers.created_at used to be
    // invisible, which is most of what a person on a slow connection
    // actually waits through.
    mark(null, 'submit_clicked')

    // Random, unguessable path — nothing about it reveals order,
    // timing, or lets someone target another submission's file.
    const filePath = buildFilePath(file.name)

    try {
      // 1. Upload the file first — the RPC below just needs its path
      const { error: uploadError } = await supabase.storage
        .from('papers')
        .upload(filePath, file)
      // message is copied by name because a spread drops it: Storage
      // returns a real Error subclass, whose message is non-enumerable,
      // so userFacingError() used to see no message at all and every
      // upload failure fell through to the generic wording.
      if (uploadError) throw { __stage: 'upload', ...uploadError, message: uploadError.message }
      // File size is recorded with the mark: upload duration is
      // meaningless without knowing how many bytes went up.
      mark(null, 'upload_complete', { file_bytes: file.size })

      // 2. One atomic call creates the researcher, the paper, and
      //    links the submitter as a researcher on it — all or nothing.
      const { data, error: rpcError } = await supabase.rpc('submit_paper', {
        p_full_name: form.full_name,
        p_email: form.email,
        p_file_path: filePath,
        p_permission_to_process: form.permission_to_process,
        p_publication_scope: form.publication_scope,
        // Stored in E.164, never as typed. See lib/validation/phone.js
        // on why this stays compatible with the existing SQL check.
        p_whatsapp_number: whatsapp.e164,
      })
      if (rpcError) throw { __stage: 'rpc', ...rpcError }

      const token = data.confirmation_token
      // The marks so far were held in memory because there was no
      // token to key them by yet; hand them over now.
      adoptPendingMarks(token)
      mark(token, 'paper_created')
      setStatus('extracting')

      // 3. Kick off extraction now that the paper exists. The
      //    confirmation page polls for the result and handles a
      //    still-processing state on its own, so we don't block
      //    navigation on it completing first.
      // keepalive is load-bearing, not a nicety. This fetch is
      // deliberately not awaited and is immediately followed by a
      // navigation; without keepalive the browser is entitled to
      // cancel it as the page unloads, and extraction would not start
      // until the confirmation page's own safety net fired seconds
      // later. That delay was invisible because nothing measured it.
      fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        keepalive: true,
      }).catch(() => {
        // If this fails to even fire, the paper still exists and stays
        // in "pending" — the confirmation page retries, nothing is lost.
      })
      mark(token, 'extract_triggered', { by: 'form' })

      router.push(`/confirm/${token}`)
    } catch (err) {
      console.error(err)
      // Don't leave an orphaned file behind if a later step failed
      await supabase.storage.from('papers').remove([filePath]).catch(() => {})
      setErrorMsg(userFacingError(err))
      setStatus('error')
    }
  }

  if (status === 'extracting') {
    return (
      <div className={styles.successMessage} lang={locale} dir={dir}>
        <p>{t.extracting}</p>
      </div>
    )
  }

  return (
    // lang/dir opt this form out of SiteShell's temporary English/LTR
    // boundary: the whole flow follows the interface language now.
    <form onSubmit={handleSubmit} className={styles.form} lang={locale} dir={dir}>
      <input
        type="text"
        value={form.website}
        onChange={(e) => update('website', e.target.value)}
        className={styles.honeypot}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <fieldset className={styles.section}>
        <legend>{t.aboutYou}</legend>

        <label className={styles.field}>
          {t.fullName}
          <input
            required
            value={form.full_name}
            onChange={(e) => { update('full_name', e.target.value); touch('full_name') }}
            onBlur={() => touch('full_name')}
            aria-invalid={touched.full_name && !form.full_name.trim() ? true : undefined}
          />
        </label>

        <label className={styles.field}>
          {t.email}
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => { update('email', e.target.value); touch('email') }}
            onBlur={() => touch('email')}
            aria-invalid={touched.email && !isEmailish(form.email) ? true : undefined}
            aria-describedby={touched.email && !isEmailish(form.email) ? 'email-error' : undefined}
          />
        </label>
        {touched.email && form.email.trim() !== '' && !isEmailish(form.email) && (
          <p id="email-error" role="alert" className={styles.fieldError}>
            {t.emailInvalid}
          </p>
        )}

        <PhoneField
          label={t.whatsappLabel}
          hint={t.whatsappHint}
          country={form.whatsapp_country}
          onCountryChange={(c) => {
            // Reformat what is already typed for the newly chosen
            // country, so the displayed number and the country it is
            // being validated against never disagree.
            setForm((f) => ({
              ...f,
              whatsapp_country: c,
              whatsapp_number: f.whatsapp_number.trim()
                ? formatAsYouType(f.whatsapp_number, c)
                : f.whatsapp_number,
            }))
          }}
          value={form.whatsapp_number}
          onValueChange={(v) => {
            update('whatsapp_number', v)
            touch('whatsapp') // live from the first keystroke, not only on blur
          }}
          validation={whatsapp}
          errorText={whatsapp.error ? t.phoneError(whatsapp.error) : null}
          showError={Boolean(touched.whatsapp)}
          onBlur={() => touch('whatsapp')}
        />
      </fieldset>

      <fieldset className={styles.section}>
        <legend>{t.yourResearch}</legend>

        {/* The native input stays the only source of the File, but its
            browser-owned "Choose File / No file chosen" text cannot be
            translated, so it is visually hidden (not display:none, which
            would stop it opening) and driven by a real button whose
            wording follows the interface language. The input is removed
            from the tab order and the accessibility tree so there is
            exactly one control to reach; the label still opens it on
            click. */}
        <div className={styles.field} role="group" aria-labelledby={`${fileId}-label`}>
          {/* The native input's `required` is hidden from assistive
              technology along with the input itself, so the field says
              so in visible text instead. It sits inside the label, which
              names the group, so it is announced with the field too. The
              no-break space is deliberate: Chrome drops an ordinary space
              before an inline element when computing the name, which ran
              it together as "(PDF or DOCX)Required". */}
          <label id={`${fileId}-label`} htmlFor={fileId}>
            {t.uploadLabel}{'\u00a0'}<span className={styles.requiredTag}>{t.required}</span>
          </label>
          <input
            ref={fileInputRef}
            id={fileId}
            type="file"
            accept=".pdf,.docx"
            required
            className={styles.fileInput}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => setFile(e.target.files[0])}
          />
          <div className={styles.filePicker}>
            <button
              type="button"
              className={styles.fileButton}
              onClick={() => fileInputRef.current?.click()}
              aria-describedby={`${fileId}-name`}
            >
              {t.chooseFile}
            </button>
            {/* The filename is the person's own text in whatever script
                they named it, so its direction comes from its content. */}
            <span
              id={`${fileId}-name`}
              className={file ? styles.fileName : styles.fileNameEmpty}
              dir={file ? 'auto' : undefined}
            >
              {file ? file.name : t.noFileSelected}
            </span>
          </div>
        </div>
        <p className={styles.hint}>{t.uploadHint}</p>
      </fieldset>

      <fieldset className={styles.section}>
        <legend>{t.consent}</legend>

        <label className={styles.checkboxOption}>
          <input
            type="checkbox"
            checked={form.permission_to_process}
            onChange={(e) => update('permission_to_process', e.target.checked)}
          />
          <span>{t.consentText}</span>
        </label>

        <p className={styles.subLegend}>{t.scopeQuestion}</p>
        {SCOPE_OPTIONS.map((value) => (
          <label key={value} className={styles.checkboxOption}>
            <input
              type="checkbox"
              checked={form.publication_scope.includes(value)}
              onChange={() => toggleScope(value)}
            />
            <span>{t.scope[value]}</span>
          </label>
        ))}
      </fieldset>

      <div className={styles.submitButtonWrap}>
        <Button type="submit" disabled={!canSubmit}>
          {status === 'submitting' ? t.submitting : t.submit}
        </Button>
      </div>

      {!canSubmit && status !== 'submitting' && outstanding.length > 0 && (
        <p className={styles.pendingNote}>
          {t.stillNeeded(outstanding)}
        </p>
      )}

      {errorMsg && (
        <p role="alert" className={styles.errorMessage}>
          {errorText(errorMsg, t)}
        </p>
      )}
    </form>
  )
}
