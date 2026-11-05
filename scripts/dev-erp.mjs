/**
 * Local ERP-mode preview: serves the app plus the real /api handler (convex/lib/api.js)
 * against an in-memory fake ERP. Nothing touches ERP UAT or Convex.
 *   npm run dev:erp   ->  http://localhost:5174   (UAT passcode: local-passcode)
 * Sign in as priya.sharma@prorackglobal.com (employee) or aarav.reddy@prorackglobal.com (Travel Admin).
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { handleApi } from '../convex/lib/api.js';
import { createErpClient } from '../convex/lib/erp.js';
import { createFakeErp, memoryStore } from './fake-erp.mjs';

const port = Number(process.env.PORT || 5174);
const env = { ERP_BASE_URL: 'https://erpuat.example.invalid', ERP_API_KEY: 'k', ERP_API_SECRET: 's', CONVEX_SITE_URL: `http://localhost:${port}`,
  UAT_LOGIN_PASSCODE: 'local-passcode', TRAVEL_ADMIN_EMAILS: 'aarav.reddy@prorackglobal.com', APP_ENVIRONMENT: 'LOCAL MOCK' };
const fake = createFakeErp();
const deps = { env, erp: createErpClient(env, fake.fetch), store: memoryStore(), fetch: fake.fetch, now: () => Date.now() };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const root = resolve('.');

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await handleApi(request, deps);
    const headers = Object.fromEntries(out.headers);
    // Browsers drop Secure cookies on plain http other than localhost; keep it as-is for localhost.
    res.writeHead(out.status, headers); res.end(Buffer.from(await out.arrayBuffer())); return;
  }
  const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { const body = await readFile(resolve(root, 'index.html')); res.writeHead(200, { 'Content-Type': types['.html'] }); res.end(body); }
}).listen(port, () => console.log(`ERP-mode preview (fake ERP) at http://localhost:${port}  ·  UAT passcode: ${env.UAT_LOGIN_PASSCODE}`));
