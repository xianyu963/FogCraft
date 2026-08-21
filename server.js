/** FogCraft 本地预览服务器（可选）：node server.js 后访问 http://localhost:8000 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8000;   // 支持 PORT 环境变量覆盖（多实例/CI 场景）
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
// 缓存策略与 Cloudflare Pages _headers 保持一致：PNG 永久缓存，JS/CSS 24h，HTML 不缓存（更新即时生效）
const CACHE = {
  '.png': 'public, max-age=31536000, immutable',
  '.js': 'public, max-age=86400',
  '.css': 'public, max-age=86400',
  '.html': 'no-cache',
  '.txt': 'no-cache',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    res.writeHead(404); res.end('404 Not Found'); return;
  }
  const headers = { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' };
  if (CACHE[path.extname(fp)]) headers['Cache-Control'] = CACHE[path.extname(fp)];
  res.writeHead(200, headers);
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log('FogCraft 预览: http://localhost:' + PORT));
