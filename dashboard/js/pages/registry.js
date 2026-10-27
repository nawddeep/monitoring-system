import { esc, unknown, evidenceChip, fmtValue } from '../lib/format.js';
import { PARAMS } from '../lib/model.js';

export const title = 'Sensor registry and evidence';

export const NOT_MEASURED = [
  'Nitrate',
  'Ammonia',
  'Phosphate',
  'Chlorophyll-a or phycocyanin',
  'BOD / COD',
  'Microbiological indicators (for example E. coli)',
];

const NO_SPEC_REASON = {
  water_level: 'Not linked. The vendor 0 to 20 m level claim describes the vendor\'s own sensor and is not the JSN-SR04T range.',
  tds_ec: 'None. The vendor document does not list TDS.',
};

const SCALE_NOTE = {
  turbidity: 'If readings ever arrive they stay on the vendor 0 to 100 % scale, labelled "vendor scale". No NTU/FNU conversion without a stored conversion curve.',
  dissolved_oxygen: 'If readings ever arrive they need an explicit unit (% saturation or mg/L) before charting. No mg/L conversion without a stored conversion curve.',
};

function range(min, max, unit) {
  if (min == null && max == null) return null;
  const u = unit ? ` ${unit}` : '';
  return `${min ?? '?'} to ${max ?? '?'}${u}`;
}

function unknownFields(m, s) {
  const out = [];
  if (!s.model_text) out.push('model / part number');
  if (!s.accuracy_text) out.push('accuracy');
  out.push('resolution', 'response time');
  if (s.valid_min == null || s.valid_max == null) out.push('plausibility limits');
  if (s.max_jump_per_cycle == null) out.push('jump limit');
  if (s.installed && m.calibrationAt(s.sensor_id).status === 'none') out.push('calibration');
  if (s.evidence_status !== 'verified') out.push('verified identity');
  return out;
}

function sensorCard(m, s) {
  const P = PARAMS[s.parameter] ?? { label: s.parameter, cls: 'p-none' };
  const ctrl = m.controllerOf(s);
  const spec = s.vendor_spec_id != null ? m.specById.get(s.vendor_spec_id) : null;
  const vendor = spec
    ? `<span class="vendor-claim">Vendor claim</span> ${esc(range(spec.range_min, spec.range_max, spec.unit))}<span class="muted small">${esc(spec.caveat)} (${esc(spec.source_ref)})</span>`
    : `<span class="muted">${esc(NO_SPEC_REASON[s.parameter] ?? 'None linked.')}</span>`;
  const limits = range(s.valid_min, s.valid_max, '');
  const installed = s.installed
    ? '<span class="flag flag-ok"><span class="flag-ico" aria-hidden="true">✓</span>Installed (user-reported)</span>'
    : '<span class="flag flag-none"><span class="flag-ico" aria-hidden="true">–</span>Not installed</span>';
  const unknowns = unknownFields(m, s);
  return `<article class="card sensor-card${s.installed ? '' : ' not-installed'}">`
    + `<header class="tile-head"><span class="key-dot ${P.cls}" aria-hidden="true"></span><h2>${esc(P.label)}</h2>${installed}</header>`
    + '<div class="kv">'
    + `<div><span class="k">Controller</span><span class="v">${ctrl ? `Controller ${esc(ctrl.name)} (${esc(ctrl.role)})` : '<span class="muted">None</span>'}</span></div>`
    + `<div><span class="k">Model</span><span class="v">${unknown(s.model_text)}</span></div>`
    + `<div><span class="k">Evidence status</span><span class="v">${evidenceChip(s.evidence_status)}</span></div>`
    + `<div><span class="k">Vendor range</span><span class="v">${vendor}</span></div>`
    + `<div><span class="k">Plausibility limits (engineer)</span><span class="v">${limits ? esc(limits) : '<span class="unknown">Limits not set</span>'}</span></div>`
    + `<div><span class="k">Jump limit per cycle</span><span class="v">${s.max_jump_per_cycle != null ? esc(s.max_jump_per_cycle) : '<span class="unknown">Not set</span>'}</span></div>`
    + `<div><span class="k">Stale after</span><span class="v">${esc(s.stale_after_minutes ?? 30)} min</span></div>`
    + `<div><span class="k">Accuracy</span><span class="v">${unknown(s.accuracy_text)}</span></div>`
    + '<div><span class="k">Resolution</span><span class="v"><span class="unknown">Unknown</span></span></div>'
    + '<div><span class="k">Response time</span><span class="v"><span class="unknown">Unknown</span></span></div>'
    + `<div><span class="k">Notes</span><span class="v">${unknown(s.notes)}</span></div>`
    + '</div>'
    + (SCALE_NOTE[s.parameter] ? `<p class="muted">${esc(SCALE_NOTE[s.parameter])}</p>` : '')
    + `<p class="unknown-list"><strong>Unknown or missing:</strong> ${esc(unknowns.join(', '))}.</p>`
    + '</article>';
}

