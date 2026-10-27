// Vercel function: GET /api/snapshot?from=&to=  (also mounted by dashboard/serve.mjs for local use).
// DATABASE_URL must be a SELECT-only role. Credentials stay on the server.
import pg from 'pg';
import { buildSnapshot, parseRange } from '../lib/snapshot.mjs';

let pool;
const getPool = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000 }));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  if (!process.env.DATABASE_URL) return send(res, 503, { error: 'DATABASE_URL is not configured' });
  const url = new URL(req.url, 'http://localhost');
  const range = parseRange(url.searchParams.get('from'), url.searchParams.get('to'));
  if (range.error) return send(res, 400, { error: range.error });
  try {
    const db = getPool();
    send(res, 200, await buildSnapshot(async (sql, params) => (await db.query(sql, params)).rows, range.from, range.to));
  } catch (err) {
    console.error('snapshot failed:', err.message);
    send(res, 502, { error: 'database unavailable' });
  }
}
