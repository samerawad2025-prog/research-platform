'use client'

// Public research submission form — extraction-first.
// Collects only what cannot be extracted from the document:
// who's submitting, the file itself, and consent. Everything
// academic (title, authors, abstract, etc.) is filled in later
// by AI extraction (Step 3) or by an admin — never typed here.

import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
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

const initialForm = {
  full_name: '',
  email: '',
  permission_to_process: false,
  publication_scope: [], // array — select all that apply
  website: '', // honeypot
}

export default function SubmissionForm() {
  const [form, setForm] = useState(initialForm)
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('idle') // idle | submitting | extracting | error
  const [errorMsg, setErrorMsg] = useState('')

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
      setErrorMsg('Please attach your research file (PDF, DOC, or DOCX).')
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

    setStatus('submitting')
    setErrorMsg('')

    // Random, unguessable path — nothing about it reveals order,
    // timing, or lets someone target another submission's file.
    const filePath = `${crypto.randomUUID()}-${file.name.replace(/\s+/g, '_')}`

    try {
      // 1. Upload the file first — the RPC below just needs its path
      const { error: uploadError } = await supabase.storage
        .from('papers')
        .upload(filePath, file)
      if (uploadError) throw uploadError

      // 2. One atomic call creates the researcher, the paper, and
      //    links the submitter as a researcher on it — all or nothing.
      const { data, error: rpcError } = await supabase.rpc('submit_paper', {
        p_full_name: form.full_name,
        p_email: form.email,
        p_file_path: filePath,
        p_permission_to_process: form.permission_to_process,
        p_publication_scope: form.publication_scope,
      })
      if (rpcError) throw rpcError

      const token = data.confirmation_token
      setStatus('extracting')

      // 3. Kick off extraction now that the paper exists. This can take
      //    up to a minute or so for a longer document; the confirmation
      //    page itself handles a still-processing state gracefully if
      //    extraction hasn't finished by the time we get there, so we
      //    don't block navigation on it completing first.
      fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {
        // If this fails to even fire, the paper still exists and stays
        // in "pending" — recoverable later, not a lost submission.
      })

      window.location.href = `/confirm/${token}`
    } catch (err) {
      console.error(err)
      // Don't leave an orphaned file behind if the database step failed
      await supabase.storage.from('papers').remove([filePath]).catch(() => {})
      setErrorMsg('Something went wrong. Please try again, or email us directly.')
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
            onChange={(e) => update('full_name', e.target.value)}
          />
        </label>

        <label className={styles.field}>
          Email / البريد الإلكتروني
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
        </label>
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

      <button type="submit" disabled={status === 'submitting'} className={styles.submitButton}>
        {status === 'submitting' ? 'Submitting…' : 'Submit my research'}
      </button>

      {errorMsg && (
        <p role="alert" className={styles.errorMessage}>
          {errorMsg}
        </p>
      )}
    </form>
  )
}
