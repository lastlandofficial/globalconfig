import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '..');
const bundle = await build({ entryPoints: [resolve(root, 'fixtures/react.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic' });
const reactPage = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>glocon workbench</title><link rel="stylesheet" href="/styles/glocon.css"></head><body style="font-family:system-ui;margin:24px;background:#fff;color:#18181b"><div id="app"></div><script src="/react.js"></script></body></html>';
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/react.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (path === '/react') { response.setHeader('content-type', 'text/html'); response.end(reactPage); return; }
    const file = resolve(root, '.' + (path === '/' ? '/fixtures/healthy.html' : path));
    if (!['fixtures', 'styles', 'dist'].some(dir => file.startsWith(resolve(root, dir) + sep))) { response.writeHead(404).end(); return; }
    const data = await readFile(file);
    response.setHeader('content-type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' })[extname(file)] ?? 'text/plain');
    response.end(data);
  } catch { response.writeHead(404).end('Not found'); }
});
server.listen(Number(process.env.GLOCON_TEST_PORT ?? 4179), '127.0.0.1');
