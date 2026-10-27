import {
  esc, fmtValue, unitLabel, fmtAge, fmtPct, fmtSeconds, flagChips, srcButton, emptyState, FLAG_TEXT,
} from '../lib/format.js';
import { CHANNELS, PARAMS, toPoints, median } from '../lib/model.js';
import { sparkline } from '../lib/chart.js';

export const title = 'Overview';
export const DISCLAIMER = 'Four-sensor prototype. Not a comprehensive ecological or drinking-water assessment.';

const DAY = 86400e3;

function valueHtml(value, unit, ref, tag) {
  const v = fmtValue(value, unit);
  if (v == null) return '<span class="tile-value unknown">Unknown</span>';
  return `${srcButton(`<span class="tile-value">${esc(v)}</span><span class="tile-unit">${esc(unitLabel(unit))}</span>`, ref, 'tile-src')}`
    + (tag ? `<span class="value-tag">${esc(tag)}</span>` : '');
}

function line(label, html) {
  return `<div class="tile-line"><span class="tile-line-label">${esc(label)}</span><span>${html}</span></div>`;
}

/** Per-channel primary value, extra lines and the 24 h sparkline series. */
function channelView(m, param, sensor, r) {
  const from = m.now - DAY;
  const rows = m.readings(sensor.sensor_id, from, m.now);
  const lines = [];
  let main;
  let spark;

  if (param === 'water_level') {
    const elev = m.latestDerived(r, 'water_elevation_m');
    const dist = m.latestDerived(r, 'level_distance_m');
    const cfg = m.levelConfigAt(sensor.sensor_id, r._t);
    if (elev?.value != null) {
      main = valueHtml(elev.value, elev.unit, `d:${elev.derived_id}`, 'elevation vs datum');
      spark = toPoints(m, m.derived('water_elevation_m', from, m.now), (d) => d.value, 'd', 'derived_id');
      if (dist?.value != null) lines.push(line('Distance to water', srcButton(`${esc(fmtValue(dist.value, 'm'))} m`, `d:${dist.derived_id}`)));
    } else if (dist?.value != null) {
      main = valueHtml(dist.value, dist.unit, `d:${dist.derived_id}`, 'distance to water, not elevation');
      spark = toPoints(m, m.derived('level_distance_m', from, m.now), (d) => d.value, 'd', 'derived_id');
    } else {
      main = valueHtml(r.raw_value, r.raw_unit, `r:${r.reading_id}`, 'raw sensor output');
      spark = toPoints(m, rows, (x) => x.raw_value);
    }
    if (!cfg) lines.push(line('Elevation', '<span class="unknown">No datum configured: distance only</span>'));
    else if (elev?.value == null) lines.push(line('Elevation', '<span class="unknown">Not computed for this reading</span>'));
    return { main, lines, spark };
  }

  const d = m.display(r);
  const cal = m.calibrationAt(sensor.sensor_id, r._t);
  if (param === 'ph') {
    if (d.kind === 'corrected') {
      main = valueHtml(d.value, d.unit || 'pH', `r:${r.reading_id}`, `calibration v${m.calById.get(r.calibration_id)?.version ?? '?'}`);
    } else {
      main = valueHtml(d.value, d.unit, `r:${r.reading_id}`, 'raw electrode output, not pH');
      lines.push(line('pH', '<span class="unknown">Not available: no valid calibration</span>'));
    }
    spark = toPoints(m, rows, (x) => (d.kind === 'corrected' ? x.corrected_value : x.raw_value));
    return { main, lines, spark };
  }

  if (param === 'water_temperature') {
    const tag = r.calibration_id == null ? 'as reported, no reference-thermometer correction' : `corrected, calibration v${m.calById.get(r.calibration_id)?.version ?? '?'}`;
    main = valueHtml(d.value, d.unit, `r:${r.reading_id}`, tag);
    spark = toPoints(m, rows, (x) => x.corrected_value ?? x.raw_value);
    return { main, lines, spark };
  }

  // tds_ec
  main = valueHtml(d.value, d.unit, `r:${r.reading_id}`, d.kind === 'corrected' ? 'EC, calibrated, not temperature-compensated' : 'raw, not temperature-compensated');
  spark = toPoints(m, rows, (x) => (d.kind === 'corrected' ? x.corrected_value : x.raw_value));
  const ec25 = m.latestDerived(r, 'ec_uS_cm_25c');
  const tds = m.latestDerived(r, 'tds_est_mg_l');
  const refT = cal.record?.reference_temp_c ?? 25;
  if (ec25?.value != null) {
    lines.push(line(`EC at ${refT} °C`, `${srcButton(`${esc(fmtValue(ec25.value, 'µS/cm'))} µS/cm`, `d:${ec25.derived_id}`)} <span class="muted">temperature age ${esc(fmtSeconds(ec25.temp_age_s))}</span>`));
  } else if (ec25) {
    lines.push(line(`EC at ${refT} °C`, `<span class="unknown">Not compensated</span> ${flagChips(m.flags(ec25), m.sevMap, m.descMap)}`));
  } else {
    lines.push(line(`EC at ${refT} °C`, '<span class="unknown">Not compensated: no temperature coefficient stored</span>'));
  }
  const factor = cal.record?.conversion_factor;
  if (tds?.value != null) {
    lines.push(line('Estimated TDS (from conductivity)', `${srcButton(`${esc(fmtValue(tds.value, 'mg/L'))} mg/L`, `d:${tds.derived_id}`)} <span class="muted">factor ${esc(factor ?? 'Unknown')}</span>`));
  } else {
    lines.push(line('Estimated TDS (from conductivity)', '<span class="unknown">Not computed: no conversion factor stored</span>'));
  }
  return { main, lines, spark };
}

