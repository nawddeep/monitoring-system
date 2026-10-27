// Builds the "source row" dialog for any clickable number.

import { esc, flagChips, srcButton } from './format.js';
import { PARAMS } from './model.js';

const TABLES = {
  r: { table: 'readings', index: 'readingById' },
  d: { table: 'derived_measurements', index: 'derivedById' },
  c: { table: 'calibration_records', index: 'calById' },
  m: { table: 'measurement_cycles', index: 'cycleById' },
  l: { table: 'level_site_config', index: 'levelById' },
};

const LINKS = {
  calibration_id: 'c',
  source_reading_id: 'r',
  temp_reading_id: 'r',
  ph_reading_id: 'r',
  tds_reading_id: 'r',
  level_reading_id: 'r',
};

function cell(m, key, value) {
  if (value == null) return '<span class="unknown">NULL</span>';
  if (LINKS[key]) return srcButton(esc(value), `${LINKS[key]}:${value}`);
  if (key === 'flags' && Array.isArray(value)) return flagChips(value, m.sevMap, m.descMap);
  if (key === 'quality_flag') return flagChips([value], m.sevMap, m.descMap);
  if (typeof value === 'object') return `<code>${esc(JSON.stringify(value))}</code>`;
  return esc(value);
}

function context(m, prefix, row) {
  const items = [];
  if (prefix === 'r') {
    const s = m.sensorById.get(row.sensor_id);
    const c = m.controllerById.get(row.controller_id);
    const cal = row.calibration_id != null ? m.calById.get(row.calibration_id) : null;
    items.push(['Sensor', `${PARAMS[s?.parameter]?.label ?? s?.parameter ?? 'Unknown'} (sensor ${row.sensor_id})`]);
    items.push(['Controller', c ? `Controller ${c.name}` : 'Unknown']);
    items.push(['Measured', m.time.full(row._t)]);
    items.push(['Calibration version', cal ? `v${cal.version}` : 'None (no calibration applied)']);
    if (row.is_synthetic) items.push(['Origin', 'Marked synthetic in the database (is_synthetic = true), not a measurement']);
  } else if (prefix === 'd') {
    const src = m.readingById.get(row.source_reading_id);
    items.push(['Derived from reading', String(row.source_reading_id)]);
    if (src) items.push(['Measured', m.time.full(src._t)]);
  } else if (prefix === 'c' || prefix === 'l') {
    const s = m.sensorById.get(row.sensor_id);
    items.push(['Sensor', `${PARAMS[s?.parameter]?.label ?? 'Unknown'} (sensor ${row.sensor_id})`]);
  } else if (prefix === 'm') {
    items.push(['Cycle start', m.time.full(row._t)]);
  }
  return items.length
    ? `<dl class="src-context">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
    : '';
}

/** Returns { title, html } for a ref such as "r:12", or null when the ref is malformed. */
export function sourceHtml(m, ref) {
  const [prefix, idStr] = String(ref).split(':');
  const spec = TABLES[prefix];
  const id = Number(idStr);
  if (!spec || !Number.isFinite(id)) return null;
  const row = m[spec.index].get(id);
  const title = `${spec.table} #${id}`;
  if (!row) return { title, html: `<p>Row ${esc(id)} of ${esc(spec.table)} is not in the loaded data range.</p>` };
  const fields = Object.entries(row).filter(([k]) => !k.startsWith('_'));
  return {
    title,
    html: context(m, prefix, row)
      + `<div class="table-wrap"><table class="src-table"><tbody>${fields.map(([k, v]) => `<tr><th scope="row"><code>${esc(k)}</code></th><td>${cell(m, k, v)}</td></tr>`).join('')}</tbody></table></div>`,
  };
}
