// Minimal stand-in for Kong: routes supabase-js paths to the local services.
const http = require('http')
const routes = [['/rest/v1', 54330], ['/storage/v1', 54331]]
http.createServer((req, res) => {
  const r = routes.find(([p]) => req.url.startsWith(p + '/') || req.url === p)
  if (!r) { res.writeHead(404); return res.end('no route') }
  const up = http.request({ host: '127.0.0.1', port: r[1], path: req.url.slice(r[0].length) || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${r[1]}` } }, (u) => { res.writeHead(u.statusCode, u.headers); u.pipe(res) })
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)) })
  req.pipe(up)
}).listen(54321, '127.0.0.1')
