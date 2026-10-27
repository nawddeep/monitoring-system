// Dashboard acceptance tests. Run with: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildModel } from '../dashboard/js/lib/model.js';
import { timeChart, resetCharts } from '../dashboard/js/lib/chart.js';
import { makeTime } from '../dashboard/js/lib/format.js';
import { sourceHtml } from '../dashboard/js/lib/source.js';
import * as overview from '../dashboard/js/pages/overview.js';
import * as trends from '../dashboard/js/pages/trends.js';
import * as chemistry from '../dashboard/js/pages/chemistry.js';
import * as level from '../dashboard/js/pages/level.js';
import * as calibration from '../dashboard/js/pages/calibration.js';
import * as quality from '../dashboard/js/pages/quality.js';
import * as registry from '../dashboard/js/pages/registry.js';
import * as exportPage from '../dashboard/js/pages/export.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'dashboard/config.json'), 'utf8'));
// Test input only: the registry rows planned for seed.sql. The dashboard itself ships no data.
const SEED = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/seed.json'), 'utf8'));
const PAGES = { overview, trends, chemistry, level, calibration, quality, registry, export: exportPage };
const UI = { width: 800, showBad: false };
const NOW = Date.parse('2026-10-12T06:00:00Z');

const fresh = () => structuredClone(SEED);
const model = (snap, rangeKey = '7d') => buildModel(snap, CONFIG, { now: NOW, rangeKey });
const iso = (ms) => new Date(ms).toISOString();

function reading(id, sensorId, controllerId, t, raw, rawUnit, extra = {}) {
  return {
    reading_id: id, sensor_id: sensorId, controller_id: controllerId, measured_at: iso(t), device_time_raw: iso(t),
    received_at: iso(t + 2000), raw_value: raw, raw_unit: rawUnit, corrected_value: null, corrected_unit: null,
    calibration_id: null, is_synthetic: false, quality_flag: 'UNCALIBRATED', flags: ['UNCALIBRATED', 'CLOCK_UNSYNCED'], ...extra,
  };
}

describe('empty database', () => {
  for (const [name, page] of Object.entries(PAGES)) {
    test(`${name} renders an empty state without throwing`, () => {
      const html = page.render(model(fresh()), UI);
      assert.ok(html.length > 200);
      assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
    });
  }

  test('pages say why they are empty', () => {
    const m = model(fresh());
    assert.match(overview.render(m, UI), /No readings received yet/);
    assert.match(level.render(m, UI), /No datum configured: distance only/);
    assert.match(calibration.render(m, UI), /Never calibrated/);
    assert.match(calibration.render(m, UI), /0 of 32 tests run/);
    assert.match(exportPage.render(m, UI), /only the header row/);
    assert.match(trends.render(m, UI), /No pH readings/);
  });

  test('export of an empty database is a header row with is_synthetic', () => {
    const csv = exportPage.buildCsv(model(fresh()), [1, 2, 3, 4]);
    assert.equal(csv.trim(), exportPage.CSV_COLUMNS.join(','));
    assert.ok(exportPage.CSV_COLUMNS.includes('is_synthetic'));
    assert.ok(exportPage.CSV_COLUMNS.includes('calibration_version'));
  });
});

describe('guardrails', () => {
  test('overview carries the scope sentence', () => {
    assert.match(overview.render(model(fresh()), UI), /Four-sensor prototype\. Not a comprehensive ecological or drinking-water assessment\./);
  });

  test('UI source contains none of the banned phrases', () => {
    const banned = ['lake health', 'safe to drink', 'water quality index'];
    const files = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (['.html', '.js', '.css', '.json', '.mjs'].includes(extname(p))) files.push(p);
      }
    };
    walk(join(ROOT, 'dashboard'));
    for (const f of files) {
      const text = readFileSync(f, 'utf8').toLowerCase();
      for (const phrase of banned) assert.ok(!text.includes(phrase), `${f} contains "${phrase}"`);
    }
  });

  test('seed carries no invented models, accuracy, limits or calibrations', () => {
    for (const s of SEED.sensors) {
      assert.equal(s.model_text, null);
      assert.equal(s.accuracy_text, null);
      assert.equal(s.valid_min, null);
      assert.equal(s.valid_max, null);
      assert.notEqual(s.evidence_status, 'verified');
    }
    assert.equal(SEED.calibration_records.length, 0);
    assert.equal(SEED.readings.length, 0);
    assert.ok(SEED.controllers.every((c) => c.chip_verified === false));
    assert.ok(!SEED.vendor_spec.some((v) => v.parameter === 'tds'));
  });

  test('TDS is labelled as an estimate with its factor shown', () => {
    const html = chemistry.render(model(fresh()), UI);
    assert.match(html, /Estimated TDS \(from conductivity\)/);
    assert.match(html, /Conversion factor/);
    assert.match(html, /not a contaminant test/);
  });

  test('registry shows vendor claims, not-installed sensors and unmeasured parameters', () => {
    const html = registry.render(model(fresh()), UI);
    assert.equal((html.match(/Not installed<\/span>/g) ?? []).length, 2);
    assert.match(html, /Vendor claim/);
    assert.match(html, /not the JSN-SR04T range/);
    for (const p of registry.NOT_MEASURED) assert.ok(html.includes(p), p);
    assert.match(html, /BOD and E\. coli need laboratory methods/);
    assert.match(html, /Limits not set/);
  });
});

