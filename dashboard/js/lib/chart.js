// SVG time-series charts rendered as strings. Hover and table view are wired up by app.js
// through the registry, so this module stays DOM-free.

import {
  esc, fmtValue, unitLabel, flagChip, flagChips, FLAG_PRIORITY, fmtCount, emptyState, srcButton, severityIcon, SEVERITY_TEXT,
} from './format.js';
import { findGaps } from './model.js';

const registry = new Map();
let seq = 0;

export function resetCharts() {
  registry.clear();
  seq = 0;
}

export function niceTicks(min, max, count = 5) {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo, hi: hi === lo ? lo + step : hi, step, ticks };
}

function fmtTick(v, step) {
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  return v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 86400e3;
const TIME_STEPS = [5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

export function timeTicks(from, to, time, target = 6) {
  const step = TIME_STEPS.find((s) => (to - from) / s <= target) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const off = time.offsetMs(from);
  const ticks = [];
  for (let local = Math.ceil((from + off) / step) * step; local - off <= to; local += step) {
    const t = local - off;
    const midnight = local % DAY === 0;
    ticks.push({ t, label: step >= DAY || midnight ? time.day(t) : time.hm(t), major: midnight });
  }
  return ticks;
}

function pathFor(points, x, y, gapMs) {
  let d = '';
  const isolated = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const startsSegment = i === 0 || p.t - points[i - 1].t > gapMs;
    const endsSegment = i === points.length - 1 || points[i + 1].t - p.t > gapMs;
    d += `${startsSegment ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    if (startsSegment && endsSegment) isolated.push(p);
  }
  return { d, isolated };
}

function marker(p, x, y, cls) {
  const cx = x(p.t);
  const cy = y(p.v);
  const f = (n) => n.toFixed(1);
  if (p.sev === 'bad') {
    return `<path class="mk-bad" d="M${f(cx - 4)},${f(cy - 4)}L${f(cx + 4)},${f(cy + 4)}M${f(cx + 4)},${f(cy - 4)}L${f(cx - 4)},${f(cy + 4)}"/>`;
  }
  if (p.sev === 'warn') {
    return `<path class="mk ${cls}" d="M${f(cx)},${f(cy - 5)}L${f(cx + 4.5)},${f(cy + 3.5)}L${f(cx - 4.5)},${f(cy + 3.5)}Z"/>`;
  }
  return `<circle class="mk ${cls}" cx="${f(cx)}" cy="${f(cy)}" r="4"/>`;
}

const priorityRank = (f) => {
  const i = FLAG_PRIORITY.indexOf(f);
  return i === -1 ? 99 : i;
};

/**
 * series: [{ label, cls, unit?, secondary?, points: [{ t, v, flags, sev, ref }] }]
 * markers: [{ t, label }] vertical calibration markers.
 */
export function timeChart(o) {
  const {
    title, unit, series, from, to, time, gapMs, sevMap, descMap,
    width = 800, height = 220, markers = [], showBad = false,
    emptyText = 'No readings in this range.', emptyBody = '', note = '',
  } = o;
  const id = `chart-${++seq}`;
  const u = unitLabel(unit);
  const head = `<figcaption class="chart-head"><span class="chart-title">${esc(title)}</span>`
    + `<span class="chart-unit">${u ? `${esc(u)} · ` : ''}time in ${esc(time.label)}</span></figcaption>`;
  const noteHtml = note ? `<p class="chart-note">${note}</p>` : '';

  const prepared = series.map((s) => {
    const pts = s.points
      .filter((p) => p.v != null && Number.isFinite(p.v) && p.t >= from && p.t <= to)
      .sort((a, b) => a.t - b.t);
    return { ...s, pts, good: showBad ? pts : pts.filter((p) => p.sev !== 'bad'), bad: pts.filter((p) => p.sev === 'bad') };
  });
  const total = prepared.reduce((n, s) => n + s.pts.length, 0);
  if (!total) return `<figure class="chart-card">${head}${emptyState(emptyText, emptyBody)}${noteHtml}</figure>`;

  let values = prepared.flatMap((s) => s.good.map((p) => p.v));
  if (!values.length || showBad) values = prepared.flatMap((s) => s.pts.map((p) => p.v));
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const v of values) {
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }

  const W = Math.max(280, Math.round(width));
  const ml = 54;
  const mr = 14;
  const mt = 28;
  const mb = 22;
  const stripH = 8;
  const stripGap = 8;
  const ph = height - mt - mb - stripH - stripGap;
  const pw = W - ml - mr;
  const yt = niceTicks(vMin, vMax, ph < 120 ? 3 : 5);
  const x = (t) => ml + ((t - from) / (to - from)) * pw;
  const y = (v) => mt + ph - ((v - yt.lo) / (yt.hi - yt.lo)) * ph;
  const stripY = mt + ph + stripGap;

  let g = `<defs><pattern id="${id}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + '<line class="hatch" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>';

  for (const v of yt.ticks) {
    const yy = y(v).toFixed(1);
    g += `<line class="grid" x1="${ml}" x2="${ml + pw}" y1="${yy}" y2="${yy}"/>`;
    g += `<text class="tick" x="${ml - 6}" y="${+yy + 4}" text-anchor="end">${esc(fmtTick(v, yt.step))}</text>`;
  }
  g += `<text class="axis-unit" x="${ml - 6}" y="${mt - 14}" text-anchor="end">${esc(u)}</text>`;

  // Gaps: hatched bands where the primary series has no data.
  const primary = prepared.find((s) => !s.secondary && s.pts.length) ?? prepared.find((s) => s.pts.length);
  for (const gap of findGaps(primary.pts.map((p) => p.t), from, to, gapMs)) {
    const gx = x(gap.start);
    const gw = x(gap.end) - gx;
    if (gw < 1) continue;
    g += `<rect class="gap" x="${gx.toFixed(1)}" y="${mt}" width="${gw.toFixed(1)}" height="${ph}" fill="url(#${id}-hatch)"/>`;
    if (gw > 44) g += `<text class="gap-label" x="${(gx + gw / 2).toFixed(1)}" y="${mt + 12}" text-anchor="middle">no data</text>`;
  }

  for (const mk of markers) {
    if (mk.t < from || mk.t > to) continue;
    const mx = x(mk.t).toFixed(1);
    g += `<line class="calmark" x1="${mx}" x2="${mx}" y1="${mt}" y2="${mt + ph}"/>`;
    g += `<text class="calmark-label" x="${+mx + 3}" y="${mt + 22}">${esc(mk.label)}</text>`;
  }

  // Draw secondary (raw) series first so the primary sits on top.
  const order = [...prepared].sort((a, b) => Number(Boolean(b.secondary)) - Number(Boolean(a.secondary)));
  for (const s of order) {
    if (!s.good.length) continue;
    const { d, isolated } = pathFor(s.good, x, y, gapMs);
    g += `<path class="ln ${s.cls}${s.secondary ? ' secondary' : ''}" d="${d}"/>`;
    if (s.secondary) continue;
    const sparse = s.good.length <= pw / 7;
    for (const p of sparse ? s.good : isolated) g += marker(p, x, y, s.cls);
  }
  if (showBad) for (const s of prepared) for (const p of s.bad) g += marker(p, x, y, s.cls);

  // Flag strip: one run per stretch of identical flags on the primary series.
  const runs = [];
  for (const p of primary.pts) {
    const key = p.flags.join('+');
    const last = runs[runs.length - 1];
    if (last && last.key === key && p.t - last.end <= gapMs) {
      last.end = p.t;
      last.count++;
    } else runs.push({ key, sev: p.sev, start: p.t, end: p.t, count: 1 });
  }
  g += `<text class="tick" x="${ml - 6}" y="${stripY + 7}" text-anchor="end">Flags</text>`;
  for (const r of runs) {
    const rx = x(r.start) - 1;
    const rw = Math.max(2, x(r.end) - x(r.start) + 2);
    g += `<rect class="strip sev-${r.sev}" x="${rx.toFixed(1)}" y="${stripY}" width="${rw.toFixed(1)}" height="${stripH}"/>`;
  }

  g += `<line class="axis" x1="${ml}" x2="${ml + pw}" y1="${mt + ph}" y2="${mt + ph}"/>`;
  const labelY = stripY + stripH + 15;
  for (const tk of timeTicks(from, to, time, Math.max(3, Math.floor(pw / 64)))) {
    const tx = x(tk.t);
    if (tx < ml + 14 || tx > ml + pw - 14) continue;
    g += `<line class="tickmark" x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${mt + ph}" y2="${mt + ph + 4}"/>`;
    g += `<text class="tick${tk.major ? ' major' : ''}" x="${tx.toFixed(1)}" y="${labelY}" text-anchor="middle">${esc(tk.label)}</text>`;
  }

  g += `<line class="xhair" x1="0" x2="0" y1="${mt}" y2="${mt + ph}" visibility="hidden"/>`;
  g += `<rect class="hit" data-chart="${id}" x="${ml}" y="${mt}" width="${pw}" height="${ph + stripGap + stripH}"/>`;

  registry.set(id, {
    from, to, ml, pw, W, gapMs, time, sevMap, descMap, title, unit,
    series: prepared.map((s) => ({ label: s.label, cls: s.cls, unit: s.unit ?? unit, pts: s.pts })),
  });

  const legendSeries = prepared.length >= 2
    ? prepared.map((s) => `<span class="key"><span class="key-line ${s.cls}${s.secondary ? ' secondary' : ''}"></span>${esc(s.label)}</span>`).join('')
    : '';
  const counts = {};
  for (const p of primary.pts) for (const f of p.flags) counts[f] = (counts[f] ?? 0) + 1;
  const flagLegend = Object.entries(counts)
    .sort((a, b) => priorityRank(a[0]) - priorityRank(b[0]))
    .map(([f, n]) => `<span class="flag-count">${flagChip(f, sevMap, descMap)}<span class="count">${fmtCount(n)} of ${fmtCount(primary.pts.length)}</span></span>`)
    .join('');

  const badAll = prepared.flatMap((s) => s.bad.map((p) => ({ ...p, label: s.label, unit: s.unit ?? unit })));
  const badHtml = badAll.length ? badTable(badAll, showBad, time, sevMap, descMap) : '';

  return `<figure class="chart-card" id="${id}">${head}`
    + `<div class="chart-body"><svg class="chart-svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="${esc(title)}: ${total} points">${g}</svg>`
    + '<div class="tip" hidden></div></div>'
    + `<div class="legend">${legendSeries}${flagLegend}</div>`
    + `${noteHtml}${badHtml}`
    + `<details class="table-view" data-table="${id}"><summary>Table view (${fmtCount(total)} points)</summary><div class="table-slot"></div></details>`
    + '</figure>';
}

function badTable(points, shown, time, sevMap, descMap) {
  const rows = [...points].sort((a, b) => b.t - a.t).slice(0, 200).map((p) => `<tr><td>${esc(time.dateTime(p.t))}</td><td>${esc(p.label)}</td>`
    + `<td class="num">${srcButton(`${esc(fmtValue(p.v, p.unit))} ${esc(unitLabel(p.unit))}`, p.ref)}</td><td>${flagChips(p.flags, sevMap, descMap)}</td></tr>`).join('');
  return `<details class="bad-points"${points.length <= 20 ? ' open' : ''}><summary><span class="flag flag-bad"><span class="flag-ico" aria-hidden="true">${severityIcon('bad')}</span>${SEVERITY_TEXT.bad}</span> `
    + `${fmtCount(points.length)} bad-severity point${points.length === 1 ? '' : 's'} ${shown ? 'shown as ✕ markers' : 'excluded from the line'}</summary>`
    + `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Series</th><th>Value</th><th>Flags</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

/** Table view for a chart, built on demand when the reader opens it. */
export function tableHtml(id, limit = 300) {
  const c = registry.get(id);
  if (!c) return '';
  const rows = c.series.flatMap((s) => s.pts.map((p) => ({ ...p, label: s.label, unit: s.unit })))
    .sort((a, b) => b.t - a.t);
  const body = rows.slice(0, limit).map((p) => `<tr><td>${esc(c.time.dateTime(p.t))}</td><td>${esc(p.label)}</td>`
    + `<td class="num">${srcButton(`${esc(fmtValue(p.v, p.unit))} ${esc(unitLabel(p.unit))}`, p.ref)}</td><td>${flagChips(p.flags, c.sevMap, c.descMap)}</td></tr>`).join('');
  const more = rows.length > limit ? `<p class="muted">Showing the latest ${limit} of ${fmtCount(rows.length)} points. Use Export for the full set.</p>` : '';
  return `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Series</th><th>Value</th><th>Flags</th></tr></thead><tbody>${body}</tbody></table></div>${more}`;
}

function nearest(pts, t) {
  if (!pts.length) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(pts[lo].t - t) <= Math.abs(pts[hi].t - t) ? pts[lo] : pts[hi];
}

/** Tooltip content for a pointer at svgX (viewBox units). */
export function hoverAt(id, svgX) {
  const c = registry.get(id);
  if (!c) return null;
  const t = c.from + ((svgX - c.ml) / c.pw) * (c.to - c.from);
  const anchorSeries = c.series.find((s) => s.pts.length);
  const anchor = anchorSeries && nearest(anchorSeries.pts, t);
  if (!anchor || Math.abs(anchor.t - t) > c.gapMs) return null;
  const rows = c.series.map((s) => {
    const p = nearest(s.pts, anchor.t);
    if (!p || Math.abs(p.t - anchor.t) > c.gapMs) return '';
    return `<div class="tip-row"><span class="key-line ${s.cls}"></span><strong>${esc(fmtValue(p.v, s.unit))} ${esc(unitLabel(s.unit))}</strong>`
      + `<span class="tip-label">${esc(s.label)}</span>${flagChips(p.flags, c.sevMap, c.descMap)}</div>`;
  }).join('');
  return {
    x: c.ml + ((anchor.t - c.from) / (c.to - c.from)) * c.pw,
    W: c.W,
    ref: anchor.ref,
    html: `<div class="tip-time">${esc(c.time.full(anchor.t))}</div>${rows}<div class="tip-hint">Click for source row</div>`,
  };
}

/** 24 h sparkline; bad-severity points are left out, gaps stay gaps. */
export function sparkline(points, from, to, cls, gapMs, w = 240, h = 40) {
  const pts = points.filter((p) => p.v != null && p.sev !== 'bad' && p.t >= from && p.t <= to);
  if (pts.length < 2) return '<div class="spark-empty">No 24 h trend available</div>';
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    if (p.v < lo) lo = p.v;
    if (p.v > hi) hi = p.v;
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const x = (t) => ((t - from) / (to - from)) * w;
  const y = (v) => h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
  const { d } = pathFor(pts, x, y, gapMs);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
    + `<path class="ln ${cls}" vector-effect="non-scaling-stroke" d="${d}"/></svg>`;
}
