// Hosted runner only. HTTP stub is loopback, contains invented records.
const assert=require('node:assert/strict')
const {createServer}=require('node:http')
const {spawn}=require('node:child_process')
const {mkdirSync}=require('node:fs')
const {chromium}=require('playwright')
const {KNOWLEDGE_MESSAGES}=require('../lib/i18nKnowledge')
const APP='http://127.0.0.1:3101',PID='abcdefghjkmn',PAPER='22222222-2222-4222-8222-222222222222'
const rec={public_id:PID,title:'Synthetic water study',title_ar:'دراسة تجريبية للمياه',abstract:'The study surveyed 40 farms.',abstract_ar:'شملت الدراسة 40 مزرعة.',authors:[{name:'Synthetic Author'}],year:2026,setting:'record_abstract',fulltext:null,institution:{name_en:'University of Khartoum'},document_type:'article'}
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function main(){
  mkdirSync('artifacts/ui',{recursive:true})
  const db=createServer((req,res)=>{
    let data=null,status=200
    if(req.url.endsWith('/public_record'))data=rec
    else if(req.url.endsWith('/public_catalogue'))data={ok:true,total:1,page:1,limit:20,items:[{...rec,snippet:rec.abstract}],facets:{unit:[],year:[],degree:[],type:[]}}
    else if(req.url.endsWith('/consume_submission_rate_limit'))data=true
    else status=503
    res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))
  })
  await new Promise(r=>db.listen(3199,'127.0.0.1',r))
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3101'],{stdio:'ignore',env:process.env})
  let browser
  try{
    let ready=false;for(let i=0;i<60;i++){try{if((await fetch(APP)).ok){ready=true;break}}catch{}await sleep(500)}
    assert.ok(ready);browser=await chromium.launch()
    for(const [locale,width]of[['en',1280],['ar',390]]){
      const t=KNOWLEDGE_MESSAGES[locale],ctx=await browser.newContext({viewport:{width,height:900}})
      await ctx.addCookies([{name:'sarp_lang',value:locale,url:APP}])
      await ctx.addInitScript(()=>localStorage.setItem('sarp-admin-auth',JSON.stringify({access_token:'synthetic-access-token-for-ui-only',refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'11111111-1111-4111-8111-111111111111'}})))
      let granted=false,actions=[],state={source:{hash:'s1',source:rec},draft:null,published_version_id:null}
      const page=await ctx.newPage(),errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      await page.route('**/*',async route=>{
        const req=route.request(),u=new URL(req.url())
        if(u.origin!==APP){errors.push('Unexpected browser network '+u.origin);return route.abort()}
        if(u.pathname==='/api/admin/me')return json(route,{role:'administrator',confidentiality_required:false})
        if(u.pathname==='/api/admin/metrics-exclusion')return json(route,{ok:true})
        if(u.pathname==='/api/knowledge'){
          const b=req.postDataJSON()
          if(b.action==='source')return json(route,{available:true,scope:'abstract',article:null})
          if(b.action==='ask')return json(route,{insufficient:false,claims:[{text:locale==='ar'?'شملت الدراسة 40 مزرعة.':'The study included 40 farms.',source:locale==='ar'?'abstract_ar':'abstract',quote:locale==='ar'?rec.abstract_ar:rec.abstract}]})
          if(b.action==='permission'){
            if(b.granted!==undefined){granted=b.granted;actions.push(b)}
            return json(route,{granted,text:'Synthetic optional notice',hash:'b'.repeat(64),version:'synthetic'})
          }
        }
        if(u.pathname==='/api/knowledge/admin'){
          const b=req.postDataJSON();actions.push(b.action)
          if(b.action==='load')return json(route,state)
          if(b.action==='generate')state={...state,draft:{id:'v1',version_number:1,source_hash:'s1',headline:'Synthetic article',headline_ar:'مقال تجريبي',body_en:rec.abstract,body_ar:rec.abstract_ar}}
          if(b.action==='save')state={...state,draft:{...state.draft,...b.content,id:'v2',version_number:2}}
          if(b.action==='publish')state={...state,published_version_id:b.versionId}
          if(b.action==='unpublish')state={...state,published_version_id:null}
          return json(route,{ok:true})
        }
        return route.continue()
      })
      await page.goto(APP+'/research')
      await page.getByRole('heading',{name:locale==='ar'?rec.title_ar:rec.title}).waitFor()
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      assert.ok(await page.locator('form[role="search"] section').evaluate(el=>el.getBoundingClientRect().width)>Math.min(width-65,650),'no empty filter column')
      await page.screenshot({path:'artifacts/ui/catalogue-'+locale+'.png',fullPage:true})
      await page.goto(APP+'/research/'+PID)
      await page.getByRole('heading',{name:t.reader}).waitFor()
      await page.getByLabel(t.question,{exact:true}).fill('How many farms?')
      await page.getByRole('button',{name:t.ask,exact:true}).click()
      await page.getByText(t.caution,{exact:true}).waitFor()
      await page.getByText(t.evidence,{exact:true}).click()
      await page.getByRole('link',{name:t.source,exact:true}).click()
      assert.equal(new URL(page.url()).hash,locale==='ar'?'#abstract-ar':'#abstract-en')
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/reader-'+locale+'.png',fullPage:true})
      await page.goto(APP+'/admin/review/'+PAPER+'/article')
      await page.getByRole('button',{name:t.generate,exact:true}).click()
      await page.getByLabel(t.headline,{exact:true}).waitFor()
      const publish=page.getByRole('button',{name:t.publish,exact:true})
      assert.equal(await publish.isEnabled(),false)
      await page.getByLabel(t.body,{exact:true}).fill('Edited synthetic explanation.')
      await page.getByLabel(t.review,{exact:true}).check()
      assert.equal(await publish.isEnabled(),false,'unsaved edits cannot publish')
      await page.getByRole('button',{name:t.save,exact:true}).click()
      await page.waitForFunction(()=>document.querySelector('input[type="checkbox"]')?.checked===false)
      await page.getByLabel(t.review,{exact:true}).check()
      await publish.click()
      await page.getByRole('button',{name:t.unpublish,exact:true}).waitFor()
      assert.ok(actions.includes('publish'))
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/editor-'+locale+'.png',fullPage:true})
      assert.deepEqual(errors,[])
      await ctx.close();console.log('PASS knowledge browser '+locale)
    }
  }finally{if(browser)await browser.close();server.kill('SIGTERM');db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
