'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useLocale} from '../LocaleProvider'
import {SYNTHESIS_MESSAGES} from '../../lib/i18nSynthesis'
import {KNOWLEDGE_MESSAGES} from '../../lib/i18nKnowledge'
import s from './knowledge.module.css'
export default function ComparisonReader({records,question}){
  const {locale}=useLocale()
  const ids=records.map(r=>r.public_id)
  return <Session key={JSON.stringify([ids,question,locale])} records={records} question={question} locale={locale}/>
}
function Session({records,question,locale}){
  const t=SYNTHESIS_MESSAGES[locale],k=KNOWLEDGE_MESSAGES[locale]
  const ids=records.map(r=>r.public_id).join(',')
  const [available,setAvailable]=useState(null),[answer,setAnswer]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [attempt,setAttempt]=useState(0)
  const active=useRef(null)
  useEffect(()=>{
    let live=true;const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),10000)
    fetch('/api/knowledge/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'source',ids:ids.split(','),language:locale}),cache:'no-store',signal:ac.signal})
      .then(async r=>{const data=await r.json();if(live)setAvailable(r.ok&&data.available===true)})
      .catch(()=>{if(live)setAvailable(false)}).finally(()=>clearTimeout(timer))
    return()=>{live=false;clearTimeout(timer);ac.abort();if(active.current){clearTimeout(active.current.timer);active.current.ac.abort();active.current=null}}
  },[ids,locale,attempt])
  function cancel(){
    if(!active.current)return
    const request=active.current;active.current=null;clearTimeout(request.timer);request.ac.abort()
    setBusy(false);setError(k.cancelled)
  }
  async function ask(){
    if(!available||active.current||question.trim().length<3)return
    const request={ac:new AbortController(),timer:null,timedOut:false}
    active.current=request;request.timer=setTimeout(()=>{request.timedOut=true;request.ac.abort()},35000)
    setBusy(true);setError('');setAnswer(null)
    try{
      const r=await fetch('/api/knowledge/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ask',ids:ids.split(','),question,language:locale}),cache:'no-store',signal:request.ac.signal})
      const data=await r.json()
      if(active.current!==request)return
      if(r.ok)setAnswer(data)
      else {setError(r.status===429?k.rate:r.status===409?t.changed:r.status===413?t.large:t.unavailable);if([404,409].includes(r.status))setAvailable(false)}
    }catch{if(active.current===request)setError(request.timedOut?k.timedOut:t.unavailable)}
    finally{clearTimeout(request.timer);if(active.current===request){active.current=null;setBusy(false)}}
  }
  return <section className={s.panel} aria-labelledby="comparison-reader-heading">
    <h2 id="comparison-reader-heading">{t.title}</h2>
    {available===null?<p role="status">{t.checking}</p>:!available?<>
      <p role="status">{error||t.unavailable}</p>
      <button type="button" className={s.secondary} onClick={()=>{
        setAvailable(null);setAnswer(null);setError('');setAttempt(n=>n+1)
      }}>{t.retry}</button>
    </>:<>
      <p>{t.scope}</p>
      <details><summary>{locale==='ar'?'معالجة السؤال والمصادر':'Question and source processing'}</summary><p>{t.privacy} <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">{locale==='ar'?'شروط Google':'Google terms'}</a></p></details>
      {question.trim().length<3?<p>{t.needQuestion}</p>:<><p dir="auto">{question}</p><button className={s.button} type="button" disabled={busy} onClick={ask}>{busy?k.working:t.ask}</button></>}
      {busy&&<button className={s.button} type="button" onClick={cancel}>{k.cancel}</button>}
      {error&&<p role="alert">{error}</p>}
    </>}
    {answer&&<div aria-live="polite">
      {answer.insufficient?<p>{t.insufficient}</p>:<>
        <p className={s.hint}>{t.coverage(answer.covered,answer.count)}</p><p>{t.caution}</p>
        {answer.claims.map((claim,i)=><div className={s.claim} key={i}>
          <h3>{t[claim.kind]}</h3><p dir="auto">{claim.text}</p>
          <details><summary>{t.evidence}</summary>{claim.evidence.map((e,j)=>{
            const record=records.find(r=>r.public_id===e.publicId)
            return <div key={j}><blockquote dir="auto">{e.quote}</blockquote>
              <Link href={'/research/'+e.publicId+'#'+(e.source==='abstract_ar'?'abstract-ar':'abstract-en')} dir="auto">{locale==='ar'?record?.title_ar||record?.title:record?.title||record?.title_ar}</Link>
            </div>
          })}</details>
        </div>)}
      </>}
    </div>}
  </section>
}
