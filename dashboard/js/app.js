import { buildModel, rangeFor, RANGES } from './lib/model.js';
import { resetCharts, hoverAt, tableHtml } from './lib/chart.js';
import { sourceHtml } from './lib/source.js';
import { esc } from './lib/format.js';
import { createSource, NotConfiguredError } from './data.js';
import * as overview from './pages/overview.js';
import * as trends from './pages/trends.js';
import * as chemistry from './pages/chemistry.js';
import * as level from './pages/level.js';
import * as calibration from './pages/calibration.js';
import * as quality from './pages/quality.js';
import * as registry from './pages/registry.js';
import * as exportPage from './pages/export.js';

const PAGES = [
  { key: 'overview', mod: overview, nav: 'Overview' },
  { key: 'trends', mod: trends, nav: 'Trends' },
  { key: 'chemistry', mod: chemistry, nav: 'Water chemistry' },
  { key: 'level', mod: level, nav: 'Lake level' },
  { key: 'calibration', mod: calibration, nav: 'Calibration & QA' },
  { key: 'quality', mod: quality, nav: 'Data quality' },
  { key: 'registry', mod: registry, nav: 'Registry & evidence' },
  { key: 'export', mod: exportPage, nav: 'Export' },
];

const $ = (sel) => document.querySelector(sel);
const main = $('#main');
const dialog = $('#src-dialog');

const store = {
  get(key) {
    try { return localStorage.getItem(`lake-dash:${key}`); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(`lake-dash:${key}`, value); } catch { /* storage unavailable */ }
  },
};

const state = {
  cfg: null,
  source: null,
  snapshot: null,
  model: null,
  error: null,
  loadedAt: null,
  rangeKey: null,
  showBad: store.get('showBad') === '1',
  exportSensors: null,
};

