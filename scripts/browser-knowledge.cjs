// Hosted runner only. HTTP stub is loopback, contains invented records.
const assert=require('node:assert/strict')
const {createServer}=require('node:http')
const {spawn}=require('node:child_process')
const {mkdirSync}=require('node:fs')
const {chromium}=require('playwright')
const {DISCOVERY_MESSAGES}=require('../lib/i18nDiscovery')
const {DIRECTIONS_MESSAGES}=require('../lib/i18nDirections')
const {COMPARISON_MESSAGES}=require('../lib/i18nComparison')
const {SUBMISSION_UX}=require('../lib/i18nSubmissionUX')
const {KNOWLEDGE_MESSAGES}=require('../lib/i18nKnowledge')
const {SYNTHESIS_MESSAGES}=require('../lib/i18nSynthesis')
const APP='http://127.0.0.1:3101',PID='abcdefghjkmn',PAPER='22222222-2222-4222-8222-222222222222'
const rec={public_id:PID,title:'Synthetic water study',title_ar:'دراسة تجريبية للمياه',abstract:'The study surveyed 40 farms.',abstract_ar:'شملت الدراسة 40 مزرعة.',authors:[{name:'Synthetic Author'}],year:2026,setting:'record_abstract',fulltext:null,institution:{name_en:'University of Khartoum'},document_type:'article'}
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function main(){
  mkdirSync('artifacts/ui',{recursive:true})
  const db=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk
    const requested=raw?JSON.parse(raw):{}
    const other={...rec,public_id:'abcdefghjkmp',title:'Synthetic follow-up study',title_ar:'دراسة متابعة تجريبية'}
    let data=null,status=200
    if(req.url.endsWith('/public_record'))data=requested.p_public_id===PID?rec:requested.p_public_id==='abcdefghjkmp'?other:null
    else if(req.url.endsWith('/public_catalogue'))data={ok:true,total:2,page:1,limit:20,items:[{...rec,snippet:rec.abstract},{...other,snippet:other.abstract}],facets:{unit:[],year:[],degree:[],type:[]}}
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
      let metadataConfirmed=true,confirmationFails=false,permissionFails=false,permissionWrites=0
      let comparisonMode='normal',comparisonCalls=[]
      let holdAnswers=false,pendingAnswers=[]
      let granted=false,actions=[],state={source:{public_id:PID,hash:'s1',source:rec},draft:null,published_version_id:null}
      const page=await ctx.newPage(),errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      await page.route('**/*',async route=>{
        const req=route.request(),u=new URL(req.url())
        if(u.origin==='http://127.0.0.1:3199' && u.pathname.endsWith('/get_paper_for_confirmation')){
          assert.ok(!req.headers().referer,'private URL never sent to database')
          return json(route, req.postDataJSON().p_token==='a'.repeat(64)?{title:'Private synthetic submission',metadata_confirmed_at:metadataConfirmed?'2026-01-01':null,extraction_status:'completed',automatic_processing:false,manual_entry_at:'2026-01-01',researchers:[{full_name:'Synthetic Submitter'}],abstract:'Private synthetic abstract.'}:null)
        }
        if(u.origin==='http://127.0.0.1:3199' && u.pathname.endsWith('/confirm_researcher_metadata')){
          if(confirmationFails)return json(route,{message:'synthetic failure',code:'TEST'},500)
          metadataConfirmed=true;return json(route,{ok:true})
        }
        if(u.origin!==APP){errors.push('Unexpected browser network '+u.origin);return route.abort()}
        if(u.pathname==='/api/submissions/terms')return json(route,{available:true,agreements:[{id:'synthetic-'+locale,language:locale,versionLabel:'Synthetic',versionDate:'2026-11-09',text:'# Synthetic agreement',acceptanceSentence:'Accept synthetic terms'}],offer:{token:'synthetic',decision:'automatic',expiresAt:new Date(Date.now()+1800000).toISOString()},processing:{terms:'gemini_api_unpaid'}})
        if(u.pathname==='/api/submissions/publication-status')return json(route,{state:'not_public',publicUrl:null})
        if(u.pathname==='/api/admin/me')return json(route,{role:'administrator',confidentiality_required:false})
        if(u.pathname==='/api/admin/metrics-exclusion')return json(route,{ok:true})
        if(u.pathname==='/api/knowledge/compare'){
          const b=req.postDataJSON()
          if(b.action==='source')return json(route,{available:true,count:2})
          comparisonCalls.push(b)
          if(comparisonMode==='changed')return json(route,{reason:'source_changed'},409)
          if(comparisonMode==='insufficient')return json(route,{insufficient:true,claims:[],covered:0,count:2})
          return json(route,{insufficient:false,count:2,covered:2,claims:[{kind:'comparison',text:'Synthetic comparison of the selected studies.',evidence:[
            {publicId:PID,source:locale==='ar'?'abstract_ar':'abstract',quote:locale==='ar'?rec.abstract_ar:rec.abstract},
            {publicId:'abcdefghjkmp',source:'abstract',quote:rec.abstract}
          ]}]})
        }
        if(u.pathname==='/api/knowledge'){
          const b=req.postDataJSON()
          if(b.action==='notice')return json(route,{text:'Synthetic optional notice',hash:'b'.repeat(64),version:'synthetic'})
          if(b.action==='source')return json(route,{available:true,scope:'abstract',article:state.published_version_id?state.draft:null})
          if(b.action==='ask'&&holdAnswers){
            let release,finish
            const gate=new Promise(resolve=>{release=resolve}),done=new Promise(resolve=>{finish=resolve})
            pendingAnswers.push({release,done})
            await gate
            try{await json(route,{insufficient:false,claims:[{text:'STALE synthetic answer',source:'abstract',quote:rec.abstract}]}).catch(()=>{})}finally{finish()}
            return
          }
          if(b.action==='ask')return json(route,{insufficient:false,claims:[{text:locale==='ar'?'شملت الدراسة 40 مزرعة.':'The study included 40 farms.',source:locale==='ar'?'abstract_ar':'abstract',quote:locale==='ar'?rec.abstract_ar:rec.abstract}]})
          if(b.action==='permission'){
            if(b.granted!==undefined){permissionWrites++;if(permissionFails)return json(route,{reason:'unavailable'},503);granted=b.granted;actions.push(b)}
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
      const dt=DISCOVERY_MESSAGES[locale]
      await page.getByRole('link',{name:dt.title,exact:true}).click()
      await page.getByLabel(dt.label,{exact:true}).fill(locale==='ar'?'كيف شملت الدراسة مزرعة؟':'How did the study survey farms?')
      await page.getByRole('button',{name:dt.search,exact:true}).click()
      await page.getByText(dt.matched+':',{exact:false}).first().waitFor()
      assert.ok(await page.locator('blockquote').count()>0)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/discovery-'+locale+'.png',fullPage:true})
      const focused=COMPARISON_MESSAGES[locale]
      const checkboxes=page.getByRole('checkbox')
      await checkboxes.nth(0).check();await checkboxes.nth(1).check()
      await page.getByRole('button',{name:focused.clear,exact:true}).click()
      assert.equal(await page.getByRole('checkbox',{checked:true}).count(),0)
      await checkboxes.nth(0).check();await checkboxes.nth(1).check()
      await page.getByRole('link',{name:focused.title,exact:true}).click()
      await page.getByRole('table',{name:focused.title,exact:true}).waitFor()
      await page.getByRole('rowheader',{name:focused.passages,exact:true}).waitFor()
      assert.equal(new URL(page.url()).searchParams.get('q'),locale==='ar'?'كيف شملت الدراسة مزرعة؟':'How did the study survey farms?')
      assert.equal(await page.locator('table blockquote').count(),2)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/focused-comparison-'+locale+'.png',fullPage:true})
      const st=SYNTHESIS_MESSAGES[locale]
      await page.getByRole('heading',{name:st.title,exact:true}).waitFor()
      await page.getByRole('button',{name:st.ask,exact:true}).click()
      await page.getByText(st.coverage(2,2),{exact:true}).waitFor()
      assert.deepEqual(comparisonCalls[0].ids,[PID,'abcdefghjkmp'])
      assert.equal(comparisonCalls[0].language,locale)
      await page.getByText(st.evidence,{exact:true}).click()
      const aiPanel=page.getByRole('region',{name:st.title,exact:true})
      assert.equal(await aiPanel.locator('blockquote').count(),2)
      assert.ok((await aiPanel.locator('a[href^="/research/"]').first().getAttribute('href')).includes(PID+'#abstract-'))
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/multi-study-reader-'+locale+'.png',fullPage:true})
      comparisonMode='insufficient'
      await page.getByRole('button',{name:st.ask,exact:true}).click()
      await page.getByText(st.insufficient,{exact:true}).waitFor()
      assert.equal(await page.getByText('Synthetic comparison of the selected studies.',{exact:true}).count(),0)
      comparisonMode='changed'
      await page.getByRole('button',{name:st.ask,exact:true}).click()
      await page.getByText(st.changed,{exact:true}).waitFor()
      assert.equal(await page.getByRole('button',{name:st.ask,exact:true}).count(),0)
      comparisonMode='normal'
      await page.getByRole('searchbox',{name:focused.question,exact:true}).fill('zzzznomatch')
      await page.getByRole('button',{name:focused.apply,exact:true}).click()
      await page.getByText(focused.noPassage,{exact:true}).first().waitFor()
      assert.equal(await page.locator('table blockquote').count(),0)
      await page.getByRole('link',{name:focused.backToQuestion,exact:true}).click()
      await page.getByRole('heading',{name:dt.empty,exact:true}).waitFor()
      await page.goto(APP+'/research/discover?q=zzzznomatch')
      await page.getByRole('heading',{name:dt.empty,exact:true}).waitFor()
      await page.goto(APP+'/research')
      await page.getByRole('link',{name:DIRECTIONS_MESSAGES[locale].title,exact:true}).click()
      await page.getByRole('heading',{name:DIRECTIONS_MESSAGES[locale].empty,exact:true}).waitFor()
      assert.equal(await page.locator('main article').count(),0)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/directions-'+locale+'.png',fullPage:true})
      await page.goto(APP+'/research')
      const ct=COMPARISON_MESSAGES[locale]
      await page.getByRole('checkbox',{name:ct.select+': '+(locale==='ar'?rec.title_ar:rec.title),exact:true}).check()
      await page.getByRole('checkbox',{name:ct.select+': '+(locale==='ar'?'دراسة متابعة تجريبية':'Synthetic follow-up study'),exact:true}).check()
      await page.getByRole('link',{name:ct.title,exact:true}).click()
      await page.getByRole('table',{name:ct.title,exact:true}).waitFor()
      await page.getByText(ct.scope,{exact:true}).waitFor()
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/comparison-'+locale+'.png',fullPage:true})
      await page.goto(APP+'/research/compare?ids='+PID+',abcdefghjkmq')
      await page.getByText(ct.missing,{exact:true}).waitFor()
      assert.equal(await page.getByRole('table').count(),0)
      await page.goto(APP+'/research/'+PID)
      await page.getByRole('heading',{name:t.reader}).waitFor()
      assert.equal(await page.getByRole('heading',{name:DIRECTIONS_MESSAGES[locale].buildOn,exact:true}).count(),0,'unrelated or unavailable directions stay absent')
      await page.getByLabel(t.question,{exact:true}).fill('How many farms?')
      await page.getByRole('button',{name:t.ask,exact:true}).click()
      await page.getByText(t.caution,{exact:true}).waitFor()
      await page.getByText(t.evidence,{exact:true}).click()
      await page.getByRole('link',{name:t.source,exact:true}).click()
      assert.equal(new URL(page.url()).hash,locale==='ar'?'#abstract-ar':'#abstract-en')
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/reader-'+locale+'.png',fullPage:true})
      async function heldAsk(){
        holdAnswers=true
        await page.getByRole('button',{name:t.ask,exact:true}).click()
        for(let i=0;i<100&&!pendingAnswers.length;i++)await sleep(10)
        assert.ok(pendingAnswers.length,'request reached the stub')
        return pendingAnswers.shift()
      }
      // Cancellation retains the typed question and ignores a late answer.
      let held=await heldAsk()
      await page.getByRole('button',{name:t.cancel,exact:true}).click()
      await page.getByText(t.cancelled,{exact:true}).waitFor()
      held.release();await held.done
      assert.equal(await page.getByText('STALE synthetic answer',{exact:true}).count(),0)
      assert.equal(await page.getByLabel(t.question,{exact:true}).inputValue(),'How many farms?')
      // Advance browser time rather than delaying the hosted job for 35 seconds.
      await page.clock.install()
      held=await heldAsk()
      await page.clock.fastForward(35001)
      await page.getByText(t.timedOut,{exact:true}).waitFor()
      held.release();await held.done
      assert.equal(await page.getByText('STALE synthetic answer',{exact:true}).count(),0)
      assert.ok(await page.getByRole('button',{name:t.ask,exact:true}).isEnabled())
      // A language switch creates a fresh reader while preserving the question.
      held=await heldAsk()
      const otherLocale=locale==='en'?'ar':'en',otherText=KNOWLEDGE_MESSAGES[otherLocale]
      await page.locator('header button[lang="'+otherLocale+'"]').click()
      await page.getByRole('heading',{name:otherText.reader,exact:true}).waitFor()
      assert.equal(await page.getByLabel(otherText.question,{exact:true}).inputValue(),'How many farms?')
      held.release();await held.done
      assert.equal(await page.getByText('STALE synthetic answer',{exact:true}).count(),0)
      await page.locator('header button[lang="'+locale+'"]').click()
      await page.getByRole('heading',{name:t.reader,exact:true}).waitFor()
      holdAnswers=false
      await page.getByRole('button',{name:t.ask,exact:true}).click()
      await page.getByText(t.caution,{exact:true}).waitFor()
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
      await page.getByText(t.endingPreview,{exact:true}).click()
      assert.equal(await page.getByRole('link',{name:t.originalResearch,exact:true}).getAttribute('href'),'/research/'+PID)
      assert.equal(await page.getByRole('link',{name:t.submitResearch,exact:true}).getAttribute('href'),'/submit')
      await page.goto(APP+'/research/'+PID)
      await page.getByRole('heading',{name:locale==='ar'?'مقال تجريبي':'Synthetic article',exact:true}).waitFor()
      await page.getByText(t.contribute,{exact:true}).waitFor()
      assert.equal(await page.getByRole('link',{name:t.originalResearch,exact:true}).getAttribute('href'),'/research/'+PID)
      assert.equal(await page.getByRole('link',{name:t.submitResearch,exact:true}).getAttribute('href'),'/submit')
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/article-ending-'+locale+'.png',fullPage:true})
      await page.goto(APP+'/confirm/'+'a'.repeat(64)+'/preview')
      await page.getByRole('heading',{name:'Private synthetic submission',exact:true}).waitFor()
      await page.getByRole('heading',{name:locale==='ar'?rec.title_ar:rec.title,exact:true}).waitFor()
      await page.getByText(t.pending,{exact:true}).waitFor()
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/catalogue-with-private-preview-'+locale+'.png',fullPage:true})
      await page.goto(APP+'/research')
      assert.equal(await page.getByRole('heading',{name:'Private synthetic submission',exact:true}).count(),0,'normal catalogue never exposes pending paper')
      await page.goto(APP+'/confirm/'+'b'.repeat(64)+'/preview')
      await page.getByText(t.previewUnavailable,{exact:true}).waitFor()
      assert.equal(await page.locator('#own-research-title').count(),0,'unknown private credential reveals no paper')
      const ux=SUBMISSION_UX[locale]
      await page.goto(APP+'/submit')
      await page.getByRole('combobox',{name:ux.role,exact:true}).waitFor()
      await page.getByRole('checkbox',{name:ux.optionalLabel,exact:true}).waitFor()
      assert.equal(await page.getByRole('checkbox').count(),2,'terms and optional AI choice sit together on the first page')
      assert.equal(await page.getByRole('checkbox',{name:ux.optionalLabel,exact:true}).isChecked(),false)
      assert.equal(await page.getByRole('checkbox',{name:ux.terms,exact:true}).isChecked(),false)
      assert.equal(await page.locator('input[value="record_abstract_fulltext"]').isChecked(),true)
      await page.locator('input[value="record_abstract"]').check()
      await page.getByText(ux.abstractHint+' '+ux.review,{exact:true}).waitFor()
      await page.getByRole('combobox',{name:ux.processing,exact:true}).selectOption('manual')
      await page.getByText(ux.manualHint,{exact:true}).waitFor()
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/short-submission-'+locale+'.png',fullPage:true})
      const confirmLabel=locale==='ar'?'تأكيد هذه التفاصيل':'Confirm these details'
      // A choice from submission survives reload without another checkbox or early permission write.
      metadataConfirmed=false;granted=false;permissionWrites=0
      await page.evaluate(async language=>{
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('a'.repeat(64)))
        const key='sarp-reader-choice:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
        sessionStorage.setItem(key,JSON.stringify({choice:{language,hash:'b'.repeat(64)},expiresAt:Date.now()+86400000}))
      },locale)
      await page.goto(APP+'/confirm/'+'a'.repeat(64))
      await page.getByText(ux.selected,{exact:false}).waitFor()
      assert.equal(await page.getByRole('checkbox',{name:ux.optionalLabel,exact:true}).count(),0)
      assert.equal(permissionWrites,0)
      await page.reload();await page.getByText(ux.selected,{exact:false}).waitFor()
      await page.getByRole('button',{name:confirmLabel,exact:true}).click()
      await page.getByText(ux.saved,{exact:true}).waitFor();assert.equal(permissionWrites,1)
      // The optional grant happens after successful metadata confirmation only.
      metadataConfirmed=false;granted=false;permissionWrites=0;confirmationFails=true
      await page.goto(APP+'/confirm/'+'a'.repeat(64))
      const opt=page.getByRole('checkbox',{name:ux.optionalLabel,exact:true})
      await opt.waitFor();assert.equal(await opt.isChecked(),false)
      await opt.check()
      await page.getByRole('button',{name:confirmLabel,exact:true}).click()
      await page.getByRole('alert').waitFor()
      assert.equal(permissionWrites,0)
      confirmationFails=false
      await page.getByRole('button',{name:confirmLabel,exact:true}).click()
      await page.getByText(ux.saved,{exact:true}).waitFor()
      assert.equal(permissionWrites,1)
      await page.screenshot({path:'artifacts/ui/integrated-permission-'+locale+'.png',fullPage:true})
      // A skipped optional choice never grants or revokes anything.
      metadataConfirmed=false;permissionWrites=0
      await page.reload()
      await opt.waitFor()
      await page.getByRole('button',{name:confirmLabel,exact:true}).click()
      await page.getByRole('link',{name:t.viewResearch,exact:true}).waitFor()
      assert.equal(permissionWrites,0)
      // Failure is honest, and the research still reaches completion.
      metadataConfirmed=false;permissionFails=true
      await page.reload();await opt.waitFor();await opt.check()
      await page.getByRole('button',{name:confirmLabel,exact:true}).click()
      await page.getByText(ux.failed,{exact:true}).waitFor()
      await page.getByRole('link',{name:t.viewResearch,exact:true}).waitFor()
      assert.equal(permissionWrites,1)
      assert.deepEqual(errors,[])
      await ctx.close();console.log('PASS knowledge browser '+locale)
    }
  }finally{if(browser)await browser.close();server.kill('SIGTERM');db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
