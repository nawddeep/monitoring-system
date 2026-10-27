import {
  esc, fmtAge, fmtCount, fmtPct, fmtSeconds, flagChip, emptyState, sortFlags, srcButton,
} from '../lib/format.js';
import { CHANNELS, PARAMS, findGaps, median, quantile } from '../lib/model.js';

export const title = 'Data quality';
export const usesRange = true;

function flagCounts(m, sensors) {
  const counts = new Map();
  const present = new Set();
  for (const s of sensors) {
    for (const r of m.readings(s.sensor_id)) {
      const day = m.time.dayKey(r._t);
      const key = `${day}|${s.sensor_id}`;
      if (!counts.has(key)) counts.set(key, { day, sensor: s, total: 0, flags: {} });
      const row = counts.get(key);
      row.total++;
      for (const f of m.flags(r)) {
        row.flags[f] = (row.flags[f] ?? 0) + 1;
        present.add(f);
      }
    }
  }
  if (!counts.size) return emptyState('No readings in this range', 'Flag counts appear once readings arrive.');
  const cols = sortFlags([...present]);
  const order = new Map(sensors.map((s, i) => [s.sensor_id, i]));
  const rows = [...counts.values()].sort((a, b) => (a.day === b.day ? order.get(a.sensor.sensor_id) - order.get(b.sensor.sensor_id) : a.day < b.day ? 1 : -1));
  return '<div class="table-wrap"><table><thead><tr><th>Day</th><th>Sensor</th><th class="num">Readings</th>'
    + cols.map((f) => `<th class="num">${flagChip(f, m.sevMap, m.descMap)}</th>`).join('')
    + '</tr></thead><tbody>'
    + rows.map((r) => `<tr><td>${esc(r.day)}</td><td>${esc(PARAMS[r.sensor.parameter]?.label ?? r.sensor.parameter)}</td><td class="num">${fmtCount(r.total)}</td>`
      + cols.map((f) => `<td class="num">${r.flags[f] ? fmtCount(r.flags[f]) : '<span class="muted">0</span>'}</td>`).join('')
      + '</tr>').join('')
    + '</tbody></table></div>';
}

function cycleTable(m) {
  const cycles = m.cyclesIn();
  if (!cycles.length) return emptyState('No measurement cycles in this range');
  const byDay = new Map();
  for (const c of cycles) {
    const day = m.time.dayKey(c._t);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(c);
  }
  const complete = cycles.filter((c) => c.complete).length;
  const skews = cycles.map((c) => Number(c.max_skew_s)).filter(Number.isFinite);
  const summary = '<div class="stat-row">'
    + `<div class="stat"><span class="stat-value">${fmtPct(complete, cycles.length)}</span><span class="stat-label">cycles complete (${fmtCount(complete)} of ${fmtCount(cycles.length)})</span></div>`
    + `<div class="stat"><span class="stat-value">${esc(fmtSeconds(median(skews)))}</span><span class="stat-label">median skew between channels</span></div>`
    + `<div class="stat"><span class="stat-value">${esc(fmtSeconds(quantile(skews, 0.95)))}</span><span class="stat-label">95th percentile skew</span></div>`
    + `<div class="stat"><span class="stat-value">${esc(fmtSeconds(skews.length ? Math.max(...skews) : null))}</span><span class="stat-label">largest skew (tolerance ${esc(cycles[0].tolerance_s)} s)</span></div>`
    + '</div>';
  const rows = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, list]) => {
    const done = list.filter((c) => c.complete).length;
    const s = list.map((c) => Number(c.max_skew_s)).filter(Number.isFinite);
    const firstIncomplete = list.find((c) => !c.complete);
    return `<tr><td>${esc(day)}</td><td class="num">${fmtCount(list.length)}</td><td class="num">${fmtCount(done)}</td><td class="num">${fmtPct(done, list.length)}</td>`
      + `<td class="num">${esc(fmtSeconds(median(s)))}</td><td class="num">${esc(fmtSeconds(s.length ? Math.max(...s) : null))}</td>`
      + `<td>${firstIncomplete ? srcButton('first incomplete', `m:${firstIncomplete.cycle_id}`) : '<span class="muted">none</span>'}</td></tr>`;
  }).join('');
  return summary + '<div class="table-wrap"><table><thead><tr><th>Day</th><th class="num">Cycles</th><th class="num">Complete</th><th class="num">%</th><th class="num">Median skew</th><th class="num">Max skew</th><th>Example</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`;
}

