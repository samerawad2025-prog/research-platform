// Minimal stand-in for Supabase's API gateway (Kong): routes supabase-js
// paths to the local services and answers CORS the way the hosted gateway
// does for browser clients (any origin, preflight answered here). Local
// tests only; the hosted gateway's behaviour is verified separately.
const http = require('http')
const routes = [['/rest/v1', 54330], ['/storage/v1', 54331]]
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-upsert, cache-control, prefer, range, accept-profile, content-profile',
  'access-control-expose-headers': 'content-range, content-length',
  'access-control-max-age': '3600',
}
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }
  const r = routes.find(([p]) => req.url.startsWith(p + '/') || req.url === p)
  if (!r) { res.writeHead(404, CORS); return res.end('no route') }
  const up = http.request({ host: '127.0.0.1', port: r[1], path: req.url.slice(r[0].length) || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${r[1]}` } }, (u) => {
    const headers = { ...u.headers }
    for (const k of Object.keys(headers)) if (k.startsWith('access-control-')) delete headers[k]
    res.writeHead(u.statusCode, { ...headers, ...CORS })
    u.pipe(res)
  })
  up.on('error', (e) => { res.writeHead(502, CORS); res.end(String(e)) })
  req.pipe(up)
}).listen(54321, '127.0.0.1')
