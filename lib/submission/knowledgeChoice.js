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

function validChoice(choice) {
  return choice && ['en','ar'].includes(choice.language) && /^[0-9a-f]{64}$/.test(choice.hash || '')
}
function session() { try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null } }
async function choiceKey(token) {
  const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))
  return 'sarp-reader-choice:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
}
async function rememberKnowledgeChoice(token,choice,storage=session(),now=Date.now()) {
  if(!storage || (choice!==null&&!validChoice(choice)))return false
  try { storage.setItem(await choiceKey(token),JSON.stringify({choice,expiresAt:now+86400000}));return true } catch { return false }
}
async function readKnowledgeChoice(token,storage=session(),now=Date.now()) {
  try {
    if(!storage)return null
    const key=await choiceKey(token),value=JSON.parse(storage.getItem(key)||'null')
    if(!value || !Number.isFinite(value.expiresAt) || value.expiresAt<=now || (value.choice!==null&&!validChoice(value.choice))){storage.removeItem(key);return null}
    return {choice:value.choice}
  } catch { return null }
}
async function forgetKnowledgeChoice(token,storage=session()) {
  try { storage?.removeItem(await choiceKey(token)) } catch {}
}
module.exports={saveKnowledgeChoice,validChoice,rememberKnowledgeChoice,readKnowledgeChoice,forgetKnowledgeChoice}