describe('uncertainty is shown next to the number', () => {
  test('uncalibrated pH shows the raw value, no pH and the Uncalibrated flag', () => {
    const snap = fresh();
    snap.readings.push(reading(1, 1, 1, NOW - 60e3, 2.05, 'V'));
    const html = overview.render(model(snap), UI);
    const tile = html.slice(html.indexOf('<h2>pH</h2>'), html.indexOf('<h2>Water temperature</h2>'));
    assert.match(tile, /2\.050/);
    assert.match(tile, /raw electrode output, not pH/);
    assert.match(tile, /Not available: no valid calibration/);
    assert.match(tile, /Uncalibrated/);
    assert.match(tile, /Clock unsynced/);
  });

  test('EC with a stale temperature shows STALE_TEMP and no compensated value', () => {
    const snap = fresh();
    snap.readings.push(reading(1, 2, 1, NOW - 2 * 3600e3, 26.1, '°C', { corrected_value: 26.1, corrected_unit: '°C' }));
    snap.readings.push(reading(2, 3, 2, NOW - 60e3, 410, 'uS/cm', { quality_flag: 'STALE_TEMP', flags: ['STALE_TEMP', 'UNCALIBRATED', 'CLOCK_UNSYNCED'] }));
    snap.derived_measurements.push({
      derived_id: 1, source_reading_id: 2, temp_reading_id: 1, temp_age_s: 7140, kind: 'ec_uS_cm_25c', value: null,
      unit: 'µS/cm', method_note: 'Temperature older than 30 min; not compensated.', quality_flag: 'STALE_TEMP',
    });
    const m = model(snap);
    const html = overview.render(m, UI);
    const tile = html.slice(html.indexOf('<h2>EC / TDS</h2>'), html.indexOf('<h2>Water level</h2>'));
    assert.match(tile, /Stale temperature/);
    assert.match(tile, /Not compensated/);
    const chem = chemistry.render(m, UI);
    assert.match(chem, /Not compensated/);
    assert.match(chem, /1 h 59 min/);
  });

  test('level inside the dead zone is flagged; no elevation without a datum', () => {
    const snap = fresh();
    snap.readings.push(reading(1, 4, 2, NOW - 60e3, 15, 'cm', { quality_flag: 'ECHO_OUT_OF_RANGE', flags: ['ECHO_OUT_OF_RANGE', 'UNCALIBRATED'] }));
    snap.derived_measurements.push({ derived_id: 1, source_reading_id: 1, kind: 'level_distance_m', value: 0.15, unit: 'm', method_note: 'cm / 100', quality_flag: 'ECHO_OUT_OF_RANGE' });
    const m = model(snap);
    const ov = overview.render(m, UI);
    assert.match(ov, /flag-bad[^]*Echo out of range/);
    assert.match(ov, /No datum configured: distance only/);
    assert.match(ov, /flagged bad: Echo out of range/);
    const lv = level.render(m, UI);
    assert.match(lv, /Readings flagged Echo out of range in this range: 1/);
    assert.match(lv, /No datum configured: distance only/);
  });

  test('stale channel is called out in the overview banner', () => {
    const snap = fresh();
    snap.readings.push(reading(1, 1, 1, NOW - 3 * 3600e3, 2.05, 'V'));
    assert.match(overview.render(model(snap), UI), /stale: last reading 3 h ago/);
  });
});

