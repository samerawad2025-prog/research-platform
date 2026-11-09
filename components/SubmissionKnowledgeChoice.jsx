'use client'
import {useEffect,useState} from 'react'
import {SUBMISSION_UX} from '../lib/i18nSubmissionUX'
import s from './research/knowledge.module.css'
export default function SubmissionKnowledgeChoice({locale,choice,onChange,disabled}) {
  const t=SUBMISSION_UX[locale]
  const [notice,setNotice]=useState(null),[failed,setFailed]=useState(false)
  useEffect(()=>{
    let live=true
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),8000)
    fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'notice',language:locale}),referrerPolicy:'no-referrer',cache:'no-store',signal:ac.signal})
      .then(async r=>{const d=await r.json();if(live){if(r.ok&&d.text&&d.hash)setNotice({...d,language:locale});else setFailed(true)}})
      .catch(()=>{if(live)setFailed(true)}).finally(()=>clearTimeout(timer))
    return()=>{live=false;clearTimeout(timer);ac.abort()}
  },[locale])
  if(!notice || notice.language!==locale) return failed ? <p className={s.hint}>{t.later}</p> : null
  const checked=choice?.language===locale && choice?.hash===notice.hash
  return <section className={s.panel} aria-labelledby="submission-knowledge-title">
    <h2 id="submission-knowledge-title">{t.optional}</h2>
    <label className={s.check}><input type="checkbox" checked={Boolean(checked)} disabled={disabled}
      onChange={e=>onChange(e.target.checked?{language:locale,hash:notice.hash}:null)}/><span>{t.optionalLabel}</span></label>
    <p className={s.hint}>{t.optionalHint}</p>
    <details><summary>{t.notice}</summary><p className={s.notice}>{notice.text}</p></details>
    <p className={s.hint}>{t.authority}</p>
  </section>
}