function tile(m, param) {
  const P = PARAMS[param];
  const sensor = m.sensorFor(param);
  const ctrl = m.controllerOf(sensor);
  const head = `<header class="tile-head"><span class="key-dot ${P.cls}" aria-hidden="true"></span><h2>${esc(P.label)}</h2>`
    + `<span class="muted">Controller ${esc(ctrl?.name ?? 'Unknown')}</span></header>`;
  const r = sensor ? m.latestBySensor.get(sensor.sensor_id) : null;
  if (!r) return `<article class="tile">${head}${emptyState('No readings received yet', 'This channel has not sent a reading.')}</article>`;

  const { main, lines, spark } = channelView(m, param, sensor, r);
  const stale = m.isStale(sensor, r);
  const age = m.now - r._t;
  const ageHtml = stale
    ? `<span class="flag flag-warn"><span class="flag-ico" aria-hidden="true">!</span>Stale</span> last reading ${esc(fmtAge(age))} ago (limit ${sensor.stale_after_minutes ?? 30} min)`
    : `measured ${esc(fmtAge(age))} ago`;
  return `<article class="tile${stale ? ' is-stale' : ''}">${head}`
    + `<div class="tile-main">${main}</div>`
    + `<div class="tile-flags">${flagChips(m.flags(r), m.sevMap, m.descMap)}${r.is_synthetic ? '<span class="synthetic-tag">Synthetic</span>' : ''}</div>`
    + `<p class="tile-age">${ageHtml} · ${esc(m.time.dateTime(r._t))}</p>`
    + `${lines.join('')}`
    + `<div class="tile-spark"><span class="visually-hidden">24 hour trend</span>${sparkline(spark, m.now - DAY, m.now, P.cls, m.gapMs)}<span class="spark-caption">Last 24 h</span></div>`
    + '</article>';
}

function issues(m) {
  const out = [];
  for (const param of CHANNELS) {
    const sensor = m.sensorFor(param);
    const label = PARAMS[param].label;
    const r = sensor ? m.latestBySensor.get(sensor.sensor_id) : null;
    if (!r) {
      out.push({ label, text: 'no readings received yet' });
      continue;
    }
    const parts = [];
    if (m.isStale(sensor, r)) parts.push(`stale: last reading ${fmtAge(m.now - r._t)} ago`);
    const flags = m.flags(r);
    const bad = flags.filter((f) => m.sevMap[f] === 'bad');
    if (bad.length) parts.push(`flagged bad: ${bad.map((f) => FLAG_TEXT[f] ?? f).join(', ')}`);
    for (const f of ['UNCALIBRATED', 'CAL_EXPIRED', 'STALE_TEMP', 'NO_CAL_FOR_UNIT', 'CLOCK_UNSYNCED']) {
      if (flags.includes(f)) parts.push((FLAG_TEXT[f] ?? f).toLowerCase());
    }
    if (parts.length) out.push({ label, text: parts.join('; ') });
  }
  return out;
}

