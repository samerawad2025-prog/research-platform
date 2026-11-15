'use client'
import Link from 'next/link'
import { useLocale } from '../LocaleProvider'
import { DIRECTIONS_MESSAGES } from '../../lib/i18nDirections'
import s from './knowledge.module.css'

export default function RelatedDirections({ cards }) {
  const { locale } = useLocale(), t = DIRECTIONS_MESSAGES[locale]
  if (!cards?.length) return null
  return <section className={s.panel} aria-labelledby="build-on-heading">
    <h2 id="build-on-heading">{t.buildOn}</h2>
    <p>{t.nextStep}</p>
    {cards.map(c => <div className={s.claim} key={c.id}>
      <h3 dir="auto">{locale === 'ar' ? c.questionAr : c.question}</h3>
      <p className={s.hint}>{t.count(c.sourceCount)} · {t.abstractOnly}</p>
      <Link href={'/research/directions#' + c.id}>{t.exploreCard}</Link>
    </div>)}
  </section>
}
