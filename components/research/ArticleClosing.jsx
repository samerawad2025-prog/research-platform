import Link from 'next/link'
import { KNOWLEDGE_MESSAGES } from '../../lib/i18nKnowledge'
import s from './knowledge.module.css'

// Platform-owned links and invitation stay separate from sourced research claims.
export default function ArticleClosing({publicId,locale}) {
  if (!/^[a-z0-9]{12}$/.test(publicId || '')) return null
  const t=KNOWLEDGE_MESSAGES[locale]
  return <footer className={s.articleClosing} dir={locale==='ar'?'rtl':'ltr'}>
    <Link className={s.originalLink} href={'/research/'+publicId}>{t.originalResearch}</Link>
    <p>{t.contribute}</p>
    <Link className={s.button} href="/submit">{t.submitResearch}</Link>
  </footer>
}
