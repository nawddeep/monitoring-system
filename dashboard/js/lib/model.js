// Indexes a database snapshot (same table and column names as schema.sql) for the pages.
// Pure functions only: no DOM, no fetch.

import { flagsOf, worstSeverity, makeTime } from './format.js';

export const PARAMS = {
  ph: { label: 'pH', cls: 'p-ph', short: 'pH' },
  water_temperature: { label: 'Water temperature', cls: 'p-temp', short: 'Temp' },
  tds_ec: { label: 'EC / TDS', cls: 'p-ec', short: 'EC' },
  water_level: { label: 'Water level', cls: 'p-level', short: 'Level' },
  turbidity: { label: 'Turbidity', cls: 'p-none', short: 'Turb.' },
  dissolved_oxygen: { label: 'Dissolved oxygen', cls: 'p-none', short: 'DO' },
};

/** The four installed channels, in display order. */
export const CHANNELS = ['ph', 'water_temperature', 'tds_ec', 'water_level'];

export const RANGES = [
  { key: '1h', label: '1 h', ms: 3600e3 },
  { key: '6h', label: '6 h', ms: 6 * 3600e3 },
  { key: '24h', label: '24 h', ms: 24 * 3600e3 },
  { key: '7d', label: '7 days', ms: 7 * 86400e3 },
  { key: '30d', label: '30 days', ms: 30 * 86400e3 },
  { key: '90d', label: '90 days', ms: 90 * 86400e3 },
];

export function rangeFor(key, now) {
  const r = RANGES.find((x) => x.key === key) ?? RANGES[3];
  return { key: r.key, label: r.label, from: now - r.ms, to: now };
}

export const DERIVED_KINDS = {
  ec_uS_cm_25c: { label: 'EC at reference temperature', unit: 'µS/cm' },
  tds_est_mg_l: { label: 'Estimated TDS (from conductivity)', unit: 'mg/L' },
  water_elevation_m: { label: 'Water elevation vs datum', unit: 'm' },
  level_distance_m: { label: 'Distance to water surface', unit: 'm' },
};

// MySQL DATETIME arrives without a zone ("2026-10-12 06:00:00"); timestamps are stored in UTC.
const NO_ZONE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const ts = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  return Date.parse(NO_ZONE.test(s) ? `${s.replace(' ', 'T')}Z` : s);
};
const byT = (a, b) => a._t - b._t;

const BOOLEAN_COLUMNS = ['installed', 'complete', 'is_synthetic', 'chip_verified', 'clock_synced'];
const toBool = (v) => (typeof v === 'string' ? ['1', 'true', 't', 'yes'].includes(v.trim().toLowerCase()) : Boolean(v));

/** MySQL has no array type: flags may arrive as a JSON array string or "A,B" / "A|B". */
function parseFlags(v) {
  if (Array.isArray(v) || v == null) return v;
  const s = String(v).trim();
  if (!s) return null;
  if (s.startsWith('[')) {
    try { return JSON.parse(s); } catch { /* fall through */ }
  }
  return s.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
}

/** Coerces driver output: *_id columns to numbers, 0/1 to booleans, flags to arrays. */
function coerceRow(row) {
  for (const key of Object.keys(row)) {
    if ((key.endsWith('_id') || key === 'version') && row[key] != null && row[key] !== '' && Number.isFinite(Number(row[key]))) row[key] = Number(row[key]);
  }
  for (const key of BOOLEAN_COLUMNS) if (key in row && row[key] != null) row[key] = toBool(row[key]);
  if ('flags' in row) row.flags = parseFlags(row.flags);
  return row;
}

const TABLES = ['controllers', 'vendor_spec', 'sensors', 'quality_flags', 'acceptance_tests', 'calibration_records',
  'level_site_config', 'readings', 'derived_measurements', 'measurement_cycles'];

function groupSorted(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  for (const list of map.values()) list.sort(byT);
  return map;
}

