import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname, normalize, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.argv[3] || 8099);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json'
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (full !== ROOT && !full.startsWith(ROOT + sep)) { res.writeHead(403).end('forbidden'); return; }
    const s = await stat(full).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end('server error');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`serving ${ROOT} on http://0.0.0.0:${PORT}`));
