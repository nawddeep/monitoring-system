import { esc, fmtCount, flagChips, fmtValue, emptyState, isoUtc } from '../lib/format.js';
import { PARAMS } from '../lib/model.js';

export const title = 'Export';
export const usesRange = true;

export const CSV_COLUMNS = [
  'reading_id', 'sensor_id', 'parameter', 'controller', 'measured_at_utc', 'device_time_raw_utc', 'received_at_utc',
  'raw_value', 'raw_unit', 'corrected_value', 'corrected_unit', 'calibration_id', 'calibration_version',
  'quality_flag', 'all_flags', 'is_synthetic',
];

function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  // Guard spreadsheet formula injection in text cells.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportRows(m, sensorIds) {
  const ids = new Set(sensorIds);
  return m.snap.readings
    .filter((r) => ids.has(r.sensor_id) && r._t >= m.range.from && r._t <= m.range.to)
    .sort((a, b) => a._t - b._t || a.sensor_id - b.sensor_id);
}

export function buildCsv(m, sensorIds) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of exportRows(m, sensorIds)) {
    const s = m.sensorById.get(r.sensor_id);
    const cal = r.calibration_id != null ? m.calById.get(r.calibration_id) : null;
    lines.push([
      r.reading_id, r.sensor_id, s?.parameter, m.controllerById.get(r.controller_id)?.name,
      isoUtc(r._t), isoUtc(r._dev), isoUtc(r._recv),
      r.raw_value, r.raw_unit, r.corrected_value, r.corrected_unit,
      r.calibration_id, cal?.version, r.quality_flag, m.flags(r).join('|'), r.is_synthetic ? 'true' : 'false',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function render(m, ui) {
  const sensors = m.snap.sensors.filter((s) => s.installed || m.readingsBySensor.has(s.sensor_id));
  const selected = ui.exportSensors ?? sensors.map((s) => s.sensor_id);
  const rows = exportRows(m, selected);
  const synthetic = rows.filter((r) => r.is_synthetic).length;
  const boxes = sensors.map((s) => `<label class="check"><input type="checkbox" data-action="export-sensor" value="${s.sensor_id}"${selected.includes(s.sensor_id) ? ' checked' : ''}> ${esc(PARAMS[s.parameter]?.label ?? s.parameter)}</label>`).join('');
  const preview = rows.length
    ? '<div class="table-wrap"><table><thead><tr><th>Reading</th><th>Sensor</th><th>Measured (UTC)</th><th>Raw</th><th>Corrected</th><th>Cal. version</th><th>Flags</th><th>Synthetic</th></tr></thead><tbody>'
      + rows.slice(-10).reverse().map((r) => {
        const cal = r.calibration_id != null ? m.calById.get(r.calibration_id) : null;
        return `<tr><td>${esc(r.reading_id)}</td><td>${esc(PARAMS[m.sensorById.get(r.sensor_id)?.parameter]?.label ?? r.sensor_id)}</td><td>${esc(isoUtc(r._t))}</td>`
          + `<td class="num">${esc(fmtValue(r.raw_value, r.raw_unit) ?? '')} ${esc(r.raw_unit)}</td>`
          + `<td class="num">${r.corrected_value != null ? `${esc(fmtValue(r.corrected_value, r.corrected_unit))} ${esc(r.corrected_unit ?? '')}` : '<span class="unknown">NULL</span>'}</td>`
          + `<td>${cal ? `v${esc(cal.version)}` : '<span class="unknown">none</span>'}</td><td>${flagChips(m.flags(r), m.sevMap, m.descMap)}</td><td>${r.is_synthetic ? 'Yes' : 'No'}</td></tr>`;
      }).join('')
      + '</tbody></table></div>'
    : emptyState('No readings to export in this range', 'The CSV would contain only the header row.');
  return '<section class="page-head"><h1>Export</h1>'
    + `<p class="muted">CSV of readings for the last ${esc(m.range.label)}: raw value, corrected value, units, calibration version, quality flags and the synthetic marker. Timestamps are UTC (ISO 8601).</p></section>`
    + `<section class="card"><h2 class="card-title">Sensors</h2><div class="checks">${boxes}</div>`
    + `<p>${fmtCount(rows.length)} rows${synthetic ? `, of which ${fmtCount(synthetic)} are synthetic (is_synthetic = true)` : ''}.</p>`
    + '<button type="button" class="btn" data-action="download-csv">Download CSV</button></section>'
    + `<section class="card"><h2 class="card-title">Preview: latest 10 rows</h2>${preview}</section>`;
}
