// static server for app/ that gzips text like GitHub Pages does (for transfer-size and load-time measurements)
// usage: node tests/perf/gzserve.js app 8770
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const dir = path.resolve(process.argv[2] || 'app'), port = +(process.argv[3] || 8770);
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const gzCache = new Map();   // compressed once per file version, like a CDN (compressing 5 MB per request would stall the other requests)
const gzipOf = (f, body) => { const k = `${f}:${fs.statSync(f).mtimeMs}`; if (!gzCache.has(k)) gzCache.set(k, zlib.gzipSync(body, { level: 6 })); return gzCache.get(k); };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dir, p); if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const ext = path.extname(f), type = T[ext] || 'application/octet-stream', body = fs.readFileSync(f);
  const gz = /text|json|javascript|svg|manifest/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=600', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
  res.end(gz ? gzipOf(f, body) : body);
}).listen(port, () => console.log('serving', dir, 'on', port));
