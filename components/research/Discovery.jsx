'use client'
import Link from 'next/link'
import { useState } from 'react'
import { COMPARISON_MESSAGES } from '../../lib/i18nComparison'
import c from './comparison.module.css'
import { useLocale } from '../LocaleProvider'
import { DISCOVERY_MESSAGES } from '../../lib/i18nDiscovery'
import s from './research.module.css'
import k from './knowledge.module.css'
export default function Discovery({question,result}){
 const {locale}=useLocale(),t=DISCOVERY_MESSAGES[locale],ct=COMPARISON_MESSAGES[locale]
 const [selected,setSelected]=useState([])
 const visible=selected.filter(id=>result.items.some(r=>r.publicId===id))
 function toggle(id){setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):visible.length<3?[...visible,id]:visible)}
 return <div className={s.wrap}>
  <Link className={s.link} href="/research">{t.browse}</Link>
  <header className={s.catalogueHero}><h1 className={s.h1}>{t.title}</h1><p className={s.lead}>{t.intro}</p></header>
  <form action="/research/discover" method="get" role="search" aria-label={t.title}>
   <label htmlFor="discovery-question">{t.label}</label>
   <div className={s.search}><input id="discovery-question" name="q" type="search" defaultValue={question} placeholder={t.placeholder} maxLength={200} required dir="auto"/><button className={s.button}>{t.search}</button></div>
  </form>
  <p className={k.hint}>{t.scope}</p>
  {!question&&<div><p>{t.examples}</p><ul>{[t.example1,t.example2].map(q=><li key={q}><Link href={'/research/discover?q='+encodeURIComponent(q)}>{q}</Link></li>)}</ul></div>}
  {!!question&&<section aria-live="polite">
   {!!result.terms.length&&<p>{t.terms}: <bdi>{result.terms.join(' · ')}</bdi></p>}
   {result.unavailable?<p role="alert">{t.unavailable}</p>:<>
    {!result.terms.length?<p>{t.needed}</p>:<><p>{t.count(result.items.length)}</p>
     {!result.items.length&&<div className={s.empty}><h2>{t.empty}</h2><p>{t.emptyHelp}</p></div>}
     {result.limited&&<p>{t.limited}</p>}
     {result.items.length>1&&<div className={c.bar}>
      <span role="status">{ct.count(visible.length)}</span>
      {visible.length>=2?<Link className={s.button} href={'/research/compare?ids='+visible.join(',')+'&q='+encodeURIComponent(question)}>{ct.title}</Link>:<span>{ct.chooseResults}</span>}
      {!!visible.length&&<button className={s.buttonSecondary} type="button" onClick={()=>setSelected([])}>{ct.clear}</button>}
     </div>}
     {result.items.map(r=><article key={r.publicId} className={k.panel}>
      {result.items.length>1&&<label className={c.choice}>
       <input type="checkbox" checked={visible.includes(r.publicId)} disabled={visible.length>=3&&!visible.includes(r.publicId)} onChange={()=>toggle(r.publicId)} aria-label={ct.select+': '+(locale==='ar'?r.titleAr||r.title:r.title||r.titleAr)}/>
       <span>{ct.select}</span>
      </label>}
      <h2 dir="auto"><Link href={'/research/'+r.publicId}>{locale==='ar'?r.titleAr||r.title:r.title||r.titleAr}</Link></h2>
      <p>{r.year?<>{r.year} · </>:null}{t.matched}: <bdi>{r.matched.join(' · ')}</bdi></p>
      {r.excerpts.length?r.excerpts.map(p=><div key={p.field}><h3>{t.passage}</h3><blockquote dir="auto" lang={p.field==='abstract_ar'?'ar':'en'}>{p.before?'…':''}{p.text}{p.after?'…':''}</blockquote>
       <Link href={'/research/'+r.publicId+'#'+(p.field==='abstract_ar'?'abstract-ar':'abstract-en')}>{t.open}</Link></div>):<p>{t.titleOnly}</p>}
     </article>)}
    </>}
   </>}
   <Link className={s.link} href={'/research?q='+encodeURIComponent(result.terms.join(' ')||question)}>{t.fallback}</Link>
  </section>}
 </div>
}
