// Builds the dashboard snapshot (see dashboard/API.md) from the app's PostgreSQL schema.
// `query(sql, params)` must return rows. Only SELECTs are issued. Unknown values stay null.

const PARAMETER_BY_CODE = {
  ph: 'ph',
  water_temp_c: 'water_temperature',
  tds_est_ppm: 'tds_ec',
  surface_distance_cm: 'water_level',
};
const MAX_RANGE_MS = 90 * 24 * 3600 * 1000;
const MAX_READINGS = 100000;

const QUALITY_FLAGS = [
  { flag_code: 'OK', severity: 'ok', description: 'No check failed.' },
  { flag_code: 'SUSPECT', severity: 'warn', description: 'Value is questionable (for example an exact 0.0 from an old endpoint).' },
  { flag_code: 'BAD', severity: 'bad', description: 'Value is outside what the sensor can physically report.' },
];

export function parseRange(fromRaw, toRaw, now = new Date()) {
  const to = toRaw ? new Date(toRaw) : now;
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 24 * 3600 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: 'from and to must be ISO 8601 timestamps' };
  if (from >= to) return { error: 'from must be before to' };
  if (to - from > MAX_RANGE_MS) return { error: 'range is limited to 90 days' };
  return { from, to };
}

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
const parameterOf = (serial) => PARAMETER_BY_CODE[String(serial).split('-').pop()] ?? null;

export async function buildSnapshot(query, from, to) {
  const [stations, sensorRows, calibrations, readings, latest] = await Promise.all([
    query('select id, name from station order by name'),
    query(
      `select s.id, s.serial_number, s.model, s.notes, si.station_id, si.removed_at
         from sensor s
         left join lateral (select station_id, removed_at from sensor_installation
                             where sensor_id = s.id order by installed_at desc limit 1) si on true
        order by s.serial_number`,
    ),
    query(
      `select id, sensor_id, performed_at, performed_by_id, reference_value, sensor_before, sensor_after,
              "offset" as offset_value, slope, notes
         from calibration order by performed_at`,
    ),
    query(
      `select r.id, r.sensor_id, r.station_id, r.measured_at, r.received_at, r.value, r.flag, p.unit
         from reading r join parameter p on p.id = r.parameter_id
        where r.measured_at >= $1 and r.measured_at <= $2
        order by r.measured_at limit ${MAX_READINGS}`,
      [from, to],
    ),
    query(
      `select distinct on (r.sensor_id) r.id, r.sensor_id, r.station_id, r.measured_at, r.received_at, r.value, r.flag, p.unit
         from reading r join parameter p on p.id = r.parameter_id
        order by r.sensor_id, r.measured_at desc`,
    ),
  ]);

  const controllerId = new Map(stations.map((s, i) => [s.id, i + 1]));
  const sensorId = new Map(sensorRows.map((s, i) => [s.id, i + 1]));

  const toReading = (r) => ({
    reading_id: Number(r.id),
    sensor_id: sensorId.get(r.sensor_id) ?? null,
    controller_id: controllerId.get(r.station_id) ?? null,
    measured_at: iso(r.measured_at),
    device_time_raw: null,
    received_at: iso(r.received_at),
    raw_value: r.value,
    raw_unit: r.unit,
    corrected_value: null,
    corrected_unit: null,
    calibration_id: null,
    is_synthetic: 0,
    quality_flag: r.flag,
  });

  return {
    meta: { source: 'postgres', range: { from: from.toISOString(), to: to.toISOString() }, readings_truncated: readings.length >= MAX_READINGS },
    controllers: stations.map((s) => ({
      controller_id: controllerId.get(s.id), name: s.name, role: 'Station', board_model_claimed: null, board_model_seen: null,
      chip_verified: 0, adc_input_max_v: null, clock_offset_s: null, clock_synced: 0, notes: null,
    })),
    sensors: sensorRows.map((s) => ({
      sensor_id: sensorId.get(s.id), controller_id: controllerId.get(s.station_id) ?? null, parameter: parameterOf(s.serial_number),
      model_text: s.model, evidence_status: 'user_reported', installed: s.station_id && !s.removed_at ? 1 : 0, vendor_spec_id: null,
      valid_min: null, valid_max: null, max_jump_per_cycle: null, stale_after_minutes: null, accuracy_text: null, notes: s.notes,
    })),
    quality_flags: QUALITY_FLAGS,
    calibration_records: calibrations.map((c, i) => ({
      calibration_id: i + 1, sensor_id: sensorId.get(c.sensor_id) ?? null, version: i + 1, calibrated_at: iso(c.performed_at),
      method: null, standards_used: c.reference_value == null ? null : String(c.reference_value), slope: c.slope, offset_value: c.offset_value,
      conversion_factor: null, temp_coeff_per_c: null, reference_temp_c: null, reference_instrument: null,
      before_value: c.sensor_before, after_value: c.sensor_after, valid_until: null, performed_by: c.performed_by_id,
    })),
    readings: readings.map(toReading),
    latest: latest.map(toReading),
    vendor_spec: [], acceptance_tests: [], level_site_config: [], derived_measurements: [], measurement_cycles: [],
  };
}
