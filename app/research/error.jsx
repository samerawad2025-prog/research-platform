'use client'
// Fails closed: a failed read shows this message, never partial content.
import { useLocale } from '../../components/LocaleProvider'
import { messagesFor } from '../../lib/i18n'
import s from '../../components/research/research.module.css'

export default function ResearchError({ reset }) {
  const { locale } = useLocale()
  const c = messagesFor(locale).research.catalogue
  return (
    <div className={s.wrap}>
      <p role="alert" className={s.error}>{c.error}</p>
      <button className={s.buttonSecondary} type="button" onClick={() => reset()}>{c.retry}</button>
    </div>
  )
}
