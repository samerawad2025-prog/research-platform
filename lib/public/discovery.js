const { getCatalogue, getRecord, PUBLIC_ID } = require('./server')
const LIMITS = { terms:6, candidates:12, results:8 }
const stop = new Set(('a an the and or of to for from in on at by with is are was were be been being do does did can could would should how what which why when where who about this that these those it its their our your research study studies please find show '+
'كيف ما ماذا لماذا متى اين أين من في على عن الى إلى هل التي الذي هذا هذه ذلك تلك مع او أو و ان أن إن كان كانت يكون تكون هي هو البحث بحث دراسة دراسات').split(/\s+/))
function cleanQuestion(value) {
  return String(Array.isArray(value)?value[0]||'':value||'').replace(/\s+/g,' ').trim().slice(0,200)
}
function normalize(word) {
  return word.normalize('NFC').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا')
}
function words(text) {
  return Array.from(String(text||'').matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu),m=>({term:normalize(m[0]),start:m.index,end:m.index+m[0].length}))
}
function queryTerms(question) {
  return [...new Set(words(cleanQuestion(question)).map(w=>w.term).filter(w=>w.length>1&&!stop.has(w)))].slice(0,LIMITS.terms)
}
function matches(text, terms) {
  const found=new Set(words(text).map(w=>w.term))
  return terms.filter(t=>found.has(t))
}
function passage(text, terms) {
  const source=String(text||'')
  const tokens=words(source), target=new Set(terms)
  const hits=tokens.filter(w=>target.has(w.term))
  if(!hits.length)return null
  // Choose the window covering most distinct query words. Never rewrite evidence.
  let best=hits[0],coverage=-1,left=0,right=0
  const counts=new Map()
  for(const hit of hits){
    while(right<hits.length&&hits[right].end<=hit.start+240){
      const term=hits[right++].term;counts.set(term,(counts.get(term)||0)+1)
    }
    while(left<right&&hits[left].start<hit.start-60){
      const term=hits[left++].term,n=counts.get(term)-1
      if(n)counts.set(term,n);else counts.delete(term)
    }
    if(counts.size>coverage){best=hit;coverage=counts.size}
  }
  let start=Math.max(0,best.start-60),end=Math.min(source.length,best.start+240)
  while(start>0&&start<best.start&&!/\s/.test(source[start-1]))start++
  while(end<source.length&&end>best.end&&!/\s/.test(source[end]))end--
  return {text:source.slice(start,end).trim(),before:start>0,after:end<source.length}
}
async function discover(sb, question) {
  const terms=queryTerms(question),empty={terms,items:[],unavailable:false,limited:false}
  if(!terms.length)return empty
  if(!sb)return {...empty,unavailable:true}
  const batches=await Promise.all(terms.map(q=>getCatalogue(sb,{q,page:1},20)))
  if(batches.some(r=>r.error))return {...empty,unavailable:true}
  const candidates=new Map()
  let limited=batches.some(r=>r.data.total>r.data.items.length)
  for(const r of batches)for(const item of r.data.items){
    if(PUBLIC_ID.test(item.public_id)&&!candidates.has(item.public_id))candidates.set(item.public_id,item)
  }
  const preliminary=r=>matches([r.title,r.title_ar,r.snippet].filter(Boolean).join(' '),terms).length
  const ranked=[...candidates.values()].sort((a,b)=>preliminary(b)-preliminary(a)||a.public_id.localeCompare(b.public_id))
  limited ||= ranked.length>LIMITS.candidates
  const records=await Promise.all(ranked.slice(0,LIMITS.candidates).map(r=>getRecord(sb,r.public_id)))
  if(records.some(r=>r.error))return {...empty,unavailable:true}
  const items=records.flatMap(({data:r})=>{
    if(!r)return [] // Withdrawn between candidate retrieval and final source check.
    const titleTerms=matches([r.title,r.title_ar].filter(Boolean).join(' '),terms)
    const excerpts=['abstract','abstract_ar'].flatMap(field=>{
      const p=passage(r[field],terms)
      return p?[{...p,field}]:[]
    })
    const matched=matches([r.title,r.title_ar,r.abstract,r.abstract_ar].filter(Boolean).join(' '),terms)
    if(!matched.length)return []
    return [{publicId:r.public_id,title:r.title,titleAr:r.title_ar,year:r.year,matched,excerpts,
      score:matched.length*10+titleTerms.length}]
  }).sort((a,b)=>b.score-a.score||a.publicId.localeCompare(b.publicId))
  limited ||= items.length>LIMITS.results
  return {terms,items:items.slice(0,LIMITS.results).map(({score,...r})=>r),unavailable:false,limited}
}
module.exports={LIMITS,cleanQuestion,queryTerms,passage,discover}
