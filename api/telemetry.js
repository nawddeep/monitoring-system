// Vercel function: POST /api/telemetry  (header X-Ingest-Token, JSON body from the ESP board).
// INGEST_DATABASE_URL must be the sensor_ingest role (db/neon-ingest-role.sql), never the owner.
import pg from 'pg';
import { parseTelemetry, storeReadings, tokenOk } from '../lib/ingest.mjs';

const MAX_BODY = 2048;
let pool;
const getPool = () => (pool ??= new pg.Pool({ connectionString: process.env.INGEST_DATABASE_URL, max: 2, idleTimeoutMillis: 10000 }));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
    return req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { status: 'error', message: 'POST only' });
  if (!process.env.INGEST_TOKEN || !process.env.INGEST_DATABASE_URL) {
    return send(res, 503, { status: 'error', message: 'ingest is not configured on the server' });
  }
  if (!tokenOk(req.headers['x-ingest-token'], process.env.INGEST_TOKEN)) {
    return send(res, 401, { status: 'error', message: 'Invalid ingest token' });
  }

  let parsed;
  try {
    parsed = parseTelemetry(await readJson(req), process.env.STATION_NAME || 'FS_LAKE_STATION_01');
  } catch (err) {
    return send(res, err.code === 'TOO_LARGE' ? 413 : 400, { status: 'error', message: err.code === 'TOO_LARGE' ? 'Body too large' : 'Body is not valid JSON' });
  }
  if (parsed.error) return send(res, 400, { status: 'error', message: parsed.error });

  const measuredAt = new Date();
  try {
    const db = getPool();
    const result = await storeReadings(async (sql, params) => (await db.query(sql, params)).rows, parsed.station, parsed.values, measuredAt);
    if (result.status === 'unknown') {
      return send(res, 404, { status: 'error', message: `Station '${parsed.station}' or its sensors are not registered`, skipped: result.skipped });
    }
    return send(res, 201, { status: 'success', station: parsed.station, measured_at_utc: measuredAt.toISOString(), stored: result.stored, skipped: result.skipped });
  } catch (err) {
    console.error('ingest failed:', err.message);
    return send(res, 502, { status: 'error', message: 'database unavailable' });
  }
}
