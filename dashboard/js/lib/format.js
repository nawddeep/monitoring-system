// Formatting, escaping and quality-flag helpers.
// DOM-free so every page can be rendered to a string in Node tests.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export const UNKNOWN = 'Unknown';

const UNIT_LABEL = {
  'uS/cm': 'µS/cm', 'us/cm': 'µS/cm', 'µS/cm': 'µS/cm',
  degC: '°C', C: '°C', '°C': '°C',
  'mg/L': 'mg/L', mg_l: 'mg/L', ppm: 'ppm',
  m: 'm', cm: 'cm', mm: 'mm', V: 'V', mV: 'mV', pH: 'pH', counts: 'ADC counts',
};

export function unitLabel(unit) {
  if (!unit) return '';
  return UNIT_LABEL[unit] ?? unit;
}

const DIGITS = { pH: 2, '°C': 2, 'µS/cm': 0, 'mg/L': 0, ppm: 0, m: 3, cm: 1, mm: 0, V: 3, mV: 0, 'ADC counts': 0 };

export function digitsFor(unit) {
  return DIGITS[unitLabel(unit)] ?? 2;
}

/** Formats a number for its unit; returns null when there is no value. */
export function fmtValue(value, unit) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  const d = digitsFor(unit);
  return Number(value).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtCount(n) {
  return Number(n).toLocaleString('en-GB');
}

export function fmtPct(part, whole) {
  if (!whole) return '—';
  return `${((100 * part) / whole).toFixed(1)}%`;
}

/** "4 min", "2 h 5 min", "3 d 4 h". */
export function fmtAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return UNKNOWN;
  const neg = ms < 0;
  let s = Math.round(Math.abs(ms) / 1000);
  let out;
  if (s < 60) out = `${s} s`;
  else if (s < 3600) out = `${Math.round(s / 60)} min`;
  else if (s < 48 * 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    out = m ? `${h} h ${m} min` : `${h} h`;
  } else {
    const d = Math.floor(s / 86400);
    const h = Math.round((s % 86400) / 3600);
    out = h ? `${d} d ${h} h` : `${d} d`;
  }
  return neg ? `in ${out}` : out;
}

export function fmtSeconds(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return UNKNOWN;
  return Math.abs(sec) < 600 ? `${Number(sec).toFixed(0)} s` : fmtAge(sec * 1000);
}

