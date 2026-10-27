import {
  esc, fmtValue, fmtSeconds, flagChips, srcButton, emptyState, unknown,
} from '../lib/format.js';
import { PARAMS, toPoints } from '../lib/model.js';
import { timeChart } from '../lib/chart.js';

export const title = 'Water chemistry';
export const usesRange = true;

export const TDS_LABEL = 'Estimated TDS (from conductivity)';

export function render(m, ui) {
  const tdsSensor = m.sensorFor('tds_ec');
  const tempSensor = m.sensorFor('water_temperature');
  const { from, to } = m.range;
  const cal = tdsSensor ? m.calibrationAt(tdsSensor.sensor_id) : { status: 'none', record: null };
  const rec = cal.record;
  const refT = rec?.reference_temp_c ?? 25;
  const common = { from, to, time: m.time, gapMs: m.gapMs, sevMap: m.sevMap, descMap: m.descMap, width: ui.width, showBad: ui.showBad };

  const info = '<section class="card method-card"><h2 class="card-title">How these values are derived</h2>'
    + `<p>${esc(TDS_LABEL)} = EC compensated to ${esc(refT)} °C × the stored conversion factor. It is an estimate from conductivity. It is not a contaminant test and not laboratory TDS.</p>`
    + '<div class="kv">'
    + `<div><span class="k">Conversion factor</span><span class="v">${rec?.conversion_factor != null ? srcButton(esc(rec.conversion_factor), `c:${rec.calibration_id}`) : '<span class="unknown">Unknown: none stored, so TDS is not computed</span>'}</span></div>`
    + `<div><span class="k">Temperature coefficient</span><span class="v">${rec?.temp_coeff_per_c != null ? `${srcButton(esc(rec.temp_coeff_per_c), `c:${rec.calibration_id}`)} per °C` : '<span class="unknown">Unknown: none stored, so EC is not compensated</span>'}</span></div>`
    + `<div><span class="k">Reference temperature</span><span class="v">${esc(refT)} °C${rec ? '' : ' (default)'}</span></div>`
    + `<div><span class="k">Stale temperature limit</span><span class="v">${esc(tdsSensor?.stale_after_minutes ?? 30)} min</span></div>`
    + '</div></section>';

  const ecRows = tdsSensor ? m.readings(tdsSensor.sensor_id) : [];
  const ecCorrected = ecRows.some((r) => r.corrected_value != null);
  const ecUnit = ecCorrected ? ecRows.find((r) => r.corrected_value != null)?.corrected_unit : ecRows[ecRows.length - 1]?.raw_unit;
  const ecChart = timeChart({
    ...common,
    title: ecCorrected ? 'EC, calibrated, not temperature-compensated' : 'EC, raw, not temperature-compensated',
    unit: ecUnit,
    series: [{ label: 'EC', cls: PARAMS.tds_ec.cls, unit: ecUnit, points: toPoints(m, ecRows, (r) => (ecCorrected ? r.corrected_value : r.raw_value)) }],
    emptyText: 'No EC readings in this range.',
  });

  const ec25 = m.derived('ec_uS_cm_25c');
  const ec25Chart = timeChart({
    ...common,
    title: `EC compensated to ${refT} °C`,
    unit: 'µS/cm',
    series: [{ label: `EC at ${refT} °C`, cls: PARAMS.tds_ec.cls, unit: 'µS/cm', points: toPoints(m, ec25, (d) => d.value, 'd', 'derived_id') }],
    emptyText: 'No compensated EC in this range',
    emptyBody: rec?.temp_coeff_per_c == null ? 'No temperature coefficient is stored for the TDS/EC sensor, so EC is not compensated.' : 'Compensation needs a valid water temperature within the stale limit.',
  });

  const tds = m.derived('tds_est_mg_l');
  const tdsChart = timeChart({
    ...common,
    title: `${TDS_LABEL}${rec?.conversion_factor != null ? `, factor ${rec.conversion_factor}` : ''}`,
    unit: 'mg/L',
    series: [{ label: TDS_LABEL, cls: PARAMS.tds_ec.cls, unit: 'mg/L', points: toPoints(m, tds, (d) => d.value, 'd', 'derived_id') }],
    emptyText: 'Estimated TDS not computed',
    emptyBody: rec?.conversion_factor == null ? 'No conversion factor is stored. TDS is only computed from compensated EC and a documented factor.' : 'No compensated EC values in this range.',
  });

  const tempRows = tempSensor ? m.readings(tempSensor.sensor_id) : [];
  const tempChart = timeChart({
    ...common,
    title: 'Water temperature',
    unit: '°C',
    series: [{ label: 'Water temperature', cls: PARAMS.water_temperature.cls, unit: '°C', points: toPoints(m, tempRows, (r) => r.corrected_value ?? r.raw_value) }],
    emptyText: 'No water temperature readings in this range.',
  });

  const compRows = [...ec25].sort((a, b) => b._t - a._t).slice(0, 50);
  const compTable = compRows.length
    ? '<div class="table-wrap"><table><thead><tr><th>Time</th><th>EC source reading</th><th>Temperature reading used</th><th>Temperature age</th><th>EC at ref.</th><th>Flag</th><th>Method</th></tr></thead><tbody>'
      + compRows.map((d) => {
        const src = m.readingById.get(d.source_reading_id);
        const temp = d.temp_reading_id != null ? m.readingById.get(d.temp_reading_id) : null;
        return `<tr><td>${esc(m.time.dateTime(d._t))}</td>`
          + `<td class="num">${src ? srcButton(`${esc(fmtValue(src.raw_value, src.raw_unit))} ${esc(src.raw_unit)}`, `r:${src.reading_id}`) : esc(d.source_reading_id)}</td>`
          + `<td class="num">${temp ? srcButton(`${esc(fmtValue(temp.corrected_value ?? temp.raw_value, '°C'))} °C`, `r:${temp.reading_id}`) : unknown(null)}</td>`
          + `<td class="num">${esc(fmtSeconds(d.temp_age_s))}</td>`
          + `<td class="num">${d.value != null ? srcButton(esc(fmtValue(d.value, d.unit)), `d:${d.derived_id}`) : '<span class="unknown">Not compensated</span>'}</td>`
          + `<td>${flagChips(m.flags(d), m.sevMap, m.descMap)}</td><td>${esc(d.method_note)}</td></tr>`;
      }).join('')
      + '</tbody></table></div>'
    : emptyState('No temperature compensations recorded in this range', 'Each compensation lists the temperature reading it used and how old that reading was.');

  return '<section class="page-head"><h1>Water chemistry</h1>'
    + `<p class="muted">Conductivity and water temperature on a shared time axis, last ${esc(m.range.label)}.</p></section>`
    + info
    + `<div class="stack">${ecChart}${ec25Chart}${tdsChart}${tempChart}</div>`
    + `<section class="card"><h2 class="card-title">Temperature used for each compensation</h2>${compTable}</section>`;
}
