'use client'
import {useEffect,useRef,useState} from 'react'
import {useLocale} from '../LocaleProvider'
import {RESEARCH_PLAN_MESSAGES} from '../../lib/i18nResearchPlan'
import {NOTE_LIMIT,planDocument} from '../../lib/public/researchPlan'
import s from './knowledge.module.css'
export default function ResearchPlan({records,question}){
 const {locale}=useLocale()
 return <Session key={JSON.stringify([records.map(r=>r.public_id),question])} ids={records.map(r=>r.public_id)} question={question} locale={locale}/>
}
function Session({ids,question,locale}){
 const t=RESEARCH_PLAN_MESSAGES[locale]
 const [notes,setNotes]=useState({question:'',approach:'undecided',foundation:'',feasibility:''})
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('')
 const request=useRef(null)
 useEffect(()=>()=>{request.current?.abort();request.current=null},[])
 const dirty=Boolean(notes.question||notes.foundation||notes.feasibility||notes.approach!=='undecided')
 useEffect(()=>{
  if(!dirty)return
  const warn=e=>{e.preventDefault();e.returnValue=''}
  window.addEventListener('beforeunload',warn)
  return()=>window.removeEventListener('beforeunload',warn)
 },[dirty])
 function update(key,value){setNotes(n=>({...n,[key]:value}));setStatus('')}
 async function download(){
  if(request.current)return
  const ac=new AbortController();request.current=ac
  const timer=setTimeout(()=>ac.abort(),20000)
  setBusy(true);setStatus('')
  try{
   // Only public IDs and the existing comparison question leave the browser.
   // Plan notes never enter the request, URL, analytics or browser storage.
   const params=new URLSearchParams({ids:ids.join(','),q:question,lang:locale})
   const response=await fetch('/api/public/reading-brief?'+params,{cache:'no-store',referrerPolicy:'no-referrer',signal:ac.signal})
   if(!response.ok||!response.headers.get('content-type')?.startsWith('text/plain'))throw Error('unavailable')
   const brief=await response.text()
   if(request.current!==ac||ac.signal.aborted)return
   const body=planDocument({brief,notes,locale})
   const url=URL.createObjectURL(new Blob(['\uFEFF',body],{type:'text/plain;charset=utf-8'}))
   const link=document.createElement('a')
   link.href=url;link.download='sarp-research-plan-'+locale+'.txt'
   document.body.appendChild(link);link.click();link.remove()
   setTimeout(()=>URL.revokeObjectURL(url),1000)
   setStatus('downloaded')
  }catch{if(request.current===ac)setStatus('error')}
  finally{clearTimeout(timer);if(request.current===ac){request.current=null;setBusy(false)}}
 }
 return <details className={s.panel}>
  <summary>{t.title}</summary>
  <p>{ids.length===1?t.singleScope:t.intro}</p><p className={s.hint}>{t.privacy}</p>
  <fieldset className={s.planFields} disabled={busy}>
   <legend className={s.planLegend}>{t.ownNotes}</legend>
   <label className={s.field}>{t.question}
    <textarea value={notes.question} maxLength={NOTE_LIMIT} dir="auto" onChange={e=>update('question',e.target.value)} aria-describedby="plan-question-hint"/>
   </label>
   <p className={s.hint} id="plan-question-hint">{t.questionHint}</p>
   <label className={s.field}>{t.approach}
    <select value={notes.approach} onChange={e=>update('approach',e.target.value)}>
     {Object.entries(t.approaches).map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select>
   </label>
   {['foundation','feasibility'].map(key=><div key={key}>
    <label className={s.field}>{t[key]}
     <textarea value={notes[key]} maxLength={NOTE_LIMIT} dir="auto" onChange={e=>update(key,e.target.value)} aria-describedby={'plan-'+key+'-hint'}/>
    </label>
    <p className={s.hint} id={'plan-'+key+'-hint'}>{t[key+'Hint']}</p>
   </div>)}
  </fieldset>
  <button type="button" className={s.button} disabled={busy} onClick={download}>{busy?t.working:t.download}</button>
  {status&&<p role={status==='error'?'alert':'status'}>{t[status]}</p>}
 </details>
}
