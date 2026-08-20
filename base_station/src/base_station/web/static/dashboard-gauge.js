const DIAL_START_DEG = 135;
const DIAL_SPAN_DEG = 270;
const DIAL_RADIUS = 37;
const DIAL_CENTER = 50;

const DEFAULT_GAUGE = {
  type: 'dial-filled',
  showValue: true,
  showUnits: true,
  showRange: true,
  min: 0,
  low: 10,
  high: 90,
  max: 100,
};

/** Create one self-contained dashboard gauge. */
export function createGauge(signal) {
  const gauge = normalizeGauge(signal.config?.gauge);
  const root = document.createElement('div');
  root.className = 'dashboard-gauge';
  root.dataset.gaugeType = gauge.type;
  root.setAttribute('role', 'meter');
  root.setAttribute('aria-label', `${signal.config?.label ?? 'Signal'} gauge`);

  if (gauge.type.startsWith('dial-')) root.append(createDial(gauge));
  else root.append(createMeter(gauge));

  const readout = document.createElement('div');
  readout.className = 'dashboard-gauge-readout';
  const value = document.createElement('output');
  value.dataset.gaugeValue = '';
  value.textContent = '—';
  const units = document.createElement('span');
  units.dataset.gaugeUnits = '';
  readout.append(value, units);

  const range = document.createElement('div');
  range.className = 'dashboard-gauge-range';
  const minimum = document.createElement('span');
  minimum.dataset.gaugeMin = '';
  const state = document.createElement('strong');
  state.dataset.gaugeState = '';
  state.hidden = true;
  state.textContent = 'Out of range';
  const maximum = document.createElement('span');
  maximum.dataset.gaugeMax = '';
  range.append(minimum, state, maximum);

  root.append(readout, range);
  applyGaugeVisibility(root, gauge);
  updateRangeLabels(root, gauge, signal.config?.precision ?? 1);
  return root;
}

/** Update only the live parts of a gauge; configuration is read from the signal. */
export function updateGauge(root, signal, reading) {
  if (!root) return;
  const gauge = normalizeGauge(signal.config?.gauge);
  const precision = clampInteger(signal.config?.precision, 0, 6, 1);
  const value = Number(reading?.value);
  const finite = Number.isFinite(value);
  const ratio = finite ? valueRatio(value, gauge.min, gauge.max) : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  const outOfRange = finite && (ratio < 0 || ratio > 1);

  root.setAttribute('aria-valuemin', String(gauge.min));
  root.setAttribute('aria-valuemax', String(gauge.max));
  if (finite) root.setAttribute('aria-valuenow', String(value));
  else root.removeAttribute('aria-valuenow');
  root.dataset.outOfRange = String(outOfRange);

  const output = root.querySelector('[data-gauge-value]');
  const units = root.querySelector('[data-gauge-units]');
  const state = root.querySelector('[data-gauge-state]');
  if (output) output.textContent = finite ? value.toFixed(precision) : '—';
  if (units) units.textContent = gauge.showUnits && reading?.unit ? reading.unit : '';
  if (state) state.hidden = !outOfRange;

  if (gauge.type.startsWith('dial-')) updateDial(root, gauge, clamped);
  else updateMeter(root, gauge, clamped);
}

function createDial(gauge) {
  const svg = svgElement('svg', {
    class: 'dashboard-gauge-dial',
    viewBox: '0 0 100 88',
    'aria-hidden': 'true',
  });
  const base = svgElement('path', { class: 'dashboard-gauge-dial-base', 'data-gauge-base': '' });
  const low = svgElement('path', { class: 'dashboard-gauge-limit low', 'data-gauge-low': '' });
  const high = svgElement('path', { class: 'dashboard-gauge-limit high', 'data-gauge-high': '' });
  const fill = svgElement('path', { class: 'dashboard-gauge-dial-value', 'data-gauge-fill': '' });
  const needle = svgElement('line', {
    class: 'dashboard-gauge-needle',
    'data-gauge-needle': '',
    x1: String(DIAL_CENTER),
    y1: String(DIAL_CENTER),
  });
  const hub = svgElement('circle', {
    class: 'dashboard-gauge-needle-hub',
    cx: String(DIAL_CENTER),
    cy: String(DIAL_CENTER),
    r: '2.5',
  });
  base.setAttribute('d', arcPath(0, 1));
  fill.hidden = gauge.type !== 'dial-filled';
  needle.hidden = gauge.type !== 'dial-needle';
  hub.hidden = gauge.type !== 'dial-needle';
  svg.append(base, low, high, fill, needle, hub);
  return svg;
}

function createMeter(gauge) {
  const meter = document.createElement('div');
  meter.className = 'dashboard-gauge-meter';
  meter.dataset.orientation = gauge.type.replace('meter-', '');
  const track = document.createElement('div');
  track.className = 'dashboard-gauge-meter-track';
  const fill = document.createElement('span');
  fill.className = 'dashboard-gauge-meter-value';
  fill.dataset.gaugeFill = '';
  const low = document.createElement('span');
  low.className = 'dashboard-gauge-limit low';
  low.dataset.gaugeLow = '';
  const high = document.createElement('span');
  high.className = 'dashboard-gauge-limit high';
  high.dataset.gaugeHigh = '';
  track.append(fill, low, high);
  meter.append(track);
  return meter;
}