/** Time formatting in the configured display zone; storage stays UTC. */
export function makeTime(timeZone, label) {
  const opts = { timeZone, hour12: false };
  const dateTime = new Intl.DateTimeFormat('en-GB', { ...opts, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const full = new Intl.DateTimeFormat('en-GB', { ...opts, year: 'numeric', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const day = new Intl.DateTimeFormat('en-GB', { ...opts, day: 'numeric', month: 'short' });
  const hm = new Intl.DateTimeFormat('en-GB', { ...opts, hour: '2-digit', minute: '2-digit' });
  const key = new Intl.DateTimeFormat('en-CA', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = new Intl.DateTimeFormat('en-US', { ...opts, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const offsetCache = new Map();

  function offsetMs(ms) {
    const hour = Math.floor(ms / 3600000);
    if (offsetCache.has(hour)) return offsetCache.get(hour);
    const p = Object.fromEntries(parts.formatToParts(hour * 3600000).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    const off = asUtc - hour * 3600000;
    offsetCache.set(hour, off);
    return off;
  }

  return {
    label,
    dateTime: (ms) => (ms == null ? UNKNOWN : `${dateTime.format(ms)} ${label}`),
    full: (ms) => (ms == null ? UNKNOWN : `${full.format(ms)} ${label}`),
    day: (ms) => day.format(ms),
    hm: (ms) => hm.format(ms),
    dayKey: (ms) => key.format(ms),
    offsetMs,
  };
}

export function isoUtc(ms) {
  return ms == null ? '' : new Date(ms).toISOString();
}

// ---- Quality flags -------------------------------------------------------

/** Priority when several flags apply (index 0 wins). */
export const FLAG_PRIORITY = [
  'DISCONNECTED', 'ECHO_OUT_OF_RANGE', 'OUT_OF_RANGE', 'UNREALISTIC_JUMP', 'STALE_TEMP',
  'NO_CAL_FOR_UNIT', 'CAL_EXPIRED', 'UNCALIBRATED', 'CLOCK_UNSYNCED', 'OK',
];

export const FLAG_TEXT = {
  OK: 'OK',
  DISCONNECTED: 'Disconnected',
  ECHO_OUT_OF_RANGE: 'Echo out of range',
  OUT_OF_RANGE: 'Out of range',
  UNREALISTIC_JUMP: 'Unrealistic jump',
  STALE_TEMP: 'Stale temperature',
  NO_CAL_FOR_UNIT: 'No calibration for unit',
  CAL_EXPIRED: 'Calibration expired',
  UNCALIBRATED: 'Uncalibrated',
  CLOCK_UNSYNCED: 'Clock unsynced',
};

const DEFAULT_SEVERITY = {
  OK: 'ok', DISCONNECTED: 'bad', ECHO_OUT_OF_RANGE: 'bad', OUT_OF_RANGE: 'bad', UNREALISTIC_JUMP: 'bad',
  STALE_TEMP: 'warn', NO_CAL_FOR_UNIT: 'warn', CAL_EXPIRED: 'warn', UNCALIBRATED: 'warn', CLOCK_UNSYNCED: 'warn',
};

const SEVERITY_RANK = { ok: 0, warn: 1, bad: 2 };
const SEVERITY_ICON = { ok: '✓', warn: '!', bad: '✕' };
export const SEVERITY_TEXT = { ok: 'OK', warn: 'Warning', bad: 'Bad' };

export function sortFlags(flags) {
  const rank = (f) => {
    const i = FLAG_PRIORITY.indexOf(f);
    return i === -1 ? FLAG_PRIORITY.length : i;
  };
  return [...new Set(flags)].sort((a, b) => rank(a) - rank(b));
}

/** All flags on a row: the `flags` array when present, otherwise the single quality_flag. */
export function flagsOf(row) {
  const list = Array.isArray(row?.flags) && row.flags.length ? row.flags : [row?.quality_flag || 'OK'];
  const sorted = sortFlags(list);
  return sorted.length > 1 ? sorted.filter((f) => f !== 'OK') : sorted;
}

export function severityOf(code, sevMap) {
  return sevMap?.[code] ?? DEFAULT_SEVERITY[code] ?? 'warn';
}

export function worstSeverity(flags, sevMap) {
  return flags.reduce((worst, f) => {
    const s = severityOf(f, sevMap);
    return SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst;
  }, 'ok');
}

export function severityIcon(sev) {
  return SEVERITY_ICON[sev] ?? '?';
}

export function flagChip(code, sevMap, descMap) {
  const sev = severityOf(code, sevMap);
  const desc = descMap?.[code];
  return `<span class="flag flag-${sev}"${desc ? ` title="${esc(desc)}"` : ''}>`
    + `<span class="flag-ico" aria-hidden="true">${SEVERITY_ICON[sev]}</span>`
    + `<span class="visually-hidden">${SEVERITY_TEXT[sev]}: </span>${esc(FLAG_TEXT[code] ?? code)}</span>`;
}

export function flagChips(flags, sevMap, descMap) {
  return `<span class="flags">${flags.map((f) => flagChip(f, sevMap, descMap)).join('')}</span>`;
}

/** A clickable number that opens its source row. ref is "r:12", "d:3", "c:1", "m:7", "l:2". */
export function srcButton(html, ref, cls = '') {
  return `<button type="button" class="src ${cls}" data-src="${esc(ref)}" title="Show source row">${html}</button>`;
}

export function unknown(value) {
  return value == null || value === '' ? `<span class="unknown">${UNKNOWN}</span>` : esc(value);
}

export function evidenceChip(status) {
  const text = { verified: 'Verified', user_reported: 'User-reported', unverified: 'Unverified' }[status] ?? status;
  return `<span class="evidence evidence-${esc(status)}">${esc(text)}</span>`;
}

export function emptyState(title, body = '') {
  return `<div class="empty"><p class="empty-title">${esc(title)}</p>${body ? `<p class="empty-body">${body}</p>` : ''}</div>`;
}