describe('charts', () => {
  const time = makeTime('Asia/Kolkata', 'IST');
  const base = { from: NOW - 6 * 3600e3, to: NOW, time, gapMs: 25 * 60e3, title: 'Test', unit: 'pH', width: 800 };
  const pt = (i, v, sev = 'warn', flags = ['UNCALIBRATED']) => ({ t: base.from + i * 600e3, v, sev, flags, ref: `r:${i}` });

  test('bad-severity points are excluded from the line and listed in a table', () => {
    resetCharts();
    const points = [pt(1, 7), pt(2, 7.1), pt(3, 99, 'bad', ['OUT_OF_RANGE']), pt(4, 7.2)];
    const html = timeChart({ ...base, series: [{ label: 'pH', cls: 'p-ph', points }] });
    const d = html.match(/<path class="ln p-ph" d="([^"]+)"/)[1];
    assert.equal((d.match(/[ML]/g) ?? []).length, 3);
    assert.match(html, /1 bad-severity point excluded from the line/);
    assert.match(html, /Out of range/);
  });

  test('gaps longer than the gap threshold break the line', () => {
    resetCharts();
    const points = [pt(1, 7), pt(2, 7.1), pt(8, 7.2), pt(9, 7.3)];
    const html = timeChart({ ...base, series: [{ label: 'pH', cls: 'p-ph', points }] });
    const d = html.match(/<path class="ln p-ph" d="([^"]+)"/)[1];
    assert.equal((d.match(/M/g) ?? []).length, 2);
    assert.match(html, /class="gap"/);
  });

  test('every chart names its unit and time zone', () => {
    resetCharts();
    const html = timeChart({ ...base, series: [{ label: 'pH', cls: 'p-ph', points: [pt(1, 7), pt(2, 7.1)] }] });
    assert.match(html, /pH · time in IST/);
    assert.match(html, /class="axis-unit"[^>]*>pH</);
  });
});

describe('rows as a MySQL API returns them', () => {
  // DATETIME without zone, TINYINT booleans, DECIMAL/ids as strings, flags as text.
  function mysqlSnapshot() {
    const snap = fresh();
    snap.sensors = snap.sensors.map((s) => ({ ...s, sensor_id: String(s.sensor_id), installed: s.installed ? 1 : 0 }));
    snap.controllers = snap.controllers.map((c) => ({ ...c, chip_verified: 0, clock_synced: '0' }));
    snap.readings = [
      { ...reading(1, 1, 1, NOW - 60e3, 2.05, 'V'), sensor_id: '1', reading_id: '1', raw_value: '2.050', measured_at: '2026-10-12 05:59:00', is_synthetic: 0, flags: 'UNCALIBRATED,CLOCK_UNSYNCED' },
      { ...reading(2, 2, 1, NOW - 60e3, 26.4, '°C'), measured_at: '2026-10-12 05:59:00', is_synthetic: '0', flags: '["UNCALIBRATED"]' },
    ];
    return snap;
  }

  test('zone-less DATETIME is read as UTC', () => {
    const m = model(mysqlSnapshot());
    assert.equal(m.readingById.get(1)._t, Date.parse('2026-10-12T05:59:00Z'));
  });

  test('string ids join, 0/1 booleans and text flags are understood', () => {
    const m = model(mysqlSnapshot());
    assert.equal(m.latestBySensor.get(1).reading_id, 1);
    assert.equal(m.sensorById.get(5).installed, false);
    assert.equal(m.synthetic, false);
    assert.deepEqual(m.flags(m.readingById.get(1)), ['UNCALIBRATED', 'CLOCK_UNSYNCED']);
    assert.deepEqual(m.flags(m.readingById.get(2)), ['UNCALIBRATED']);
    const html = overview.render(m, UI);
    assert.match(html, /2\.050/);
    assert.match(html, /measured 1 min ago/);
    assert.equal((registry.render(m, UI).match(/Not installed<\/span>/g) ?? []).length, 2);
  });

  test('a missing table is treated as empty', () => {
    const snap = mysqlSnapshot();
    delete snap.measurement_cycles;
    snap.derived_measurements = null;
    for (const page of Object.values(PAGES)) assert.doesNotThrow(() => page.render(model(snap), UI));
  });
});

describe('source rows and export', () => {
  const snap = fresh();
  snap.readings.push(reading(1, 1, 1, NOW - 60e3, 2.05, 'V', { is_synthetic: true }));

  test('source rows reveal reading id, sensor, timestamp and calibration version', () => {
    const src = sourceHtml(model(snap), 'r:1');
    assert.match(src.title, /readings #1/);
    assert.match(src.html, /reading_id/);
    assert.match(src.html, /Calibration version/);
    assert.match(src.html, /None \(no calibration applied\)/);
    assert.match(src.html, /is_synthetic = true/);
  });

  test('export carries raw, corrected, flags and is_synthetic', () => {
    const lines = exportPage.buildCsv(model(snap), [1, 2, 3, 4]).trim().split('\r\n');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^1,1,ph,A,.*,2\.05,V,,,,,UNCALIBRATED,UNCALIBRATED\|CLOCK_UNSYNCED,true$/);
  });
});
