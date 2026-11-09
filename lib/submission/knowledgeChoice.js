// Optional choice is bound to the notice and language actually displayed.
// Called only after metadata confirmation succeeds. Failure never undoes the submission.
async function saveKnowledgeChoice({token,choice,language,fetchImpl=fetch}) {
  if (!choice || choice.language !== language || !/^[0-9a-f]{64}$/.test(choice.hash || '')) return 'skipped'
  const ac=new AbortController(), timer=setTimeout(()=>ac.abort(),8000)
  try {
    const r=await fetchImpl('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'permission',token,language:choice.language,granted:true,hash:choice.hash}),
      referrerPolicy:'no-referrer',cache:'no-store',signal:ac.signal})
    const data=await r.json()
    return r.ok && data.granted===true ? 'saved' : 'unavailable'
  } catch { return 'unavailable' } finally { clearTimeout(timer) }
}
module.exports={saveKnowledgeChoice}
