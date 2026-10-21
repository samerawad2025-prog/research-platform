'use client'
import { useEffect, useState } from 'react'
import { useLocale } from './LocaleProvider'
import { KNOWLEDGE_MESSAGES } from '../lib/i18nKnowledge'
import s from './research/knowledge.module.css'
export default function KnowledgePermission({token}) {
  const {locale}=useLocale(),t=KNOWLEDGE_MESSAGES[locale]
  const [state,setState]=useState(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  useEffect(()=>{
    let live=true
    const ac=new AbortController()
    fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'permission',token,language:locale}),referrerPolicy:'no-referrer',cache:'no-store',signal:ac.signal})
      .then(async r=>{const data=await r.json();if(live){setState(r.ok?data:null);setChecked(false)}}).catch(()=>{})
    return()=>{live=false;ac.abort()}
  },[token,locale])
  async function save(granted){
    if(granted&&!checked)return
    setBusy(true);setMessage('')
    try{
      const res=await fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'permission',token,language:locale,granted,hash:state.hash}),referrerPolicy:'no-referrer',cache:'no-store'})
      const data=await res.json()
      if(res.ok){setState(data);setChecked(false);setMessage(t.saved)}else setMessage(t.unavailable)
    }catch{setMessage(t.unavailable)}finally{setBusy(false)}
  }
  if(!state)return null
  return <section className={s.panel} aria-labelledby="knowledge-permission-heading">
    <h2 id="knowledge-permission-heading">{t.permission}</h2><p>{t.permissionIntro}</p>
    <details><summary>{t.terms}</summary><p className={s.notice}>{state.text}</p></details>
    <p>{state.granted?t.active:t.inactive}</p>
    {!state.granted&&<label className={s.check}><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>{t.agree}</label>}
    <button className={s.button} disabled={busy||(!state.granted&&!checked)} onClick={()=>save(!state.granted)}>{busy?t.working:state.granted?t.revoke:t.enable}</button>
    {message&&<p role="status">{message}</p>}
  </section>
}
