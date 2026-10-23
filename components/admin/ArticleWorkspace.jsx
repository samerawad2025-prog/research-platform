'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { authClient } from '../../lib/admin/adminClient'
import { useAdmin } from './AdminProvider'
import { KNOWLEDGE_MESSAGES } from '../../lib/i18nKnowledge'
import s from '../research/knowledge.module.css'
export default function ArticleWorkspace({paperId}) {
  const {locale,me}=useAdmin(),t=KNOWLEDGE_MESSAGES[locale]
  const [state,setState]=useState(null),[form,setForm]=useState(null),[dirty,setDirty]=useState(false),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const request=useCallback(async body=>{
    const c=authClient(),session=await c?.auth.getSession()
    const token=session?.data?.session?.access_token
    if(!token)throw new Error('unavailable')
    const r=await fetch('/api/knowledge/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...body,paperId}),cache:'no-store'})
    const data=await r.json()
    if(!r.ok)throw new Error(data.reason||'unavailable')
    return data
  },[paperId])
  const load=useCallback(async()=>{
    try{
      const d=await request({action:'load'});setState(d)
      setForm(d.draft?Object.fromEntries(['headline','headline_ar','body_en','body_ar'].map(k=>[k,d.draft[k]||''])):null)
      setDirty(false);setReviewed(false)
    }catch{setMessage(t.unavailable)}
  },[request,t.unavailable])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- remote editor state
  useEffect(()=>{load()},[load])
  async function act(action){
    setBusy(true);setMessage('')
    try{
      await request({action,...(action==='save'?{hash:state.source.hash,content:form}:{}),...(action==='publish'?{versionId:state.draft.id,reviewed}: {})})
      await load();setMessage(['publish','unpublish'].includes(action)?t.published:t.draftSaved)
    }catch(e){setMessage(e.message==='rate_limit'?t.rate:['conflict','source_changed'].includes(e.message)?t.sourceChanged:t.unavailable)}
    finally{setBusy(false)}
  }
  if(me.role!=='administrator')return <p>{t.unavailable}</p>
  return <div className={s.editor}>
    <Link href={'/admin/review/'+paperId}>{t.back}</Link><h1>{t.editor}</h1>
    {message&&<p role="status">{message}</p>}
    {!state&&<button className={s.button} onClick={load}>{t.reload}</button>}
    {state&&!state.source&&<p>{t.missing}</p>}
    {state?.source&&<>
      <p>{t.scope}</p>
      <details className={s.panel}><summary>{t.sourceTitle}</summary>
        {['abstract','abstract_ar'].map(k=>state.source.source[k]&&<p key={k} dir="auto" className={s.prose}>{state.source.source[k]}</p>)}
      </details>
      <button className={s.button} disabled={busy||dirty} onClick={()=>act('generate')}>{busy?t.working:t.generate}</button>
      {form?<div>
        <p className={s.hint}>{t.editHint}</p>
        <p>{t.version}: {state.draft.version_number}</p>
        {['headline','headline_ar','body_en','body_ar'].map((k,i)=><div className={s.field} key={k}>
          <label htmlFor={'article-'+k}>{[t.headline,t.headlineAr,t.body,t.bodyAr][i]}</label>
          {i<2?<input id={'article-'+k} dir={k.endsWith('_ar')?'rtl':'ltr'} value={form[k]} maxLength={250} onChange={ev=>{setForm({...form,[k]:ev.target.value});setDirty(true);setReviewed(false)}}/>:
          <textarea id={'article-'+k} dir={k.endsWith('_ar')?'rtl':'ltr'} value={form[k]} maxLength={12000} onChange={ev=>{setForm({...form,[k]:ev.target.value});setDirty(true);setReviewed(false)}}/>}
        </div>)}
        <button className={s.button} disabled={busy||!dirty} onClick={()=>act('save')}>{t.save}</button>
        <label className={s.check}><input type="checkbox" checked={reviewed} onChange={ev=>setReviewed(ev.target.checked)}/>{t.review}</label>
        <button className={s.button} disabled={busy||dirty||!reviewed||state.draft.source_hash!==state.source.hash} onClick={()=>act('publish')}>{t.publish}</button>
      </div>:<p>{t.empty}</p>}
    </>}
    {state?.published_version_id&&<div className={s.actions}><button className={s.button} disabled={busy} onClick={()=>act('unpublish')}>{t.unpublish}</button></div>}
  </div>
}
