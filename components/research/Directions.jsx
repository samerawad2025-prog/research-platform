'use client'
import Link from 'next/link'
import { useLocale } from '../LocaleProvider'
import { DIRECTIONS_MESSAGES } from '../../lib/i18nDirections'
import s from './research.module.css'
import k from './knowledge.module.css'
export default function Directions({ cards, unavailable }) {
  const { locale } = useLocale(), t = DIRECTIONS_MESSAGES[locale]
  return <div className={s.wrap}>
    <Link className={s.link} href="/research">{t.browse}</Link>
    <header className={s.catalogueHero}><h1 className={s.h1}>{t.title}</h1><p className={s.lead}>{t.intro}</p></header>
    {unavailable && <p role="status">{t.unavailable}</p>}
    {!cards.length && <div className={s.empty}><h2>{t.empty}</h2><p>{t.emptyBody}</p></div>}
    {cards.map(card => <article className={k.panel} key={card.id}>
      <p className={k.label}>{t.qualification}</p>
      <h2>{card[locale].question}</h2>
      <p className={k.hint}>{t.count(card.sourceCount)} · {t.abstractOnly} {t.reviewed}: <time dateTime={card.reviewedAt}>{card.reviewedAt}</time></p>
      {card.sourceCount===1 && <p>{t.narrow}</p>}
      <h3>{t.opportunity}</h3><p>{card[locale].opportunity}</p><p className={k.hint}>{t.inferred}</p>
      <details><summary>{t.evidence}</summary>
        {card.evidence.map((e,i)=><section key={i} className={k.claim}>
          <h4>{e.kind==='method'?t.sourceMethod:t[e.kind]}</h4>
          <blockquote dir="auto">{e.quote}</blockquote>
          <Link href={`/research/${e.publicId}#${e.field==='abstract_ar'?'abstract-ar':'abstract-en'}`}>{t.source}: {locale==='ar'?e.title_ar||e.title:e.title||e.title_ar}</Link>
        </section>)}
      </details>
      <h3>{t.method}</h3><p>{card[locale].method}</p>
      <h3>{t.constraints}</h3><p>{card[locale].constraints}</p>
      <h3>{t.supervisor}</h3><p>{card[locale].supervisor}</p>
      <p className={k.hint}>{t.noNovelty}</p>
    </article>)}
  </div>
}
