#!/usr/bin/env node
// Static server for the dashboard (no dependencies). Read-only: GET and HEAD only.
//
//   node dashboard/serve.mjs [--port 8080] [--host 127.0.0.1]
//
// The data itself comes from the API named by "apiBase" in config.json; when that is an
// absolute URL on another origin, it is added to the Content-Security-Policy connect-src.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', process.env.PORT ?? 8080));
const HOST = arg('host', process.env.HOST ?? '127.0.0.1');

function apiOrigin() {
  try {
    const { apiBase } = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
    return apiBase && /^https?:\/\//i.test(apiBase) ? new URL(apiBase).origin : '';
  } catch {
    return '';
  }
}
const API_ORIGIN = apiOrigin();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'${API_ORIGIN ? ` ${API_ORIGIN}` : ''}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', undefined, { Allow: 'GET, HEAD' });
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname === '/api/snapshot') {
    // Local stand-in for the Vercel function; needs DATABASE_URL (see .env.example).
    const { default: snapshot } = await import('../api/snapshot.js');
    return snapshot(req, res);
  }
  if (pathname === '/') pathname = '/index.html';
  const file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT + sep) || pathname.split('/').some((part) => part.startsWith('.'))) return send(res, 403, 'Forbidden');
  const type = TYPES[extname(file)];
  if (!type || file.endsWith('serve.mjs')) return send(res, 404, 'Not found');

  try {
    const body = await readFile(file);
    const cache = extname(file) === '.json' ? 'no-store' : 'no-cache';
    return send(res, 200, req.method === 'HEAD' ? undefined : body, type, { 'Cache-Control': cache });
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, 'Not found');
    console.error(err);
    return send(res, 500, 'Server error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Lake dashboard on http://${HOST}:${PORT}/${API_ORIGIN ? `  (data API: ${API_ORIGIN})` : ''}`);
});
