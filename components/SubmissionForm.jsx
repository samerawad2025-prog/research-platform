'use client'

// Public research submission form — extraction-first.
// Collects only what cannot be extracted from the document:
// who's submitting, the file itself, and consent. Everything
// academic (title, authors, abstract, etc.) is filled in later
// by AI extraction (Step 3) or by an admin — never typed here.

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabaseClient'
import PhoneField from './PhoneField'
import { DEFAULT_COUNTRY, validateWhatsApp, formatAsYouType } from '../lib/validation/phone'
import styles from './SubmissionForm.module.css'

const SCOPE_OPTIONS = [
  {
    value: 'full_paper',
    label_en: 'Publish the complete paper',
    label_ar: 'نشر البحث كاملاً',
  },
  {
    value: 'metadata_and_article',
    label_en: 'Publish an accessible article + summary',
    label_ar: 'نشر مقال مبسط وملخص فقط',
  },
  {
    value: 'abstract_and_citation',
    label_en: 'Publish only the abstract and citation',
    label_ar: 'نشر الملخص والاستشهاد فقط',
  },
]

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
function userFacingError(err) {
  if (err?.__stage === 'rpc' && err?.code === 'P0001' && err?.message) {
    return err.message
  }

  if (err?.__stage === 'upload') {
    const raw = String(err?.message || '').toLowerCase()
    if (raw.includes('exceeded') || raw.includes('too large') || raw.includes('maximum size')) {
      return 'That file is too large. The limit is 20 MB, so please upload a smaller version.'
    }
    if (raw.includes('mime') || raw.includes('type')) {
      return 'That file type isn\u2019t supported. Please upload a PDF or DOCX file.'
    }
    // Deliberately does not blame the connection. An upload can also be
    // rejected outright by storage, and telling someone to check their
    // network sends them chasing the wrong thing - which is exactly what
    // happened when an Arabic-named file failed (BUG_HISTORY.md #17).
    return 'We couldn\u2019t upload your file. Please try again in a moment.'
  }

  return 'Something went wrong on our side. Please try again in a moment.'
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
  const [form, setForm] = useState(initialForm)
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('idle') // idle | submitting | extracting | error
  const [errorMsg, setErrorMsg] = useState('')
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
  if (!form.full_name.trim()) outstanding.push('your name')
  if (!isEmailish(form.email)) outstanding.push('a valid email address')
  if (whatsapp.state === 'invalid') outstanding.push('a valid WhatsApp number (or clear the field)')
  if (!fileOk) outstanding.push('a PDF or DOCX file under 20 MB')
  if (!form.permission_to_process) outstanding.push('your permission to process the file')
  if (!form.publication_scope.length) outstanding.push('at least one publishing choice')

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
      setErrorMsg('Please attach your research file (PDF or DOCX).')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
      setErrorMsg(`That file is ${sizeMb} MB. The limit is 20 MB, so please upload a smaller version.`)
      return
    }
    if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setErrorMsg('Please upload a PDF or DOCX file. Older .doc files aren\u2019t supported.')
      return
    }
    if (!form.permission_to_process) {
      setErrorMsg('Please confirm you allow us to process your research.')
      return
    }
    if (!form.publication_scope.length) {
      setErrorMsg('Please choose at least one thing you\u2019re comfortable with us publishing.')
      return
    }
    if (whatsapp.state === 'invalid') {
      // Reachable only if the button was bypassed (an Enter key on a
      // stale render, or scripted input). Kept as a real guard rather
      // than trusting the disabled attribute as a security boundary.
      setTouched((t) => ({ ...t, whatsapp: true }))
      setErrorMsg(whatsapp.error)
      return
    }

    setStatus('submitting')
    setErrorMsg('')

    // Random, unguessable path — nothing about it reveals order,
    // timing, or lets someone target another submission's file.
    const filePath = buildFilePath(file.name)

    try {
      // 1. Upload the file first — the RPC below just needs its path
      const { error: uploadError } = await supabase.storage
        .from('papers')
        .upload(filePath, file)
      if (uploadError) throw { __stage: 'upload', ...uploadError }

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
      setStatus('extracting')

      // 3. Kick off extraction now that the paper exists. The
      //    confirmation page polls for the result and handles a
      //    still-processing state on its own, so we don't block
      //    navigation on it completing first.
      fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {
        // If this fails to even fire, the paper still exists and stays
        // in "pending" — the confirmation page retries, nothing is lost.
      })

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
      <div className={styles.successMessage}>
        <p>
          Thank you for sharing your work. We&rsquo;re reading through it now
          to find your title, abstract, and research team, this usually
          takes under a minute.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
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
        <legend>About you / عنك</legend>

        <label className={styles.field}>
          Full name / الاسم الكامل
          <input
            required
            value={form.full_name}
            onChange={(e) => { update('full_name', e.target.value); touch('full_name') }}
            onBlur={() => touch('full_name')}
            aria-invalid={touched.full_name && !form.full_name.trim() ? true : undefined}
          />
        </label>

        <label className={styles.field}>
          Email / البريد الإلكتروني
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
            That doesn\u2019t look like an email address. Please check it.
          </p>
        )}

        <PhoneField
          label="WhatsApp number (optional) / رقم الواتساب (اختياري)"
          hint="We may use this only to contact you about your research submission if necessary."
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
          showError={Boolean(touched.whatsapp)}
          onBlur={() => touch('whatsapp')}
        />
      </fieldset>

      <fieldset className={styles.section}>
        <legend>Your research / بحثك</legend>

        <label className={styles.field}>
          Upload your research file (PDF or DOCX)
          <input
            type="file"
            accept=".pdf,.docx"
            required
            onChange={(e) => setFile(e.target.files[0])}
          />
        </label>
        <p className={styles.hint}>
          We&rsquo;ll read the title, authors, and other details directly from
          your document — no need to retype them here.
        </p>
      </fieldset>

      <fieldset className={styles.section}>
        <legend>Consent / الموافقة</legend>

        <label className={styles.checkboxOption}>
          <input
            type="checkbox"
            checked={form.permission_to_process}
            onChange={(e) => update('permission_to_process', e.target.checked)}
          />
          <span>
            I agree to let this platform, including an external AI service,
            process my research to extract details like the title, authors,
            and abstract. / أوافق على معالجة بحثي من قبل المنصة، بما في ذلك
            إرساله إلى خدمة ذكاء اصطناعي خارجية للمساعدة في استخراج تفاصيل
            مثل العنوان والباحثين والملخص.
          </span>
        </label>

        <p className={styles.subLegend}>
          What are you comfortable with us publishing? Select all that apply. /
          ما الذي توافق على نشره؟ اختر كل ما ينطبق
        </p>
        {SCOPE_OPTIONS.map((opt) => (
          <label key={opt.value} className={styles.checkboxOption}>
            <input
              type="checkbox"
              checked={form.publication_scope.includes(opt.value)}
              onChange={() => toggleScope(opt.value)}
            />
            <span>
              {opt.label_en} / {opt.label_ar}
            </span>
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={!canSubmit} className={styles.submitButton}>
        {status === 'submitting' ? 'Submitting…' : 'Submit my research'}
      </button>

      {!canSubmit && status !== 'submitting' && outstanding.length > 0 && (
        <p className={styles.pendingNote}>
          Still needed: {outstanding.join(', ')}.
        </p>
      )}

      {errorMsg && (
        <p role="alert" className={styles.errorMessage}>
          {errorMsg}
        </p>
      )}
    </form>
  )
}
