const {PUBLIC_ID,getRecord}=require('./server')
const {cleanQuestion,queryTerms,passage}=require('./discovery')
function comparisonIds(raw) {
  if(typeof raw!=='string'||raw.length>80)return []
  const parts=raw.split(',')
  if(parts.length>3||parts.some(id=>!PUBLIC_ID.test(id)))return []
  return [...new Set(parts)]
}
async function loadSelection(sb,raw,rawQuestion,minimum) {
  const ids=comparisonIds(raw)
  if(ids.length<minimum)return {records:[],state:'choose'}
  const results=await Promise.all(ids.map(id=>getRecord(sb,id)))
  // Never render a stale or partial comparison when eligibility changes.
  if(results.some(r=>r.error))return {records:[],state:'unavailable'}
  if(results.some((r,i)=>!r.data||r.data.public_id!==ids[i]))return {records:[],state:'missing'}
  const question=cleanQuestion(rawQuestion),terms=queryTerms(question)
  return {question,terms,records:results.map(r=>{
    const p=r.data
    return {public_id:p.public_id,title:p.title,title_ar:p.title_ar,abstract:p.abstract,abstract_ar:p.abstract_ar,
      excerpts:terms.length?['abstract','abstract_ar'].flatMap(field=>{
        const excerpt=passage(p[field],terms)
        return excerpt?[{...excerpt,field}]:[]
      }):[],
      year:p.year,document_type:p.document_type,degree_type:p.degree_type,institution:p.institution,unit:p.unit}
  }),state:'ready'}
}
// Comparisons still require two studies. A reading plan may start from one.
const loadComparison=(sb,raw,question)=>loadSelection(sb,raw,question,2)
const loadReadingSources=(sb,raw,question)=>loadSelection(sb,raw,question,1)
module.exports={comparisonIds,loadComparison,loadReadingSources}
