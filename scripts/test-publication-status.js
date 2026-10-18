const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { handlePublicationStatus } = require('../lib/submission/publicationStatus')
const token = 'a'.repeat(64)
const id = 'abcdefghjkmn'
const env = { PUBLIC_RESEARCH: 'enabled', PUBLIC_SITE_ORIGIN: 'https://example.org' }

function harness({ paper = { id: 'private-id', metadata_confirmed_at: '2026-01-01' }, link = { public_id: id }, record = { public_id: id }, fail = '' } = {}) {
  const calls = []
  return { calls, supabase: {
    from(table) {
      calls.push(['table', table])
      return { select(columns) {
        calls.push(['columns', columns])
        return { eq(key, value) {
          calls.push(['eq', key, value])
          return { async maybeSingle() {
            if (fail === 'throw') throw Error('private diagnostics')
            return { data: table === 'papers' ? paper : link, error: fail === table ? {} : null }
          } }
        } }
      } }
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args])
      return { data: record, error: fail === 'rpc' ? {} : null }
    },
  } }
}
async function run() {
  for (const body of [null, {}, { token: 'private-id' }, { token, paperId: 'x' }, [], { token: 'a'.repeat(63) }]) {
    const h = harness()
    assert.equal((await handlePublicationStatus({ body, env, ...h })).status, 400)
    assert.equal(h.calls.length, 0)
  }
  const valid = harness()
  const r = await handlePublicationStatus({ body: { token }, env, ...valid })
  assert.deepEqual(r, { status: 200, body: { state: 'published', publicUrl: 'https://example.org/research/' + id } })
  assert.ok(valid.calls.some(c => c[0] === 'eq' && c[1] === 'confirmation_token_hash' && c[2] === crypto.createHash('sha256').update(token).digest('hex')))
  assert.ok(valid.calls.some(c => c[0] === 'rpc' && c[1] === 'public_record'))
  assert.ok(!JSON.stringify(r).includes(token))
  assert.ok(!JSON.stringify(r).includes('private-id'))
  const unknown = harness({ paper: null })
  assert.equal((await handlePublicationStatus({ body: { token }, env, ...unknown })).status, 404)
  assert.equal(unknown.calls.filter(c => c[0] === 'table').length, 1)
  for (const opts of [{ paper: { id: 'p', metadata_confirmed_at: null } }, { link: null }, { record: null }]) {
    const h = harness(opts)
    assert.deepEqual((await handlePublicationStatus({ body: { token }, env, ...h })).body, { state: 'not_public', publicUrl: null })
  }
  const off = harness()
  assert.equal((await handlePublicationStatus({ body: { token }, env: {}, ...off })).body.state, 'not_public')
  assert.equal(off.calls.filter(c => c[0] === 'table').length, 1)
  for (const fail of ['papers', 'public_records', 'rpc', 'throw']) {
    assert.deepEqual(await handlePublicationStatus({ body: { token }, env, ...harness({ fail }) }), { status: 503, body: { reason: 'unavailable' } })
  }
  assert.equal((await handlePublicationStatus({ body: { token }, env, supabase: null })).status, 503)
  const relative = await handlePublicationStatus({ body: { token }, env: { PUBLIC_RESEARCH: 'enabled', PUBLIC_SITE_ORIGIN: 'javascript:bad' }, ...harness() })
  assert.equal(relative.body.publicUrl, '/research/' + id)
  // An old public identifier survives withdrawal; the fresh eligibility
  // read, not identifier existence, must prevent a link being returned.
  const withdrawn = harness({ record: null })
  assert.equal((await handlePublicationStatus({ body: { token }, env, ...withdrawn })).body.publicUrl, null)
  console.log('Publication status: credential, eligibility, outages, and response allowlist pass')
}
run().catch(e => { console.error(e); process.exitCode = 1 })