function controllersTable(m) {
  const rows = m.snap.controllers.map((c) => `<tr><th scope="row">${esc(c.name)}</th><td>${esc(c.role)}</td>`
    + `<td>${unknown(c.board_model_claimed)} <span class="muted small">user statement</span></td>`
    + `<td>${unknown(c.board_model_seen)} <span class="muted small">from photos</span></td>`
    + `<td>${c.chip_verified ? 'Verified' : '<span class="unknown">Unverified</span>'}</td>`
    + `<td>${c.adc_input_max_v != null ? `${esc(fmtValue(c.adc_input_max_v, 'V'))} V` : unknown(null)}</td>`
    + `<td>${c.clock_synced ? 'Synced' : '<span class="unknown">Not synced</span>'}</td>`
    + `<td>${unknown(c.notes)}</td></tr>`).join('');
  return '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Board claimed</th><th>Board seen</th><th>Chip</th><th>ADC input max</th><th>Clock</th><th>Notes</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`;
}

function vendorTable(m) {
  const rows = m.snap.vendor_spec.map((v) => `<tr><td>${esc(v.parameter)}</td><td><span class="vendor-claim">Vendor claim</span> ${esc(range(v.range_min, v.range_max, v.unit))}</td>`
    + `<td>${esc(v.sampling_min_minutes)} min to ${esc(v.sampling_max_minutes / 60)} h, default ${esc(v.sampling_default_min)} min</td>`
    + `<td>${esc(v.caveat)}</td><td>${esc(v.source_ref)}</td></tr>`).join('');
  return '<p class="muted">The vendor document describes a five-sensor suite (temperature, pH, turbidity, level, dissolved oxygen) that differs from the installed prototype. These figures are product claims, not properties of the installed hardware.</p>'
    + '<div class="table-wrap"><table><thead><tr><th>Parameter</th><th>Range</th><th>Sampling</th><th>Caveat</th><th>Source</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`;
}

export function render(m) {
  const sensors = [...m.snap.sensors].sort((a, b) => Number(b.installed) - Number(a.installed) || a.sensor_id - b.sensor_id);
  return '<section class="page-head"><h1>Sensor registry and evidence</h1>'
    + '<p class="muted">What is installed, what is known about it, and what is still unknown. Unknown values are stored as NULL and never estimated.</p></section>'
    + `<div class="cards-2">${sensors.map((s) => sensorCard(m, s)).join('')}</div>`
    + `<section class="card"><h2 class="card-title">Controllers</h2>${controllersTable(m)}</section>`
    + `<section class="card"><h2 class="card-title">Vendor suite (different hardware)</h2>${vendorTable(m)}</section>`
    + '<section class="card"><h2 class="card-title">Not measured</h2>'
    + '<p>This prototype does not measure the following. None of them can be inferred from the four installed channels.</p>'
    + `<ul class="not-measured">${NOT_MEASURED.map((x) => `<li>${esc(x)}<span class="muted"> · not measured</span></li>`).join('')}</ul>`
    + '<p class="muted">BOD and E. coli need laboratory methods. Estimated TDS on this dashboard is derived from conductivity and is not a contaminant test.</p></section>';
}
