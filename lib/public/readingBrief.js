const {isPublicEnabled,siteOrigin}=require('./server')
const {loadComparison}=require('./comparison')
const {COMPARISON_MESSAGES}=require('../i18nComparison')
const line=value=>String(value||'').replace(/[\r\n\t]+/g,' ').trim()
async function readingBrief({sb,params,env=process.env,now=new Date()}){
 const lang=params.get('lang')||'en',t=COMPARISON_MESSAGES[lang]||COMPARISON_MESSAGES.en
 const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Type':'text/plain; charset=utf-8'}
 const fail=status=>({status,headers,body:t.briefError})
 if(!isPublicEnabled(env))return fail(404)
 if(!['en','ar'].includes(lang)||params.toString().length>1500||
   [...params.keys()].some(k=>!['ids','q','lang'].includes(k)||params.getAll(k).length!==1))return fail(400)
 const origin=siteOrigin(env)
 if(!sb||!origin)return fail(503)
 const result=await loadComparison(sb,params.get('ids'),params.get('q'))
 if(result.state!=='ready')return fail(result.state==='choose'?400:result.state==='missing'?404:503)
 const lines=[t.briefTitle,t.prepared+': '+now.toISOString(),'',t.briefSnapshot,'',t.briefQuestion+': '+(line(result.question)||t.briefNoQuestion),'',t.briefSources]
 result.records.forEach((p,i)=>{
  const title=lang==='ar'?p.title_ar||p.title:p.title||p.title_ar
  lines.push('',(i+1)+'. '+line(title||t.absent),t.year+': '+line(p.year||t.absent),origin+'/research/'+p.public_id)
  if(p.excerpts.length){
   lines.push(t.passages+':')
   for(const e of p.excerpts)lines.push((e.before?'…':'')+e.text+(e.after?'…':''),origin+'/research/'+p.public_id+'#'+(e.field==='abstract_ar'?'abstract-ar':'abstract-en'))
  }else lines.push(t.briefNoExcerpt)
 })
 lines.push('',t.questions,...t.prompts.map((p,i)=>(i+1)+'. '+p),'',t.narrow)
 return {status:200,headers:{...headers,'Content-Disposition':'attachment; filename="sarp-reading-brief-'+lang+'.txt"'},body:lines.join('\n')+'\n'}
}
module.exports={readingBrief}
