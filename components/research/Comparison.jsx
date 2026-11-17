'use client'
import Link from 'next/link'
import ResearchPlan from './ResearchPlan'
import ComparisonReader from './ComparisonReader'
import {useLocale} from '../LocaleProvider'
import {COMPARISON_MESSAGES} from '../../lib/i18nComparison'
import s from './research.module.css'
import c from './comparison.module.css'
export default function Comparison({records,state,question='',terms=[]}) {
 const {locale}=useLocale(),t=COMPARISON_MESSAGES[locale]
 const name=x=>x?.[locale==='ar'?'name_ar':'name_en']||x?.name_en||x?.name_ar||t.absent
 const title=p=>locale==='ar'?p.title_ar||p.title:p.title||p.title_ar
 const rows=[['year',p=>p.year],['institution',p=>name(p.institution)],['unit',p=>name(p.unit)],['type',p=>t[p.document_type]||p.document_type],['degree',p=>p.degree_type]]
 return <div className={s.wrap}>
  <Link href="/research">{t.browse}</Link>
  <header className={s.catalogueHero}><h1 className={s.h1}>{t.title}</h1><p className={s.lead}>{t.intro}</p></header>
  {state!=='ready'?<p role="status" className={s.empty}>{t[state]}</p>:<>
   <p>{t.scope}</p>
   <p><a className={s.button} href={'/api/public/reading-brief?'+new URLSearchParams({ids:records.map(p=>p.public_id).join(','),q:question,lang:locale}).toString()} download>{t.downloadBrief}</a></p>
   <form action="/research/compare" method="get" role="search" aria-label={t.question}>
    <input type="hidden" name="ids" value={records.map(p=>p.public_id).join(',')}/>
    <label htmlFor="comparison-question">{t.question}</label>
    <div className={s.search}><input id="comparison-question" type="search" name="q" defaultValue={question} maxLength={200} dir="auto"/><button className={s.button} type="submit">{t.apply}</button></div>
   </form>
   {question&&<p><Link href={'/research/discover?q='+encodeURIComponent(question)}>{t.backToQuestion}</Link></p>}
   {!!terms.length&&<p>{t.matchingScope}</p>}
   <div className={c.scroll} role="region" aria-label={t.scroll} tabIndex={0}>
    <table className={c.table}><caption className={s.srOnly}>{t.title}</caption>
     <thead><tr><th scope="col">{t.titleRow}</th>{records.map(p=><th scope="col" key={p.public_id}><Link href={`/research/${p.public_id}`} dir="auto">{title(p)||t.absent}</Link></th>)}</tr></thead>
     <tbody>
      {!!terms.length&&<tr><th scope="row">{t.passages}</th>{records.map(p=><td key={p.public_id}>
       {p.excerpts.length?p.excerpts.map(e=><div key={e.field}>
        <blockquote dir="auto" lang={e.field==='abstract_ar'?'ar':'en'}>{e.before?'…':''}{e.text}{e.after?'…':''}</blockquote>
        <Link href={'/research/'+p.public_id+'#'+(e.field==='abstract_ar'?'abstract-ar':'abstract-en')}>{t.source}</Link>
       </div>):<p>{t.noPassage}</p>}
      </td>)}</tr>}
      {rows.map(([key,value])=><tr key={key}><th scope="row">{t[key]}</th>{records.map(p=><td dir="auto" key={p.public_id}>{value(p)||t.absent}</td>)}</tr>)}
      <tr><th scope="row">{t.abstract}</th>{records.map(p=><td key={p.public_id}>
       {p.abstract||p.abstract_ar?<><p dir="auto">{locale==='ar'?p.abstract_ar||p.abstract:p.abstract||p.abstract_ar}</p><Link href={`/research/${p.public_id}#${locale==='ar'&&p.abstract_ar?'abstract-ar':p.abstract?'abstract-en':'abstract-ar'}`}>{t.source}</Link></>:t.absent}
      </td>)}</tr>
     </tbody>
    </table>
   </div>
   <ComparisonReader records={records} question={question}/>
   <ResearchPlan records={records} question={question}/>
   <section className={c.questions}><h2>{t.questions}</h2><ul>{t.prompts.map(p=><li key={p}>{p}</li>)}</ul><p>{t.narrow}</p></section>
  </>}
 </div>
}