function evidenceStrip(m) {
  const installed = m.snap.sensors.filter((s) => s.installed);
  const verified = installed.filter((s) => s.evidence_status === 'verified').length;
  const calibrated = installed.filter((s) => ['valid', 'no_expiry'].includes(m.calibrationAt(s.sensor_id).status)).length;
  const tests = m.snap.acceptance_tests;
  const run = tests.filter((t) => t.result !== 'not_run').length;
  const chips = m.snap.controllers.filter((c) => c.chip_verified).length;
  const synced = m.snap.controllers.filter((c) => c.clock_synced).length;
  const cell = (n, d, label) => `<div class="ev-cell"><span class="ev-num">${n}<span class="ev-den">/${d}</span></span><span class="ev-label">${esc(label)}</span></div>`;
  return '<section class="card"><h2 class="card-title">Evidence</h2><div class="evidence-strip">'
    + cell(verified, installed.length, 'sensors verified')
    + cell(calibrated, installed.length, 'with a valid calibration')
    + cell(run, tests.length, 'acceptance tests run')
    + cell(chips, m.snap.controllers.length, 'controller chips verified')
    + cell(synced, m.snap.controllers.length, 'controller clocks synced')
    + '</div></section>';
}

function cycleCard(m) {
  const day = m.cyclesIn(m.now - DAY, m.now);
  const latest = m.cycles[m.cycles.length - 1];
  if (!latest) return `<section class="card"><h2 class="card-title">Measurement cycles</h2>${emptyState('No measurement cycles yet', 'Cycles pair the four channels by timestamp once readings arrive.')}</section>`;
  const complete = day.filter((c) => c.complete).length;
  const skews = day.map((c) => Number(c.max_skew_s)).filter(Number.isFinite);
  return '<section class="card"><h2 class="card-title">Measurement cycles</h2><div class="kv">'
    + `<div><span class="k">Latest cycle</span><span class="v">${srcButton(latest.complete ? 'Complete' : 'Incomplete', `m:${latest.cycle_id}`)} · ${esc(m.time.dateTime(latest._t))}</span></div>`
    + `<div><span class="k">Latest skew between channels</span><span class="v">${esc(fmtSeconds(latest.max_skew_s))} (tolerance ${latest.tolerance_s} s)</span></div>`
    + `<div><span class="k">Complete cycles, last 24 h</span><span class="v">${complete} of ${day.length} (${fmtPct(complete, day.length)})</span></div>`
    + `<div><span class="k">Median skew, last 24 h</span><span class="v">${esc(fmtSeconds(median(skews)))}</span></div>`
    + '</div></section>';
}

export function render(m) {
  const list = issues(m);
  const banner = list.length
    ? `<div class="banner banner-warn" role="status"><p class="banner-title"><span class="flag-ico" aria-hidden="true">!</span>Attention: ${list.length} of 4 channels need review</p><ul>${list.map((i) => `<li><strong>${esc(i.label)}:</strong> ${esc(i.text)}</li>`).join('')}</ul></div>`
    : '<div class="banner banner-ok" role="status"><p class="banner-title"><span class="flag-ico" aria-hidden="true">✓</span>All four channels are current, calibrated and free of bad flags.</p></div>';
  return `<section class="page-head"><h1>Overview</h1><p class="disclaimer">${esc(DISCLAIMER)}</p></section>`
    + banner
    + `<div class="tiles">${CHANNELS.map((p) => tile(m, p)).join('')}</div>`
    + `<div class="grid-2">${evidenceStrip(m)}${cycleCard(m)}</div>`;
}
