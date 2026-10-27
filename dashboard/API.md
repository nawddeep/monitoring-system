# Data API contract

The dashboard ships with no data. Everything it shows comes from one read-only endpoint, which the MySQL-backed API must provide. Point `apiBase` in `config.json` at it, for example `"/api"` (same origin) or `"http://localhost:3000/api"`.

The API should connect with a **read-only database user** (SELECT only), use parameterised queries, and keep database credentials on the server. Nothing secret goes in `config.json`, because it is served to the browser.

## `GET {apiBase}/snapshot?from=<ISO 8601>&to=<ISO 8601>`

- `200` with a JSON object containing one key per table. Rows use the column names below.
- `401` when not logged in. If `loginPath` is set in `config.json` the dashboard redirects there; otherwise it shows the error.
- If the API is on a different origin, it must send CORS headers for the dashboard origin (`Access-Control-Allow-Origin`, and `Access-Control-Allow-Credentials: true` if it uses cookies). `serve.mjs` adds that origin to the page's CSP `connect-src` automatically.

| Key | Rows to return |
|---|---|
| `controllers`, `sensors`, `vendor_spec`, `quality_flags`, `acceptance_tests`, `calibration_records`, `level_site_config` | All rows |
| `readings` | `measured_at` between `from` and `to` |
| `derived_measurements` | Rows whose source reading is in range, with an extra `measured_at` column joined from the source reading |
| `measurement_cycles` | `cycle_start` between `from` and `to` |
| `latest` | Optional: the latest reading per sensor regardless of range (feeds the Overview tiles). Without it, the Overview uses the latest reading inside the requested range. |
| `meta` | Optional, e.g. `{ "source": "mysql" }` |

A missing or `null` table is treated as empty.

The Overview requests the last 24 h. The other pages request the selected range (1 h to 90 days). The CSV export is built in the browser from the same response.

## Columns the dashboard reads

- **controllers:** `controller_id, name, role, board_model_claimed, board_model_seen, chip_verified, adc_input_max_v, clock_offset_s, clock_synced, notes`
- **sensors:** `sensor_id, controller_id, parameter, model_text, evidence_status, installed, vendor_spec_id, valid_min, valid_max, max_jump_per_cycle, stale_after_minutes, accuracy_text, notes`
  - `parameter` is one of `ph, water_temperature, tds_ec, water_level, turbidity, dissolved_oxygen`.
- **vendor_spec:** `spec_id, parameter, range_min, range_max, unit, sampling_min_minutes, sampling_max_minutes, sampling_default_min, caveat, source_ref`
- **quality_flags:** `flag_code, severity (ok|warn|bad), description`
- **calibration_records:** `calibration_id, sensor_id, version, calibrated_at, method, standards_used, slope, offset_value, conversion_factor, temp_coeff_per_c, reference_temp_c, reference_instrument, before_value, after_value, valid_until, performed_by`
- **level_site_config:** `config_id, sensor_id, valid_from, mount_height_m, dead_zone_m, datum_description`
- **readings:** `reading_id, sensor_id, controller_id, measured_at, device_time_raw, received_at, raw_value, raw_unit, corrected_value, corrected_unit, calibration_id, is_synthetic, quality_flag`, plus optional `flags` (all flags that applied)
- **derived_measurements:** `derived_id, source_reading_id, temp_reading_id, temp_age_s, kind, value, unit, method_note, quality_flag`, plus `measured_at`
  - `kind` is one of `ec_uS_cm_25c, tds_est_mg_l, water_elevation_m, level_distance_m`.
- **measurement_cycles:** `cycle_id, cycle_start, tolerance_s, ph_reading_id, temp_reading_id, tds_reading_id, level_reading_id, max_skew_s, complete`
- **acceptance_tests:** `test_id, sensor_id, test_type, performed_at, result (not_run|pass|fail|partial), evidence_uri, notes`

## MySQL output the dashboard accepts as-is

| MySQL / driver output | Handling |
|---|---|
| `DATETIME` such as `"2026-10-12 06:00:00"` (no zone) | Read as **UTC**. Store UTC in the database (or return ISO 8601 with `Z`). |
| `TINYINT(1)` booleans `0` / `1` (or `"0"` / `"1"`) | Read as false / true |
| `DECIMAL` returned as strings, e.g. `"2.050"` | Read as numbers |
| ids returned as strings (`BIGINT`) | Read as numbers so tables join |
| `flags` as a JSON array, a JSON string `'["A","B"]'`, or text `"A,B"` / `"A|B"` | Read as a list |
