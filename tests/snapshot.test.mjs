import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, parseRange } from '../lib/snapshot.mjs';

test('parseRange rejects bad, reversed and over-90-day ranges', () => {
  assert.ok(parseRange('nope', null).error);
  assert.ok(parseRange('2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z').error);
  assert.ok(parseRange('2026-01-01T00:00:00Z', '2026-10-01T00:00:00Z').error);
  const ok = parseRange('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z');
  assert.equal(ok.to - ok.from, 24 * 3600 * 1000);
});

test('buildSnapshot maps rows to the dashboard contract and leaves unknowns null', async () => {
  const at = new Date('2026-10-26T10:00:00Z');
  const rows = (sql) => {
    if (sql.includes('from station')) return [{ id: 'st-1', name: 'FS_LAKE_STATION_01' }];
    if (sql.includes('from sensor s')) return [{ id: 'se-1', serial_number: 'FS_LAKE_STATION_01-ph', model: null, notes: 'n', station_id: 'st-1', removed_at: null }];
    if (sql.includes('from calibration')) return [];
    return [{ id: '7', sensor_id: 'se-1', station_id: 'st-1', measured_at: at, received_at: at, value: 7.2, flag: 'OK', unit: 'pH' }];
  };
  const snap = await buildSnapshot(async (sql) => rows(sql), at, at);
  assert.equal(snap.sensors[0].parameter, 'ph');
  assert.equal(snap.sensors[0].installed, 1);
  assert.equal(snap.sensors[0].model_text, null);
  assert.deepEqual(snap.readings[0], {
    reading_id: 7, sensor_id: 1, controller_id: 1, measured_at: '2026-10-26T10:00:00.000Z', device_time_raw: null,
    received_at: '2026-10-26T10:00:00.000Z', raw_value: 7.2, raw_unit: 'pH', corrected_value: null, corrected_unit: null,
    calibration_id: null, is_synthetic: 0, quality_flag: 'OK',
  });
  assert.equal(snap.latest.length, 1);
  assert.deepEqual(snap.derived_measurements, []);
});

test('unrecognised serial suffix gives parameter null, not a guess', async () => {
  const snap = await buildSnapshot(async (sql) => (sql.includes('from sensor s') ? [{ id: 'x', serial_number: 'ABC-123', station_id: null }] : []), new Date(0), new Date(1));
  assert.equal(snap.sensors[0].parameter, null);
  assert.equal(snap.sensors[0].installed, 0);
});
