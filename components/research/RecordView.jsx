'use client'

// One public research page. Receives only the allowlisted public fields
// (public_record() in migration 0016); the wording follows the reader's
// language, the research text is shown exactly as confirmed.

import Link from 'next/link'
import { useLocale } from '../LocaleProvider'
import { CONTACT_EMAIL, messagesFor } from '../../lib/i18n'
import { titles, named, fileSize } from './format'
import s from './research.module.css'

export default function RecordView({ record: r }) {
  const { locale } = useLocale()
  const t = messagesFor(locale).research
  const rt = t.record
  const { main, other } = titles(r, locale)
  // Abstracts in the reader's language first; each only if it exists.
  const abstracts = [
    r.abstract && { text: r.abstract, lang: 'en', label: rt.abstractEn },
    r.abstract_ar && r.abstract_ar !== r.abstract && { text: r.abstract_ar, lang: 'ar', label: rt.abstractAr },
  ].filter(Boolean).sort((a, b) => (a.lang === locale ? -1 : b.lang === locale ? 1 : 0))
  const details = [
    [rt.institution, named(r.institution, locale)],
    [rt.unit, named(r.unit, locale)],
    [rt.year, r.year],
    [rt.degree, r.degree_type],
    [rt.type, r.document_type && t.catalogue.types[r.document_type]],
    [rt.supervisor, r.supervisor_name],
  ].filter(([, v]) => v)
  const ft = r.fulltext

  return (
    <div className={s.wrap}>
      <article className={s.article}>
        <p className={s.eyebrow}><Link className={s.link} href="/research">{rt.back}</Link></p>
        <h1 className={s.h1} lang={main?.lang} dir="auto">{main?.text}</h1>
        {other && <p className={s.altTitle} lang={other.lang} dir="auto"><span className={s.srOnly}>{rt.titleOther}: </span>{other.text}</p>}

        {r.authors.length > 0 && (
          <>
            <h2 className={s.h2} style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-base)' }}>{rt.authors}</h2>
            <ol className={s.authors}>
              {r.authors.map((a, i) => (
                <li key={i} className={s.author}>
                  <span dir="auto">{a.name}</span>
                  {a.linkedin_url && <a className={s.linkedin} href={a.linkedin_url} target="_blank" rel="noopener noreferrer nofollow" aria-label={rt.linkedin(a.name)}>{rt.linkedinShort}</a>}
                </li>
              ))}
            </ol>
          </>
        )}

        {ft ? (
          <div className={s.actions}>
            {ft.format === 'pdf' && <a className={s.button} href={`/research/${r.public_id}/file?mode=read`} target="_blank" rel="noopener">{rt.readOnline}</a>}
            <a className={ft.format === 'pdf' ? s.buttonSecondary : s.button} href={`/research/${r.public_id}/file?mode=download`}>{rt.download(ft.format, fileSize(ft.size, rt))}</a>
            {ft.format !== 'pdf' && <p className={s.muted} style={{ flexBasis: '100%', margin: 0 }}>{rt.downloadOnly}</p>}
          </div>
        ) : (
          <p className={s.muted}>{rt.noFullText}</p>
        )}

        {abstracts.map((a) => (
          <section key={a.lang}>
            <h2 className={s.h2}>{abstracts.length > 1 ? a.label : rt.abstract}</h2>
            <p className={s.abstract} lang={a.lang} dir={a.lang === 'ar' ? 'rtl' : 'ltr'}>{a.text}</p>
          </section>
        ))}

        {details.length > 0 && (
          <section>
            <h2 className={s.h2}>{rt.details}</h2>
            <dl className={s.dl}>
              {details.map(([k, v]) => (<div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd><bdi>{v}</bdi></dd></div>))}
            </dl>
          </section>
        )}

        <section>
          <h2 className={s.h2}>{rt.rightsTitle}</h2>
          <div className={s.rights}>
            <p>{r.setting !== 'record_abstract_fulltext' ? rt.rightsRecord : ft ? rt.rightsFull : rt.rightsHeld}</p>
            <p>{rt.rightsCommon}</p>
            <p>{rt.notEndorsed}</p>
            <p>{rt.concern} <a className={s.link} href={`mailto:${CONTACT_EMAIL}`} dir="ltr">{CONTACT_EMAIL}</a>.</p>
          </div>
        </section>
      </article>
    </div>
  )
}
