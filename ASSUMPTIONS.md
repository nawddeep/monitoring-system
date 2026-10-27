# Assumptions and unverified items

Source of truth: *Lake Monitoring System: Sensor Engineering Review*, 12 October 2026. Scope delivered so far: **dashboard only**, with no data bundled. Data will come from a MySQL-backed API supplied by the user (contract in `dashboard/API.md`).

## Not verified (shown as Unknown or unverified in the UI)

- Controller chip: user states ESP32, photos resemble ESP8266 NodeMCU. Stored as claimed vs seen, `chip_verified = false`.
- Probe and transducer models for pH, temperature, TDS/EC and level. `model_text` is NULL. Only the interface boards (TDS Meter V1.0, JSN-SR04T-2.0) were seen in photos.
- Accuracy, resolution and response time for every channel.
- Calibration results. No calibration records exist, so every reading is Uncalibrated.
- Controller ADC input range, schematic, firmware, and real measurement logs.
- Whether controller clocks are synchronised. Assumed not: `clock_synced = false`, so every reading carries Clock unsynced.
- Vendor ranges are product claims for a different five-sensor suite and appear only as "Vendor claim" on the registry page.

## Open questions, with the default used

| Question | Default |
|---|---|
| SQL engine and host | MySQL, behind the user's API (decided 12 Oct 2026). DATETIME values are assumed to be UTC. |
| How controllers send data | HTTP POST of JSON |
| Probe models | Unknown |
| Level datum, mount height, dead zone | None. Distance only; dead-zone check inactive. |
| Sampling interval | 10 min (vendor default), used for gap detection |
| Staff gauge or reference meter | None |
| Who may see the dashboard | Single admin login, enforced by the API (the static server `serve.mjs` has no login) |
| Display time zone | Asia/Kolkata (IST); storage and export in UTC |
| What controller B sends for TDS (V, µS/cm or firmware ppm) and whether the firmware already compensates for temperature | Unknown. The dashboard shows whatever `raw_unit` the row carries. |

## Decisions the dashboard makes

1. **All flags per reading.** The UI reads an optional `readings.flags` array and shows every flag. When it is absent, the single `quality_flag` is shown. This is the proposed schema addition still awaiting approval.
2. **Flag priority:** DISCONNECTED > ECHO_OUT_OF_RANGE > OUT_OF_RANGE > UNREALISTIC_JUMP > STALE_TEMP > NO_CAL_FOR_UNIT > CAL_EXPIRED > UNCALIBRATED > CLOCK_UNSYNCED > OK. The prompt's list did not place ECHO_OUT_OF_RANGE or NO_CAL_FOR_UNIT.
3. **Severity:** bad = DISCONNECTED, ECHO_OUT_OF_RANGE, OUT_OF_RANGE, UNREALISTIC_JUMP. Everything else is warn. Bad points are left out of lines and listed in a table; warn points stay plotted with their flags.
4. **Water level is not linked** to the vendor 0 to 20 m level claim. TDS has no vendor spec.
5. **Temperature** with no reference correction: corrected = raw, flagged Uncalibrated (per the prompt's temperature rule).
6. **Level distance** (cm ÷ 100) is a unit conversion, not a calibration. It is stored as `level_distance_m`, and the reading stays Uncalibrated until a staff-gauge record exists.
7. **Gaps** are any silence longer than 2.5 × the sampling interval (25 min by default).
8. **No bundled data.** The fake and synthetic data and the generator were removed on 12 Oct 2026. If the database ever holds rows with `is_synthetic = true`, the dashboard labels them and shows a banner.
9. **Pairing and flagging happen upstream.** Measurement cycles, calibration application and quality flags must be computed by the ingestion/API side; the dashboard only displays them.

## Not checked yet

- Immutability of raw values for the dashboard role. This needs the database. The dashboard itself has no write path.
- Schema loading, foreign keys and checks. This needs `schema.sql`.
- Accessibility beyond the built-in measures (text plus icon on every flag, table view for every chart, keyboard-reachable source buttons, dark mode). No screen-reader audit has been run.
