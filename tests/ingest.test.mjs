import test from 'node:test';
import assert from 'node:assert/strict';
import { flagFor, parseTelemetry, storeReadings, tokenOk } from '../lib/ingest.mjs';

test('tokenOk accepts only the exact token', () => {
  assert.equal(tokenOk('abc', 'abc'), true);
  assert.equal(tokenOk('abd', 'abc'), false);
  assert.equal(tokenOk(undefined, 'abc'), false);
  assert.equal(tokenOk('x', ''), false);
});

test('parseTelemetry maps firmware keys and keeps a real 0', () => {
  assert.deepEqual(parseTelemetry({ station_id: 'S', ph: '7.1', temperature: 24.5, tds: 0, depth: 80 }, 'D'), {
    station: 'S',
    values: [
      { code: 'ph', value: 7.1 }, { code: 'water_temp_c', value: 24.5 },
      { code: 'tds_est_ppm', value: 0 }, { code: 'surface_distance_cm', value: 80 },
    ],
  });
});

test('parseTelemetry rejects bad input and skips missing values', () => {
  assert.equal(parseTelemetry({ ph: 'abc' }, 'D').error, 'ph is not a number');
  assert.equal(parseTelemetry({}, 'D').error, 'No sensor values in request');
  assert.equal(parseTelemetry([], 'D').error, 'JSON object expected');
  assert.equal(parseTelemetry({ ph: 7 }, '').error, 'station_id missing or too long');
  assert.equal(parseTelemetry({ ph: null, temp: 20 }, 'D').values.length, 1);
});

test('flagFor marks only an impossible pH as BAD', () => {
  assert.equal(flagFor('ph', 15), 'BAD');
  assert.equal(flagFor('ph', 7), 'OK');
  assert.equal(flagFor('tds_est_ppm', 9999), 'OK');
});

test('storeReadings skips unregistered sensors and reports an unknown station', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push(sql);
    if (sql.startsWith('select')) return params[0] === 'S' ? [{ station_id: 's', sensor_id: 'x', parameter_id: 1, code: 'water_temp_c' }] : [];
    return [{ id: 1 }];
  };
  const ok = await storeReadings(query, 'S', [{ code: 'ph', value: 7 }, { code: 'water_temp_c', value: 20 }], new Date());
  assert.deepEqual(ok, { status: 'ok', stored: 1, skipped: ['ph'] });
  const none = await storeReadings(query, 'NOPE', [{ code: 'ph', value: 7 }], new Date());
  assert.equal(none.status, 'unknown');
});
