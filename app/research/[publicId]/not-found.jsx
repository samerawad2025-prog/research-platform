'use client'
import Link from 'next/link'
import { useLocale } from '../../../components/LocaleProvider'
import { messagesFor } from '../../../lib/i18n'
import s from '../../../components/research/research.module.css'

export default function Unavailable() {
  const { locale } = useLocale()
  const t = messagesFor(locale).research.record
  return (
    <div className={`${s.wrap} ${s.narrow}`}>
      <h1 className={s.h1}>{t.unavailableTitle}</h1>
      <p>{t.unavailableBody}</p>
      <p><Link className={s.link} href="/research">{t.back}</Link></p>
    </div>
  )
}
