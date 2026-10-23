'use client'
import { useEffect, useState } from 'react'
import { useLocale } from '../LocaleProvider'
import { KNOWLEDGE_MESSAGES } from '../../lib/i18nKnowledge'
import s from './knowledge.module.css'
export default function KnowledgeReader({publicId}) {
  const {locale}=useLocale(),t=KNOWLEDGE_MESSAGES[locale]
  const [available,setAvailable]=useState(false),[article,setArticle]=useState(null),[sourceAnchor,setSourceAnchor]=useState('abstract-en'),[question,setQuestion]=useState(''),[answer,setAnswer]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{
    let live=true;const ac=new AbortController()
    fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'source',publicId,language:locale}),cache:'no-store',signal:ac.signal})
      .then(async r=>{const data=await r.json();if(live){setAvailable(r.ok);setArticle(r.ok?data.article:null);setSourceAnchor((data.sources||[]).find(s=>s.id===(locale==='ar'?'abstract_ar':'abstract'))?.anchor||data.sources?.[0]?.anchor||'abstract-en');setAnswer(null)}}).catch(()=>{if(live)setAvailable(false)})
    return()=>{live=false;ac.abort()}
  },[publicId,locale])
  async function ask(e){
    e.preventDefault();setBusy(true);setError('');setAnswer(null)
    try{
      const r=await fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ask',publicId,language:locale,question}),cache:'no-store'})
      const data=await r.json()
      if(!r.ok){setError(r.status===429?t.rate:t.unavailable);if([404,409].includes(r.status)){setArticle(null);setAvailable(false)}}else setAnswer(data)
    }catch{setError(t.unavailable)}finally{setBusy(false)}
  }
  if(!available&&!error)return null
  return <div>
    {article&&<section className={s.panel} aria-labelledby="explainer-heading">
      <p className={s.label}>{t.article}</p><h2 id="explainer-heading" dir="auto">{locale==='ar'?article.headline_ar:article.headline}</h2>
      <p className={s.hint}>{t.articleLabel}</p>
      <div className={s.prose} dir={locale==='ar'?'rtl':'ltr'}>{(locale==='ar'?article.body_ar:article.body_en).split(/\n\n+/).map((p,i)=><p key={i}>{p}</p>)}</div>
      <a href={'#'+sourceAnchor}>{t.source}</a>
    </section>}
    <section className={s.panel} aria-labelledby="reader-heading">
      <h2 id="reader-heading">{t.reader}</h2><p>{t.scope}</p>
      <p className={s.hint}>{t.privacy} <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">{locale==='ar'?'شروط Google':'Google terms'}</a></p>
      <form onSubmit={ask}>
        <div className={s.field}><label htmlFor="research-question">{t.question}</label><textarea id="research-question" dir="auto" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={600} required minLength={3}/></div>
        <button className={s.button} disabled={busy||question.trim().length<3}>{busy?t.working:t.ask}</button>
      </form>
      {error&&<p role="alert">{error}</p>}
      {answer&&<div aria-live="polite">
        {answer.insufficient?<p>{t.insufficient}</p>:<><p className={s.hint}>{t.caution}</p>{answer.claims.map((c,i)=><div className={s.claim} key={i}>
          <p dir="auto">{c.text}</p><details><summary>{t.evidence}</summary><blockquote dir="auto">{c.quote}</blockquote><a href={c.source==='abstract_ar'?'#abstract-ar':'#abstract-en'}>{t.source}</a></details>
        </div>)}</>}
      </div>}
    </section>
  </div>
}
