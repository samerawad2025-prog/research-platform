// Hosted CI only: built app, synthetic intercepted API responses.
// No real credentials or hosted database; unexpected remote requests fail.
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { chromium } = require('playwright')
const { KNOWLEDGE_MESSAGES } = require('../lib/i18nKnowledge')
const { ADMIN_MESSAGES } = require('../lib/i18nAdmin')
const APP = 'http://127.0.0.1:3100'
const PAPER = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'a'.repeat(64)
const PUBLIC = '/research/abcdefghjkmn'
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
const wait = ms => new Promise(r => setTimeout(r, ms))
function detail(status = 'approved', revision = 'r1', enabled = true) {
  const approved = status === 'approved'
  return {
    paper: { title: 'Synthetic publication workflow', year: 2026, submitted_at: '2026-01-01', manual_entry_source: 'researcher' },
    review: { status }, revision, viewer_role: 'administrator',
    states: { confirmed: true, approval_recorded: approved, publication_approved: approved },
    eligibility: { record_public: approved, fulltext_public: false, reasons: approved ? [] : ['not_approved'], fulltext_reasons: ['setting_is_record_abstract'] },
    public_url: approved && enabled ? PUBLIC : null, public_site_enabled: enabled,
    institution: {}, submitter: { claimed_role: 'author' },
    evidence: { setting: 'record_abstract', problems: [] }, acceptance: {},
    authors: [], issues: [], notes: [], events: [], approvals: [],
    metadata_check: { missing: [], advisory: [] }, duplicates: { items: [], hidden_count: 0 },
    documents: { original: {}, versions: [] }, preconditions: { ok: true, failures: [] },
  }
}
async function run() {
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3100'], { stdio: 'ignore', env: process.env })
  let browser
  try {
    let ready = false
    for (let n = 0; n < 60; n++) {
      try { if ((await fetch(APP)).ok) { ready = true; break } } catch {}
      await wait(500)
    }
    assert.ok(ready, 'built app starts')
    browser = await chromium.launch()
    mkdirSync('artifacts/ui', { recursive: true })
    for (const [lang, width] of [['en', 1280], ['ar', 390]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } })
      await ctx.addCookies([{ name: 'sarp_lang', value: lang, url: APP }])
      await ctx.addInitScript(() => {
        localStorage.setItem('sarp-admin-auth', JSON.stringify({
          access_token: 'synthetic-access-token-for-ui-only', refresh_token: 'synthetic',
          expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer',
          user: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid' },
        }))
      })
      let granted = false
      let d = detail(), saves = [], publication = 'published', publicationCalls = 0
      const failures = []
      const page = await ctx.newPage()
      page.on('pageerror', e => failures.push(e.message))
      await page.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url())
        if (u.origin === 'http://127.0.0.1:3199') {
          if (u.pathname.endsWith('/get_paper_for_confirmation')) return json(route, {
            paper_id: PAPER, title: 'Synthetic study', year: 2026, metadata_confirmed_at: '2026-01-01',
            extraction_status: 'completed', researchers: [{ full_name: 'Synthetic Author', author_order: 1 }],
            extraction_detail: {}, automatic_processing: false,
          })
          if (u.pathname.endsWith('/confirm_researcher_metadata')) return json(route, { ok: true })
          failures.push('unexpected database request: ' + u.pathname)
          return route.abort()
        }
        if (u.origin !== APP) { failures.push('unexpected remote host: ' + u.hostname); return route.abort() }
        if (u.pathname === '/api/admin/me') return json(route, { role: 'administrator', confidentiality_required: false })
        if (u.pathname === '/api/admin/institutions' || u.pathname === '/api/admin/staff') return json(route, [])
        if (u.pathname === '/api/admin/metrics-exclusion') return json(route, { ok: true })
        if (u.pathname === '/api/admin/reviews/' + PAPER) return json(route, d)
        if (u.pathname.endsWith('/decision')) {
          saves.push(req.postDataJSON())
          d = detail(saves.at(-1).decision, 'r' + (saves.length + 1))
          return json(route, { ok: true })
        }
        if (u.pathname === '/api/knowledge') {
          const b=req.postDataJSON()
          assert.equal(b.token,TOKEN)
          assert.ok(!req.headers().referer)
          if(b.granted!==undefined)granted=b.granted
          return json(route,{granted,text:'Synthetic optional permission',hash:'b'.repeat(64),version:'synthetic'})
        }
        if (u.pathname === '/api/submissions/publication-status') {
          publicationCalls++
          assert.deepEqual(req.postDataJSON(), { token: TOKEN })
          assert.ok(!req.headers().referer, 'private URL is not sent as referrer')
          return publication === 'error' ? json(route, { reason: 'unavailable' }, 503) :
            json(route, { state: publication, publicUrl: publication === 'published' ? PUBLIC : null })
        }
        if (u.pathname === PUBLIC) {
          assert.ok(!req.headers().referer, 'public navigation contains no private referrer')
          return route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic public record</h1>' })
        }
        return route.continue()
      })
      const t = ADMIN_MESSAGES[lang]
      await page.goto(APP + '/admin/review/' + PAPER)
      const choice = page.getByRole('combobox', { name: t.review.decideHeading, exact: true })
      await choice.waitFor()
      const save = page.getByRole('button', { name: t.review.decideSubmit, exact: true })
      assert.equal(await choice.inputValue(), '')
      assert.equal(await save.isEnabled(), false)
      assert.equal(await page.getByText(t.review.isPublic, { exact: true }).isVisible(), true)
      assert.equal(await page.locator('[data-section="hi-h"]').getAttribute('open'), null)
      assert.equal(await page.locator('[data-section="sub-h"]').getAttribute('open'), null)
      assert.equal(await page.locator('[data-section="rc-h"]').count(), 0, 'founder does not see volunteer recommendation')
      assert.equal(await page.locator('[data-section="as-h"]').count(), 0, 'no assignment form without volunteers')
      await page.locator('[data-section="hi-h"] summary').focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('[data-section="hi-h"]').getAttribute('open'), '')
      await page.keyboard.press('Enter')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'review fits viewport')
      await page.screenshot({ path: 'artifacts/ui/admin-' + lang + '.png', fullPage: true })
      // The previous accidental path is now impossible without both choices.
      await choice.selectOption('reviewed')
      assert.equal(await save.isEnabled(), false)
      await page.getByRole('checkbox', { name: t.review.removalConfirm, exact: true }).check()
      await save.focus()
      await page.keyboard.press('Enter')
      await page.getByText(t.review.notPublic, { exact: true }).waitFor()
      assert.equal(saves.length, 1)
      assert.equal(saves[0].decision, 'reviewed')
      assert.equal(saves[0].expectedRevision, 'r1')
      assert.equal(await choice.inputValue(), '')
      assert.equal(await save.isEnabled(), false)
      // Fresh approval of a private record still works.
      await choice.selectOption('approved')
      await save.click()
      await page.getByText(t.review.isPublic, { exact: true }).waitFor()
      assert.equal(saves.length, 2)
      // A disabled catalogue never claims an eligible record is public.
      d = detail('approved', 'r3', false)
      await page.reload()
      await page.getByText(t.review.notPublic, { exact: true }).waitFor()
      assert.equal(await page.getByRole('link', { name: t.review.publicLinkOpen, exact: true }).count(), 0)
      assert.equal(await page.getByText(t.review.publicLinkOff, { exact: true }).isVisible(), true)

      const kt=KNOWLEDGE_MESSAGES[lang]
      publication='not_public'
      await page.goto(APP + '/confirm/' + TOKEN)
      const view=page.getByRole('link',{name:kt.viewResearch,exact:true})
      await view.waitFor()
      assert.equal(await page.locator('section[aria-labelledby="publication-status-heading"]').count(),0)
      assert.equal(await page.getByRole('heading',{name:kt.permission,exact:true}).count(),0)
      assert.equal(await page.getByRole('button', {name:lang==='ar'?'تأكيد هذه التفاصيل':'Confirm these details', exact:true}).count(),0)
      await page.getByRole('button',{name:kt.editDetails,exact:true}).click()
      await page.getByRole('button',{name:lang==='ar'?'تأكيد هذه التفاصيل':'Confirm these details',exact:true}).waitFor()
      await page.reload()
      await view.waitFor()
      assert.equal(await view.getAttribute('referrerpolicy'),'no-referrer')
      await page.screenshot({path:'artifacts/ui/completion-'+lang+'.png',fullPage:true})
      await view.click()
      await page.getByRole('heading',{name:'Synthetic study',exact:true}).waitFor()
      await page.getByText(kt.pending,{exact:true}).waitFor()
      assert.ok(await page.getByText(kt.onlyYou,{exact:true}).isVisible())
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content').then(x=>x.includes('noindex')),true)
      await page.getByText(kt.publicPreview,{exact:true}).click()
      assert.equal(await page.locator('#own-research-title').count(),1)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:'artifacts/ui/private-catalogue-'+lang+'.png',fullPage:true})
      await page.getByText(kt.researchSettings,{exact:true}).click()
      const consent=page.getByRole('checkbox',{name:kt.agree,exact:true})
      await consent.waitFor()
      assert.equal(await consent.isChecked(),false)
      await consent.check()
      await page.getByRole('button',{name:kt.enable,exact:true}).click()
      await page.getByText(kt.enabled,{exact:true}).waitFor()
      assert.equal(await page.getByRole('button',{name:kt.revoke,exact:true}).isVisible(),false)
      await page.getByText(kt.manage,{exact:true}).click()
      await page.getByRole('button',{name:kt.revoke,exact:true}).click()
      await page.getByRole('button',{name:kt.enable,exact:true}).waitFor()
      assert.equal(granted,false)
      publication='error'
      await page.reload()
      await page.getByText(kt.statusUnavailable,{exact:true}).waitFor()
      assert.equal(await page.getByText(kt.pending,{exact:true}).count(),0)
      publication='published'
      await page.reload()
      const link=page.getByRole('link',{name:kt.openPublished,exact:true})
      await link.waitFor()
      assert.equal(await link.getAttribute('href'),PUBLIC)
      assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer')
      assert.ok(publicationCalls>=3)
      await link.click()
      await page.getByRole('heading',{name:'Synthetic public record'}).waitFor()
      await page.goto(APP)
      await page.getByRole('link', { name: lang === 'ar' ? 'تصفّح البحوث' : 'Browse research', exact: true }).first().waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'landing fits viewport')
      await page.screenshot({ path: 'artifacts/ui/home-' + lang + '.png', fullPage: true })
      assert.deepEqual(failures, [])
      console.log('PASS publication workflow ' + lang + ' at ' + width + 'px')
      await ctx.close()
    }
    // Actual route shell: bad input is rejected and never cached.
    const bad = await fetch(APP + '/api/submissions/publication-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'bare-paper-id' }) })
    assert.equal(bad.status, 400)
    assert.equal(bad.headers.get('cache-control'), 'no-store')
    assert.match(bad.headers.get('x-robots-tag'), /noindex/)
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
  }
}
run().catch(e => { console.error(e); process.exitCode = 1 })
