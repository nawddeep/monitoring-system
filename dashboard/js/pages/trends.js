import { esc, unitLabel, emptyState } from '../lib/format.js';
import { CHANNELS, PARAMS, toPoints } from '../lib/model.js';
import { timeChart } from '../lib/chart.js';

export const title = 'Trends';
export const usesRange = true;

function latestUnit(rows, key) {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key]) return rows[i][key];
  return null;
}

function uncorrectedReason(m, sensor) {
  const cal = m.calibrationAt(sensor.sensor_id);
  if (cal.status === 'none') return 'No calibration record is stored for this sensor, so corrected values are NULL and readings carry the Uncalibrated flag.';
  if (cal.status === 'expired') return `Calibration v${esc(cal.record.version)} expired on ${esc(m.time.dateTime(cal.record._until))}.`;
  return 'No corrected values were produced for readings in this range.';
}

export function channelCharts(m, ui, param) {
  const P = PARAMS[param];
  const sensor = m.sensorFor(param);
  if (!sensor) return emptyState(`No ${P.label} sensor registered`);
  const { from, to } = m.range;
  const rows = m.readings(sensor.sensor_id);
  const markers = (m.calsBySensor.get(sensor.sensor_id) ?? []).map((c) => ({ t: c._t, label: `Cal v${c.version}` }));
  const common = { from, to, time: m.time, gapMs: m.gapMs, sevMap: m.sevMap, descMap: m.descMap, width: ui.width, showBad: ui.showBad, markers };

  if (!rows.length) {
    return timeChart({ ...common, title: P.label, unit: '', series: [], emptyText: `No ${P.label} readings in the last ${m.range.label}.` });
  }

  const rawUnit = latestUnit(rows, 'raw_unit');
  const corrUnit = latestUnit(rows, 'corrected_unit');
  const rawRows = rows.filter((r) => r.raw_unit === rawUnit);
  const mixed = rawRows.length !== rows.length
    ? `<p class="chart-note">Raw unit changed in this range; showing ${esc(unitLabel(rawUnit))} rows only. ${rows.length - rawRows.length} rows in other units are in Export.</p>` : '';
  const raw = { label: `Raw (${unitLabel(rawUnit)})`, cls: P.cls, secondary: true, unit: rawUnit, points: toPoints(m, rawRows, (r) => r.raw_value) };
  const corrRows = rows.filter((r) => r.corrected_value != null && r.corrected_unit === corrUnit);
  const corrected = { label: `Corrected (${unitLabel(corrUnit)})`, cls: P.cls, unit: corrUnit, points: toPoints(m, corrRows, (r) => r.corrected_value) };

  if (corrRows.length && unitLabel(corrUnit) === unitLabel(rawUnit)) {
    const same = corrRows.every((r) => r.calibration_id == null && Number(r.corrected_value) === Number(r.raw_value));
    const note = same ? 'Corrected equals raw here: no reference correction is stored, so the two lines overlap.' : '';
    return mixed + timeChart({ ...common, title: P.label, unit: corrUnit, series: [corrected, raw], note });
  }

  const correctedChart = corrRows.length
    ? timeChart({ ...common, title: `${P.label}, corrected`, unit: corrUnit, series: [{ ...corrected, label: 'Corrected' }] })
    : timeChart({ ...common, title: `${P.label}, corrected`, unit: '', series: [], emptyText: 'No corrected values in this range', emptyBody: uncorrectedReason(m, sensor) });
  const rawChart = timeChart({ ...common, title: `${P.label}, raw sensor output`, unit: rawUnit, series: [{ ...raw, secondary: false, label: 'Raw' }] });
  return mixed + correctedChart + rawChart;
}

export function render(m, ui) {
  const sections = CHANNELS.map((param) => {
    const P = PARAMS[param];
    return `<section class="param-section"><h2 class="section-title"><span class="key-dot ${P.cls}" aria-hidden="true"></span>${esc(P.label)}</h2>${channelCharts(m, ui, param)}</section>`;
  }).join('');
  return '<section class="page-head"><h1>Trends</h1>'
    + `<p class="muted">Raw and corrected series for the last ${esc(m.range.label)}. Hatched bands are gaps with no data. Vertical lines mark calibrations. Bad-severity points are left out of the lines and listed under each chart.</p></section>`
    + `<div class="toolbar"><label class="check"><input type="checkbox" data-action="toggle-bad"${ui.showBad ? ' checked' : ''}> Show bad-severity points on charts</label></div>`
    + sections;
}
