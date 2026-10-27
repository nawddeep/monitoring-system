import { esc, fmtValue, fmtCount, srcButton, emptyState, unknown } from '../lib/format.js';
import { PARAMS, toPoints } from '../lib/model.js';
import { timeChart } from '../lib/chart.js';

export const title = 'Lake level';
export const usesRange = true;
export const NO_DATUM = 'No datum configured: distance only';

export function render(m, ui) {
  const sensor = m.sensorFor('water_level');
  const { from, to } = m.range;
  const common = { from, to, time: m.time, gapMs: m.gapMs, sevMap: m.sevMap, descMap: m.descMap, width: ui.width, showBad: ui.showBad };
  const cls = PARAMS.water_level.cls;
  const cfg = sensor ? m.levelConfigAt(sensor.sensor_id) : null;
  const history = sensor ? m.levelBySensor.get(sensor.sensor_id) ?? [] : [];

  const configCard = cfg
    ? '<section class="card"><h2 class="card-title">Reference configuration in force</h2><div class="kv">'
      + `<div><span class="k">Datum</span><span class="v">${srcButton(esc(cfg.datum_description), `l:${cfg.config_id}`)}</span></div>`
      + `<div><span class="k">Transducer height above datum</span><span class="v">${esc(fmtValue(cfg.mount_height_m, 'm'))} m</span></div>`
      + `<div><span class="k">Dead zone</span><span class="v">${cfg.dead_zone_m != null ? `${esc(fmtValue(cfg.dead_zone_m, 'm'))} m` : unknown(null)}</span></div>`
      + `<div><span class="k">Valid from</span><span class="v">${esc(m.time.dateTime(cfg._t))}</span></div>`
      + '</div><p class="muted">Elevation = transducer height above datum − measured distance.</p></section>'
    : `<section class="card"><h2 class="card-title">Reference configuration in force</h2>${emptyState(NO_DATUM, 'No surveyed datum, mount height or dead zone is stored, so water elevation cannot be computed. The dead-zone check is also inactive until a dead zone is stored.')}</section>`;

  const distRows = m.derived('level_distance_m');
  const rawRows = sensor ? m.readings(sensor.sensor_id) : [];
  const distChart = distRows.length
    ? timeChart({
      ...common,
      title: 'Distance from transducer to water surface',
      unit: 'm',
      series: [{ label: 'Distance', cls, unit: 'm', points: toPoints(m, distRows, (d) => d.value, 'd', 'derived_id') }],
      note: 'A larger distance means a lower water surface.',
    })
    : timeChart({
      ...common,
      title: 'Ultrasonic sensor raw output',
      unit: rawRows[rawRows.length - 1]?.raw_unit ?? '',
      series: [{ label: 'Raw', cls, unit: rawRows[rawRows.length - 1]?.raw_unit, points: toPoints(m, rawRows, (r) => r.raw_value) }],
      emptyText: 'No level readings in this range.',
    });

  const elevRows = m.derived('water_elevation_m');
  const elevChart = timeChart({
    ...common,
    title: 'Water elevation vs datum',
    unit: 'm',
    series: [{ label: 'Elevation', cls, unit: 'm', points: toPoints(m, elevRows, (d) => d.value, 'd', 'derived_id') }],
    emptyText: cfg ? 'No elevation values in this range.' : NO_DATUM,
    emptyBody: cfg ? '' : 'Elevation needs a surveyed datum and the transducer mount height.',
  });

  const echo = rawRows.filter((r) => m.flags(r).includes('ECHO_OUT_OF_RANGE')).length;
  const echoNote = `<p class="muted">Readings flagged Echo out of range in this range: ${fmtCount(echo)}${cfg?.dead_zone_m == null ? ' (dead-zone check inactive: no dead zone stored)' : ''}.</p>`;

  const historyTable = history.length
    ? '<div class="table-wrap"><table><thead><tr><th>Valid from</th><th>Mount height</th><th>Dead zone</th><th>Datum</th></tr></thead><tbody>'
      + [...history].reverse().map((c) => `<tr><td>${esc(m.time.dateTime(c._t))}</td><td class="num">${srcButton(`${esc(fmtValue(c.mount_height_m, 'm'))} m`, `l:${c.config_id}`)}</td>`
        + `<td class="num">${c.dead_zone_m != null ? `${esc(fmtValue(c.dead_zone_m, 'm'))} m` : unknown(null)}</td><td>${esc(c.datum_description)}</td></tr>`).join('')
      + '</tbody></table></div>'
    : emptyState('No configuration history');

  return '<section class="page-head"><h1>Lake level</h1>'
    + `<p class="muted">Ultrasonic distance and, when a datum exists, elevation, for the last ${esc(m.range.label)}. The vendor 0 to 20 m level range describes different hardware and is not used here.</p></section>`
    + configCard
    + `<div class="stack">${distChart}${elevChart}</div>`
    + echoNote
    + `<section class="card"><h2 class="card-title">Configuration history</h2>${historyTable}</section>`;
}