/** Adds parsed millisecond timestamps (_t etc.). Idempotent. */
export function normalise(snap) {
  const s = {
    meta: {}, controllers: [], vendor_spec: [], sensors: [], quality_flags: [], acceptance_tests: [],
    calibration_records: [], level_site_config: [], readings: [], derived_measurements: [],
    measurement_cycles: [], ...snap,
  };
  if (s._normalised) return s;
  for (const t of TABLES) {
    if (!Array.isArray(s[t])) s[t] = [];
    s[t].forEach(coerceRow);
  }
  if (Array.isArray(s.latest)) s.latest.forEach(coerceRow);
  for (const r of s.readings) {
    r._t = ts(r.measured_at);
    r._recv = ts(r.received_at);
    r._dev = ts(r.device_time_raw);
  }
  for (const c of s.calibration_records) {
    c._t = ts(c.calibrated_at);
    c._until = ts(c.valid_until);
  }
  for (const l of s.level_site_config) l._t = ts(l.valid_from);
  for (const m of s.measurement_cycles) m._t = ts(m.cycle_start);
  for (const t of s.acceptance_tests) t._t = ts(t.performed_at);
  const readingTime = new Map(s.readings.map((r) => [r.reading_id, r._t]));
  for (const d of s.derived_measurements) d._t = ts(d.measured_at) ?? readingTime.get(d.source_reading_id) ?? null;
  if (Array.isArray(s.latest)) for (const r of s.latest) { r._t = ts(r.measured_at); r._recv = ts(r.received_at); }
  s._normalised = true;
  return s;
}