function clockTable(m) {
  const rows = m.snap.controllers.map((c) => {
    const sensors = m.snap.sensors.filter((s) => s.controller_id === c.controller_id);
    const readings = sensors.flatMap((s) => m.readings(s.sensor_id));
    const lags = readings.filter((r) => r._dev != null && r._recv != null).map((r) => (r._recv - r._dev) / 1000);
    const noDev = readings.filter((r) => r._dev == null).length;
    const sorted = readings.filter((r) => r._dev != null && r._recv != null).sort((a, b) => a._t - b._t);
    const latest = sorted.length ? (sorted[sorted.length - 1]._recv - sorted[sorted.length - 1]._dev) / 1000 : null;
    return `<tr><th scope="row">Controller ${esc(c.name)}</th>`
      + `<td>${c.clock_synced ? '<span class="flag flag-ok"><span class="flag-ico" aria-hidden="true">✓</span>Synced</span>' : '<span class="flag flag-warn"><span class="flag-ico" aria-hidden="true">!</span>Not synced</span>'}</td>`
      + `<td class="num">${esc(fmtSeconds(c.clock_offset_s))}</td>`
      + `<td class="num">${esc(fmtSeconds(median(lags)))}</td><td class="num">${esc(fmtSeconds(quantile(lags, 0.95)))}</td><td class="num">${esc(fmtSeconds(latest))}</td>`
      + `<td class="num">${fmtCount(noDev)}</td></tr>`;
  }).join('');
  return '<div class="table-wrap"><table><thead><tr><th>Controller</th><th>Clock</th><th class="num">Offset applied</th>'
    + '<th class="num">Median received − device time</th><th class="num">95th pct.</th><th class="num">Latest</th><th class="num">Readings without device time</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`
    + '<p class="muted">Received − device time includes network and queue delay. A value that grows steadily suggests the controller clock is drifting.</p>';
}

function gapsTable(m, sensors) {
  const { from, to } = m.range;
  const rows = sensors.flatMap((s) => {
    const times = m.readings(s.sensor_id).map((r) => r._t);
    if (!times.length) return [];
    return findGaps(times, from, to, m.gapMs)
      .filter((g) => !g.leading)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))
      .slice(0, 3)
      .map((g) => ({ s, g }));
  });
  if (!rows.length) {
    const any = sensors.some((s) => m.readings(s.sensor_id).length);
    return emptyState(any ? `No gaps longer than ${fmtAge(m.gapMs)} in this range` : 'No readings in this range');
  }
  return '<div class="table-wrap"><table><thead><tr><th>Sensor</th><th>Gap start</th><th>Gap end</th><th class="num">Duration</th></tr></thead><tbody>'
    + rows.map(({ s, g }) => `<tr><td>${esc(PARAMS[s.parameter]?.label ?? s.parameter)}</td><td>${esc(m.time.dateTime(g.start))}</td>`
      + `<td>${g.trailing ? '<span class="flag flag-warn"><span class="flag-ico" aria-hidden="true">!</span>Ongoing</span>' : esc(m.time.dateTime(g.end))}</td>`
      + `<td class="num">${esc(fmtAge(g.end - g.start))}</td></tr>`).join('')
    + '</tbody></table></div>'
    + `<p class="muted">A gap is any silence longer than ${esc(fmtAge(m.gapMs))} (${m.cfg.gapFactor} × the ${m.cfg.samplingMinutes} min sampling interval).</p>`;
}

export function render(m) {
  const sensors = CHANNELS.map((p) => m.sensorFor(p)).filter(Boolean);
  return '<section class="page-head"><h1>Data quality</h1>'
    + `<p class="muted">Flags, cycle completeness, clock behaviour and gaps for the last ${esc(m.range.label)}. Days are in ${esc(m.time.label)}.</p></section>`
    + `<section class="card"><h2 class="card-title">Measurement cycle completeness</h2>${cycleTable(m)}</section>`
    + `<section class="card"><h2 class="card-title">Clock behaviour per controller</h2>${clockTable(m)}</section>`
    + `<section class="card"><h2 class="card-title">Longest gaps</h2>${gapsTable(m, sensors)}</section>`
    + `<section class="card"><h2 class="card-title">Quality flags per sensor and day</h2>${flagCounts(m, sensors)}</section>`;
}
