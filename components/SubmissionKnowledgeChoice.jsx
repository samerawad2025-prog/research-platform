'use client'
import {useEffect,useState} from 'react'
import {SUBMISSION_UX} from '../lib/i18nSubmissionUX'
import s from './research/knowledge.module.css'
export default function SubmissionKnowledgeChoice({locale,choice,onChange,disabled,compact=false,termsSummary,termsContent,requiredConsent}) {
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
  const ready=Boolean(notice && notice.language===locale)
  const checked=ready && choice?.language===locale && choice?.hash===notice.hash
  const permission=ready?<><p className={s.notice}>{notice.text}</p><p>{t.authority}</p></>:<p role="status">{failed?t.later:t.loading}</p>
  const option=ready?<section className={compact?s.consentChoice:s.panel} aria-label={t.optional}>
    {!compact && <h2 id="submission-knowledge-title">{t.optional}</h2>}
    <label className={s.check}><input type="checkbox" checked={Boolean(checked)} disabled={disabled}
      onChange={e=>onChange(e.target.checked?{language:locale,hash:notice.hash}:null)}/><span>{t.optionalLabel}</span></label>
    <p className={s.hint}>{t.optionalHint}</p>
    {!termsContent && <details><summary>{t.notice}</summary>{permission}</details>}
  </section>:<p className={s.hint} role="status">{failed?t.later:t.loading}</p>
  if(termsContent) return <>
    <details className={s.panel}>
      <summary>{termsSummary}</summary>
      {termsContent}
      <h3>{t.optional}</h3>
      {permission}
    </details>
    {requiredConsent}
    {option}
  </>
  return option
}