export function buildModel(snapshot, config, { now = Date.now(), rangeKey } = {}) {
  const snap = normalise(snapshot);
  const cfg = { samplingMinutes: 10, gapFactor: 2.5, timezone: 'Asia/Kolkata', timezoneLabel: 'IST', ...config };
  const range = rangeFor(rangeKey ?? cfg.defaultRange ?? '7d', now);

  const sevMap = Object.fromEntries(snap.quality_flags.map((f) => [f.flag_code, f.severity]));
  const descMap = Object.fromEntries(snap.quality_flags.map((f) => [f.flag_code, f.description]));
  const controllerById = new Map(snap.controllers.map((c) => [c.controller_id, c]));
  const sensorById = new Map(snap.sensors.map((x) => [x.sensor_id, x]));
  const specById = new Map(snap.vendor_spec.map((x) => [x.spec_id, x]));
  const readingById = new Map(snap.readings.map((r) => [r.reading_id, r]));
  const derivedById = new Map(snap.derived_measurements.map((d) => [d.derived_id, d]));
  const calById = new Map(snap.calibration_records.map((c) => [c.calibration_id, c]));
  const cycleById = new Map(snap.measurement_cycles.map((c) => [c.cycle_id, c]));
  const levelById = new Map(snap.level_site_config.map((c) => [c.config_id, c]));
  const readingsBySensor = groupSorted(snap.readings, 'sensor_id');
  const derivedByKind = groupSorted(snap.derived_measurements.filter((d) => d._t != null), 'kind');
  const calsBySensor = groupSorted(snap.calibration_records, 'sensor_id');
  const levelBySensor = groupSorted(snap.level_site_config, 'sensor_id');
  const cycles = [...snap.measurement_cycles].sort(byT);

  const derivedBySource = new Map();
  for (const d of snap.derived_measurements) {
    if (!derivedBySource.has(d.source_reading_id)) derivedBySource.set(d.source_reading_id, []);
    derivedBySource.get(d.source_reading_id).push(d);
  }

  const latestBySensor = new Map();
  if (Array.isArray(snap.latest)) {
    for (const r of snap.latest) latestBySensor.set(r.sensor_id, r);
  } else {
    for (const [id, list] of readingsBySensor) latestBySensor.set(id, list[list.length - 1]);
  }

  const sensorFor = (param) => snap.sensors.find((x) => x.parameter === param && x.installed)
    ?? snap.sensors.find((x) => x.parameter === param) ?? null;

  const synthetic = Boolean(snap.meta?.is_synthetic) || snap.readings.some((r) => r.is_synthetic)
    || [...latestBySensor.values()].some((r) => r?.is_synthetic);

  const m = {
    snap, cfg, now, range,
    time: makeTime(cfg.timezone, cfg.timezoneLabel),
    gapMs: cfg.samplingMinutes * 60e3 * cfg.gapFactor,
    sevMap, descMap, synthetic,
    controllerById, sensorById, specById, readingById, derivedById, calById, cycleById, levelById,
    readingsBySensor, derivedByKind, derivedBySource, calsBySensor, levelBySensor, cycles, latestBySensor,
    sensorFor,

    flags: (row) => flagsOf(row),
    severity: (row) => worstSeverity(flagsOf(row), sevMap),
    controllerOf: (sensor) => (sensor ? controllerById.get(sensor.controller_id) ?? null : null),

    readings(sensorId, from = range.from, to = range.to) {
      return (readingsBySensor.get(sensorId) ?? []).filter((r) => r._t >= from && r._t <= to);
    },
    derived(kind, from = range.from, to = range.to) {
      return (derivedByKind.get(kind) ?? []).filter((d) => d._t >= from && d._t <= to);
    },
    cyclesIn(from = range.from, to = range.to) {
      return cycles.filter((c) => c._t >= from && c._t <= to);
    },
    latestDerived(sourceReading, kind) {
      if (!sourceReading) return null;
      return (derivedBySource.get(sourceReading.reading_id) ?? []).find((d) => d.kind === kind) ?? null;
    },

    /** Latest calibration at time t, with its validity status. */
    calibrationAt(sensorId, t = now) {
      const list = (calsBySensor.get(sensorId) ?? []).filter((c) => c._t <= t);
      if (!list.length) return { status: 'none', record: null };
      const latest = list.reduce((a, b) => (b._t > a._t || (b._t === a._t && b.version > a.version) ? b : a));
      if (latest._until != null && latest._until < t) return { status: 'expired', record: latest };
      return { status: latest._until == null ? 'no_expiry' : 'valid', record: latest };
    },
    levelConfigAt(sensorId, t = now) {
      const list = (levelBySensor.get(sensorId) ?? []).filter((c) => c._t <= t);
      return list.length ? list[list.length - 1] : null;
    },

    /** The value a reading should be shown with: corrected when present, else raw. */
    display(reading) {
      if (!reading) return null;
      if (reading.corrected_value != null) {
        return { value: Number(reading.corrected_value), unit: reading.corrected_unit, kind: 'corrected' };
      }
      return { value: reading.raw_value == null ? null : Number(reading.raw_value), unit: reading.raw_unit, kind: 'raw' };
    },

    isStale(sensor, reading) {
      if (!reading) return true;
      return now - reading._t > (sensor?.stale_after_minutes ?? 30) * 60e3;
    },
  };
  return m;
}

/** Turns reading rows into chart points. pick(r) returns the numeric value or null. */
export function toPoints(m, rows, pick, refPrefix = 'r', idKey = 'reading_id') {
  return rows.map((r) => {
    const v = pick(r);
    return {
      t: r._t,
      v: v == null || v === '' ? null : Number(v),
      flags: m.flags(r),
      sev: m.severity(r),
      ref: `${refPrefix}:${r[idKey]}`,
    };
  });
}

/** Gaps longer than gapMs between consecutive timestamps, including leading/trailing silence. */
export function findGaps(times, from, to, gapMs) {
  const gaps = [];
  let prev = from;
  for (const t of times) {
    if (t - prev > gapMs) gaps.push({ start: prev, end: t, leading: prev === from });
    prev = t;
  }
  if (to - prev > gapMs) gaps.push({ start: prev, end: to, trailing: true });
  return gaps;
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