function updateDial(root, gauge, ratio) {
  const low = root.querySelector('[data-gauge-low]');
  const high = root.querySelector('[data-gauge-high]');
  const fill = root.querySelector('[data-gauge-fill]');
  const needle = root.querySelector('[data-gauge-needle]');
  const lowRatio = limitRatio(gauge.low, gauge.min, gauge.max);
  const highRatio = limitRatio(gauge.high, gauge.min, gauge.max);
  if (low) low.setAttribute('d', lowRatio === null ? '' : arcPath(0, lowRatio));
  if (high) high.setAttribute('d', highRatio === null ? '' : arcPath(highRatio, 1));
  if (fill && gauge.type === 'dial-filled') fill.setAttribute('d', arcPath(0, ratio));
  if (needle && gauge.type === 'dial-needle') {
    const point = dialPoint(ratio, DIAL_RADIUS - 6);
    needle.setAttribute('x2', point.x.toFixed(2));
    needle.setAttribute('y2', point.y.toFixed(2));
  }
}

function updateMeter(root, gauge, ratio) {
  const track = root.querySelector('.dashboard-gauge-meter-track');
  const fill = root.querySelector('[data-gauge-fill]');
  const low = root.querySelector('[data-gauge-low]');
  const high = root.querySelector('[data-gauge-high]');
  if (!track || !fill || !low || !high) return;
  const lowRatio = limitRatio(gauge.low, gauge.min, gauge.max) ?? 0;
  const highRatio = limitRatio(gauge.high, gauge.min, gauge.max) ?? 1;
  const orientation = track.parentElement?.dataset.orientation ?? 'horizontal';

  for (const element of [fill, low, high]) element.removeAttribute('style');
  if (orientation === 'horizontal') {
    fill.style.width = percent(ratio);
    low.style.width = percent(lowRatio);
    high.style.left = percent(highRatio);
    high.style.width = percent(1 - highRatio);
    return;
  }
  const inverted = orientation === 'vertical-inverted';
  fill.style.height = percent(ratio);
  fill.style.top = inverted ? '0' : 'auto';
  fill.style.bottom = inverted ? 'auto' : '0';
  low.style.height = percent(lowRatio);
  low.style.top = inverted ? '0' : 'auto';
  low.style.bottom = inverted ? 'auto' : '0';
  high.style.height = percent(1 - highRatio);
  high.style.top = inverted ? 'auto' : '0';
  high.style.bottom = inverted ? '0' : 'auto';
}

function applyGaugeVisibility(root, gauge) {
  root.querySelector('.dashboard-gauge-readout')?.classList.toggle('hidden', !gauge.showValue);
  root.querySelector('[data-gauge-min]')?.classList.toggle('hidden', !gauge.showRange);
  root.querySelector('[data-gauge-max]')?.classList.toggle('hidden', !gauge.showRange);
}

function updateRangeLabels(root, gauge, precision) {
  const minimum = root.querySelector('[data-gauge-min]');
  const maximum = root.querySelector('[data-gauge-max]');
  const digits = clampInteger(precision, 0, 6, 1);
  if (minimum) minimum.textContent = Number(gauge.min).toFixed(digits);
  if (maximum) maximum.textContent = Number(gauge.max).toFixed(digits);
}

function normalizeGauge(config) {
  return { ...DEFAULT_GAUGE, ...(config ?? {}) };
}

function valueRatio(value, minimum, maximum) {
  return (Number(value) - Number(minimum)) / Math.max(1e-12, Number(maximum) - Number(minimum));
}

function limitRatio(value, minimum, maximum) {
  if (value === null || value === '' || value === undefined || !Number.isFinite(Number(value))) return null;
  return Math.max(0, Math.min(1, valueRatio(Number(value), minimum, maximum)));
}

function arcPath(startRatio, endRatio) {
  const start = Math.max(0, Math.min(1, startRatio));
  const end = Math.max(0, Math.min(1, endRatio));
  if (end <= start) return '';
  const first = dialPoint(start, DIAL_RADIUS);
  const last = dialPoint(end, DIAL_RADIUS);
  const span = (end - start) * DIAL_SPAN_DEG;
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} A ${DIAL_RADIUS} ${DIAL_RADIUS} 0 ${span > 180 ? 1 : 0} 1 ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
}

function dialPoint(ratio, radius) {
  const degrees = DIAL_START_DEG + ratio * DIAL_SPAN_DEG;
  const radians = degrees * Math.PI / 180;
  return {
    x: DIAL_CENTER + radius * Math.cos(radians),
    y: DIAL_CENTER + radius * Math.sin(radians),
  };
}

function svgElement(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function percent(value) { return `${Math.max(0, Math.min(1, value)) * 100}%`; }
function clampInteger(value, low, high, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(low, Math.min(high, number)) : fallback;
}