function currentPage() {
  const key = location.hash.replace(/^#\/?/, '') || 'overview';
  return PAGES.find((p) => p.key === key) ?? PAGES[0];
}

function chartWidth() {
  return Math.max(280, Math.min(main.clientWidth, 1180) - 34);
}

function renderChrome(page) {
  $('#nav').innerHTML = PAGES.map((p) => `<li><a href="#${p.key}"${p === page ? ' aria-current="page"' : ''}>${esc(p.nav)}</a></li>`).join('');
  const bar = $('#rangebar');
  if (page.mod.usesRange) {
    bar.hidden = false;
    bar.innerHTML = '<span class="rangebar-label" id="range-label">Time range</span><div class="segmented" role="group" aria-labelledby="range-label">'
      + RANGES.map((r) => `<button type="button" data-range="${r.key}" aria-pressed="${r.key === state.rangeKey}">${esc(r.label)}</button>`).join('')
      + '</div>';
  } else {
    bar.hidden = true;
    bar.innerHTML = '';
  }

  const m = state.model;
  const tz = state.cfg.timezoneLabel ?? state.cfg.timezone;
  const sourceLabel = state.source.path ? `Data API: ${state.source.path}` : 'No data API configured';
  const updated = state.loadedAt ? new Intl.DateTimeFormat('en-GB', { timeZone: state.cfg.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(state.loadedAt) : '—';
  $('#status').innerHTML = `<span class="source-badge source-${state.source.kind}">${esc(sourceLabel)}</span>`
    + `<span class="muted">Updated ${esc(updated)} ${esc(tz)} · refresh ${esc(state.cfg.refreshSeconds)} s</span>`;
  $('#global-banner').innerHTML = m?.synthetic
    ? '<div class="banner banner-synthetic" role="note"><p class="banner-title"><span class="flag-ico" aria-hidden="true">!</span>Synthetic data</p>'
      + '<p>Some rows in this data are marked is_synthetic = true. They are not measurements from the lake.</p></div>'
    : '';
}

function render() {
  const page = currentPage();
  document.title = `${page.mod.title} · Lake Prototype Monitor`;
  if (state.error && !state.snapshot) {
    main.innerHTML = state.notConfigured
      ? '<section class="page-head"><h1>Not connected</h1></section>'
        + '<div class="empty"><p class="empty-title">No data source is connected yet</p>'
        + '<p class="empty-body">The dashboard reads everything (sensors, readings, calibrations, flags) from the read-only data API. '
        + 'Set <code>apiBase</code> in <code>dashboard/config.json</code> to the API address, for example <code>/api</code> or <code>http://localhost:3000/api</code>, then reload. '
        + 'The expected response is described in <code>dashboard/API.md</code>.</p></div>'
      : `<div class="banner banner-bad" role="alert"><p class="banner-title">Could not load data</p><p>${esc(state.error)}</p></div>`;
    renderChrome(page);
    return;
  }
  if (!state.snapshot) return;

  const openDetails = [...main.querySelectorAll('details')].map((d) => d.open);
  const scroll = window.scrollY;
  resetCharts();
  state.model = buildModel(state.snapshot, state.cfg, { now: Date.now(), rangeKey: state.rangeKey });
  main.innerHTML = page.mod.render(state.model, { width: chartWidth(), showBad: state.showBad, exportSensors: state.exportSensors })
    + (state.error ? `<p class="muted">Last refresh failed: ${esc(state.error)}. Showing the previous data.</p>` : '');
  main.querySelectorAll('details').forEach((d, i) => {
    if (openDetails[i]) {
      d.open = true;
      fillTable(d);
    }
  });
  window.scrollTo(0, scroll);
  renderChrome(page);
}

async function refresh() {
  const page = currentPage();
  const now = Date.now();
  const range = page.mod.usesRange ? rangeFor(state.rangeKey, now) : { from: now - 86400e3, to: now };
  main.classList.add('is-loading');
  try {
    const snap = await state.source.load(range);
    if (snap) {
      state.snapshot = snap;
      state.loadedAt = Date.now();
      state.error = null;
    }
  } catch (err) {
    state.error = err.message;
    state.notConfigured = err instanceof NotConfiguredError;
  } finally {
    main.classList.remove('is-loading');
  }
  render();
}

function navigate() {
  if (state.source.kind === 'api') refresh();
  else render();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function fillTable(details) {
  const id = details.dataset.table;
  const slot = details.querySelector('.table-slot');
  if (id && slot && !slot.childElementCount) slot.innerHTML = tableHtml(id);
}

function openSource(ref) {
  if (!state.model) return;
  const src = sourceHtml(state.model, ref);
  if (!src) return;
  $('#src-title').textContent = src.title;
  $('#src-body').innerHTML = src.html;
  if (!dialog.open) dialog.showModal();
}

function downloadCsv() {
  const m = state.model;
  const ids = state.exportSensors ?? m.snap.sensors.filter((s) => s.installed || m.readingsBySensor.has(s.sensor_id)).map((s) => s.sensor_id);
  const csv = exportPage.buildCsv(m, ids);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lake-readings_${m.range.key}_${new Date(m.now).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function hideTip(body) {
  const tip = body?.querySelector('.tip');
  if (tip) tip.hidden = true;
  body?.querySelector('.xhair')?.setAttribute('visibility', 'hidden');
}

function onPointerMove(ev) {
  const hit = ev.target.closest?.('.hit');
  if (!hit) return;
  const svg = hit.ownerSVGElement;
  const body = svg.parentElement;
  const rect = svg.getBoundingClientRect();
  const scale = svg.viewBox.baseVal.width / rect.width;
  const info = hoverAt(hit.dataset.chart, (ev.clientX - rect.left) * scale);
  if (!info) {
    hideTip(body);
    delete hit.dataset.ref;
    return;
  }
  const xhair = svg.querySelector('.xhair');
  xhair.setAttribute('x1', info.x);
  xhair.setAttribute('x2', info.x);
  xhair.setAttribute('visibility', 'visible');
  const tip = body.querySelector('.tip');
  tip.innerHTML = info.html;
  tip.hidden = false;
  const px = info.x / scale;
  const w = tip.offsetWidth;
  let left = px + 12;
  if (left + w > rect.width) left = px - w - 12;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = '8px';
  hit.dataset.ref = info.ref;
}

function bindEvents() {
  window.addEventListener('hashchange', navigate);
  document.addEventListener('click', (ev) => {
    const range = ev.target.closest('[data-range]');
    if (range) {
      state.rangeKey = range.dataset.range;
      store.set('range', state.rangeKey);
      if (state.source.kind === 'api') refresh();
      else render();
      return;
    }
    const src = ev.target.closest('[data-src]');
    if (src) {
      openSource(src.dataset.src);
      return;
    }
    const hit = ev.target.closest('.hit');
    if (hit?.dataset.ref) {
      openSource(hit.dataset.ref);
      return;
    }
    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (action === 'download-csv') downloadCsv();
    if (action === 'close-dialog') dialog.close();
  });
  document.addEventListener('change', (ev) => {
    const action = ev.target.dataset?.action;
    if (action === 'toggle-bad') {
      state.showBad = ev.target.checked;
      store.set('showBad', state.showBad ? '1' : '0');
      render();
    } else if (action === 'export-sensor') {
      state.exportSensors = [...main.querySelectorAll('[data-action="export-sensor"]:checked')].map((el) => Number(el.value));
      render();
    }
  });
  document.addEventListener('toggle', (ev) => {
    if (ev.target.matches?.('details[data-table]') && ev.target.open) fillTable(ev.target);
  }, true);
  main.addEventListener('pointermove', onPointerMove);
  main.addEventListener('pointerout', (ev) => {
    if (ev.target.classList?.contains('hit')) hideTip(ev.target.ownerSVGElement.parentElement);
  });
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });
  let resizeTimer;
  let lastWidth = main.clientWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (main.clientWidth !== lastWidth) {
        lastWidth = main.clientWidth;
        render();
      }
    }, 200);
  });
}

async function boot() {
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
    state.cfg = { refreshSeconds: 60, timezone: 'Asia/Kolkata', timezoneLabel: 'IST', ...(await res.json()) };
  } catch (err) {
    main.innerHTML = `<div class="banner banner-bad" role="alert"><p class="banner-title">Could not load configuration</p><p>${esc(err.message)}</p></div>`;
    return;
  }
  const savedRange = store.get('range');
  state.rangeKey = RANGES.some((r) => r.key === savedRange) ? savedRange : state.cfg.defaultRange ?? '7d';
  state.source = createSource(state.cfg);
  bindEvents();
  await refresh();
  setInterval(() => {
    if (!document.hidden && !dialog.open) refresh();
  }, Math.max(10, Number(state.cfg.refreshSeconds) || 60) * 1000);
}

boot();
