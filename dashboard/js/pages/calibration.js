import { esc, srcButton, emptyState, unknown } from '../lib/format.js';
import { CHANNELS, PARAMS } from '../lib/model.js';

export const title = 'Calibration and QA';

export const TEST_TYPES = [
  ['identity_wiring', 'Identity and wiring'],
  ['calibration', 'Calibration'],
  ['repeatability', 'Repeatability'],
  ['accuracy', 'Accuracy'],
  ['interference', 'Interference'],
  ['time_alignment', 'Time alignment'],
  ['field_robustness', 'Field robustness'],
  ['failure_detection', 'Failure detection'],
];

const RESULT = {
  not_run: { text: 'Not run', sev: 'none', icon: '–' },
  pass: { text: 'Pass', sev: 'ok', icon: '✓' },
  fail: { text: 'Fail', sev: 'bad', icon: '✕' },
  partial: { text: 'Partial', sev: 'warn', icon: '!' },
};

const STATUS = {
  none: { text: 'Never calibrated', sev: 'warn', icon: '!' },
  expired: { text: 'Calibration expired', sev: 'warn', icon: '!' },
  valid: { text: 'Valid', sev: 'ok', icon: '✓' },
  no_expiry: { text: 'Valid, no expiry recorded', sev: 'ok', icon: '✓' },
};

const v = (x) => unknown(x);

function safeUri(uri) {
  if (!uri) return '';
  try {
    const u = new URL(uri);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

function sensorCard(m, param) {
  const P = PARAMS[param];
  const sensor = m.sensorFor(param);
  if (!sensor) return '';
  const cal = m.calibrationAt(sensor.sensor_id);
  const st = STATUS[cal.status];
  const rec = cal.record;
  const history = m.calsBySensor.get(sensor.sensor_id) ?? [];
  const days = rec ? Math.floor((m.now - rec._t) / 86400e3) : null;
  const status = `<span class="flag flag-${st.sev}"><span class="flag-ico" aria-hidden="true">${st.icon}</span>${st.text}</span>`;

  const body = rec
    ? '<div class="kv">'
      + `<div><span class="k">Latest version</span><span class="v">${srcButton(`v${esc(rec.version)}`, `c:${rec.calibration_id}`)}</span></div>`
      + `<div><span class="k">Calibrated</span><span class="v">${esc(m.time.dateTime(rec._t))} (${days} day${days === 1 ? '' : 's'} ago)</span></div>`
      + `<div><span class="k">Valid until</span><span class="v">${rec._until != null ? esc(m.time.dateTime(rec._until)) : '<span class="unknown">Not recorded</span>'}</span></div>`
      + `<div><span class="k">Method</span><span class="v">${v(rec.method)}</span></div>`
      + `<div><span class="k">Standards used</span><span class="v">${v(rec.standards_used)}</span></div>`
      + `<div><span class="k">Slope</span><span class="v">${v(rec.slope)}</span></div>`
      + `<div><span class="k">Offset</span><span class="v">${v(rec.offset_value)}</span></div>`
      + (param === 'tds_ec' ? `<div><span class="k">Conversion factor</span><span class="v">${v(rec.conversion_factor)}</span></div>`
        + `<div><span class="k">Temperature coefficient</span><span class="v">${v(rec.temp_coeff_per_c)}</span></div>`
        + `<div><span class="k">Reference temperature</span><span class="v">${v(rec.reference_temp_c)} °C</span></div>` : '')
      + `<div><span class="k">Reference instrument</span><span class="v">${v(rec.reference_instrument)}</span></div>`
      + `<div><span class="k">Before / after</span><span class="v">${v(rec.before_value)} / ${v(rec.after_value)}</span></div>`
      + `<div><span class="k">Performed by</span><span class="v">${v(rec.performed_by)}</span></div>`
      + '</div>'
    : emptyState('No calibration record loaded', 'Slope, offset and validity are Unknown until a calibration record is entered. Days since last calibration: not applicable.');

  const histTable = history.length > 1
    ? '<details><summary>Calibration history</summary><div class="table-wrap"><table><thead><tr><th>Version</th><th>Date</th><th>Method</th><th>Slope</th><th>Offset</th><th>Valid until</th></tr></thead><tbody>'
      + [...history].reverse().map((c) => `<tr><td>${srcButton(`v${esc(c.version)}`, `c:${c.calibration_id}`)}</td><td>${esc(m.time.dateTime(c._t))}</td><td>${v(c.method)}</td>`
        + `<td class="num">${v(c.slope)}</td><td class="num">${v(c.offset_value)}</td><td>${c._until != null ? esc(m.time.dateTime(c._until)) : '<span class="unknown">Not recorded</span>'}</td></tr>`).join('')
      + '</tbody></table></div></details>'
    : '';

  return `<article class="card cal-card"><header class="tile-head"><span class="key-dot ${P.cls}" aria-hidden="true"></span><h2>${esc(P.label)}</h2>${status}</header>${body}${histTable}</article>`;
}

function grid(m) {
  const tests = m.snap.acceptance_tests;
  if (!tests.length) return emptyState('No acceptance tests registered');
  const sensorIds = [...new Set(tests.map((t) => t.sensor_id))];
  const head = `<tr><th scope="col">Sensor</th>${TEST_TYPES.map(([, label]) => `<th scope="col">${esc(label)}</th>`).join('')}</tr>`;
  const rows = sensorIds.map((sid) => {
    const sensor = sid == null ? null : m.sensorById.get(sid);
    const name = sensor ? PARAMS[sensor.parameter]?.label ?? sensor.parameter : 'System level';
    const cells = TEST_TYPES.map(([type]) => {
      const t = tests.find((x) => x.sensor_id === sid && x.test_type === type);
      if (!t) return '<td><span class="unknown">Not registered</span></td>';
      const r = RESULT[t.result] ?? RESULT.not_run;
      const uri = safeUri(t.evidence_uri);
      return `<td><span class="result result-${r.sev}"><span aria-hidden="true">${r.icon}</span> ${r.text}</span>`
        + (t._t ? `<span class="muted small">${esc(m.time.day(t._t))}</span>` : '')
        + (uri ? ` <a href="${esc(uri)}" target="_blank" rel="noopener noreferrer">evidence</a>` : '')
        + '</td>';
    }).join('');
    return `<tr><th scope="row">${esc(name)}</th>${cells}</tr>`;
  }).join('');
  const run = tests.filter((t) => t.result !== 'not_run').length;
  const pass = tests.filter((t) => t.result === 'pass').length;
  return `<p class="muted">${run} of ${tests.length} tests run, ${pass} passed.</p>`
    + `<div class="table-wrap"><table class="grid-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

export function render(m) {
  return '<section class="page-head"><h1>Calibration and QA</h1>'
    + '<p class="muted">Calibration state and acceptance testing for each installed sensor. A sensor can only be marked verified once a calibration record or datasheet evidence is loaded.</p></section>'
    + `<div class="cards-2">${CHANNELS.map((p) => sensorCard(m, p)).join('')}</div>`
    + `<section class="card"><h2 class="card-title">Acceptance tests</h2>${grid(m)}</section>`;
}
