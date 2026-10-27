// Parses a sensor POST and stores it in `reading`. Write access is limited to INSERT on reading
// (role sensor_ingest). Stations and sensors must already exist: nothing is created here.
import { createHash, timingSafeEqual } from 'node:crypto';

const FIELDS = [
  { code: 'ph', keys: ['ph', 'phlevel'] },
  { code: 'water_temp_c', keys: ['temperature', 'temp'] },
  { code: 'tds_est_ppm', keys: ['tds', 'tds_ppm'] },
  { code: 'surface_distance_cm', keys: ['distance', 'depth'] }, // distance from sensor to water surface
];

const digest = (s) => createHash('sha256').update(String(s)).digest();
export const tokenOk = (given, expected) =>
  Boolean(expected) && typeof given === 'string' && timingSafeEqual(digest(given), digest(expected));

const toNumber = (v) => {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export function parseTelemetry(body, defaultStation) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'JSON object expected' };
  const station = String(body.station_id ?? defaultStation ?? '').trim();
  if (!station || station.length > 64) return { error: 'station_id missing or too long' };
  const values = [];
  for (const { code, keys } of FIELDS) {
    const raw = keys.map((k) => body[k]).find((v) => v !== undefined && v !== null && v !== '');
    if (raw === undefined) continue; // missing is skipped, never stored as 0
    const value = toNumber(raw);
    if (value === null) return { error: `${keys[0]} is not a number` };
    values.push({ code, value });
  }
  if (!values.length) return { error: 'No sensor values in request' };
  return { station, values };
}

export const flagFor = (code, value) => (code === 'ph' && (value < 0 || value > 14) ? 'BAD' : 'OK');

export async function storeReadings(query, station, values, measuredAt) {
  const refs = await query(
    `select st.id as station_id, se.id as sensor_id, p.id as parameter_id, p.code
       from station st
       join parameter p on p.code = any($2::text[])
       join sensor se on se.serial_number = st.name || '-' || p.code
      where st.name = $1`,
    [station, values.map((v) => v.code)],
  );
  const byCode = new Map(refs.map((r) => [r.code, r]));
  const known = values.filter((v) => byCode.has(v.code));
  const skipped = values.filter((v) => !byCode.has(v.code)).map((v) => v.code);
  if (!known.length) return { status: 'unknown', stored: 0, skipped };

  const params = [];
  const rows = known.map((v) => {
    const r = byCode.get(v.code);
    params.push(r.station_id, r.sensor_id, r.parameter_id, measuredAt, v.value, flagFor(v.code, v.value));
    const n = params.length;
    return `($${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n}::reading_flag)`;
  });
  const inserted = await query(
    `insert into reading (station_id, sensor_id, parameter_id, measured_at, value, flag)
     values ${rows.join(', ')}
     on conflict (sensor_id, parameter_id, measured_at) do nothing
     returning id`,
    params,
  );
  return { status: 'ok', stored: inserted.length, skipped };
}
