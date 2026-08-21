import { createWidgetCard } from './dashboard-widget-shell.js';

const DIAL_START_DEG = 135;
const DIAL_SPAN_DEG = 270;
const DIAL_RADIUS = 43;
const DIAL_CENTER_X = 60;
const DIAL_CENTER_Y = 53;

/** Create one dashboard Gauge widget. */
export function createGaugeWidget(node) {
  const gauge = node.config;
  const { card } = createWidgetCard(node);
  const root = document.createElement('div');
  root.className = 'dashboard-gauge';
  root.dataset.gaugeType = gauge.type;
  root.dataset.state = 'normal';
  root.setAttribute('role', 'meter');
  root.setAttribute('aria-label', `${node.config?.label ?? 'Signal'} gauge`);

  const visual = document.createElement('div');
  visual.className = `dashboard-gauge-visual ${gauge.type.startsWith('dial-') ? 'dial' : 'meter'}`;
  visual.dataset.orientation = gauge.type.replace('meter-', '');
  if (gauge.type.startsWith('dial-')) {
    visual.append(createDial(gauge));
    root.append(visual);
  } else {
    visual.append(createMeter(gauge), createReadout());
    root.append(visual, createRange());
  }
  applyGaugeVisibility(root, gauge);
  updateRangeLabels(root, gauge, node.config.precision);
  card.append(root);
  return card;
}

/** Update only the live parts of a Gauge widget. */
export function updateGaugeWidget(card, node, reading) {
  const root = card?.querySelector('.dashboard-gauge');
  if (!root) return;
  const gauge = node.config;
  const precision = node.config.precision;
  const value = Number(reading?.value);
  const finite = Number.isFinite(value);
  const ratio = finite ? valueRatio(value, gauge.min, gauge.max) : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  const outOfRange = finite && (ratio < 0 || ratio > 1);
  const stateName = gaugeState(value, finite, gauge);

  root.setAttribute('aria-valuemin', String(gauge.min));
  root.setAttribute('aria-valuemax', String(gauge.max));
  if (finite) root.setAttribute('aria-valuenow', String(value));
  else root.removeAttribute('aria-valuenow');
  root.dataset.outOfRange = String(outOfRange);
  root.dataset.state = stateName;

  const output = root.querySelector('[data-gauge-value]');
  const units = root.querySelector('[data-gauge-units]');
  const state = root.querySelector('[data-gauge-state]');
  if (output) output.textContent = finite ? value.toFixed(precision) : '—';
  if (units) units.textContent = gauge.showUnits && reading?.unit ? reading.unit : '';
  if (state) {
    state.textContent = stateLabel(stateName);
    state.classList.toggle('hidden', stateName === 'normal' || stateName === 'unavailable');
  }
  if (finite) {
    root.setAttribute('aria-valuetext', `${value.toFixed(precision)}${reading?.unit ? ` ${reading.unit}` : ''}${stateName === 'normal' ? '' : `, ${stateLabel(stateName)}`}`);
  } else {
    root.removeAttribute('aria-valuetext');
  }

  if (gauge.type.startsWith('dial-')) updateDial(root, gauge, clamped);
  else updateMeter(root, gauge, clamped);
}

function createDial(gauge) {
  const svg = svgElement('svg', {
    class: 'dashboard-gauge-dial',
    viewBox: '0 0 120 104',
    'aria-hidden': 'true',
  });
  const base = svgElement('path', { class: 'dashboard-gauge-dial-base', 'data-gauge-base': '' });
  const low = svgElement('line', { class: 'dashboard-gauge-limit low', 'data-gauge-low': '' });
  const high = svgElement('line', { class: 'dashboard-gauge-limit high', 'data-gauge-high': '' });
  const fill = svgElement('path', { class: 'dashboard-gauge-dial-value', 'data-gauge-fill': '' });
  const needle = svgElement('line', {
    class: 'dashboard-gauge-needle',
    'data-gauge-needle': '',
    x1: String(DIAL_CENTER_X),
    y1: String(DIAL_CENTER_Y),
  });
  const hub = svgElement('circle', {
    class: 'dashboard-gauge-needle-hub',
    cx: String(DIAL_CENTER_X),
    cy: String(DIAL_CENTER_Y),
    r: '2.5',
  });
  const readout = svgElement('text', {
    class: 'dashboard-gauge-dial-readout',
    'data-gauge-readout': '',
    x: String(DIAL_CENTER_X),
    y: '91',
    'text-anchor': 'middle',
  });
  const value = svgElement('tspan', { 'data-gauge-value': '' });
  value.textContent = '—';
  const units = svgElement('tspan', { class: 'dashboard-gauge-dial-units', 'data-gauge-units': '', dx: '2' });
  readout.append(value, units);
  const minimum = svgElement('text', {
    class: 'dashboard-gauge-dial-range',
    'data-gauge-min': '',
    x: '29.6',
    y: '101',
    'text-anchor': 'middle',
  });
  const maximum = svgElement('text', {
    class: 'dashboard-gauge-dial-range',
    'data-gauge-max': '',
    x: '90.4',
    y: '101',
    'text-anchor': 'middle',
  });
  const state = svgElement('text', {
    class: 'dashboard-gauge-dial-state hidden',
    'data-gauge-state': '',
    x: String(DIAL_CENTER_X),
    y: '101',
    'text-anchor': 'middle',
  });
  base.setAttribute('d', arcPath(0, 1));
  fill.style.display = gauge.type === 'dial-filled' ? '' : 'none';
  needle.style.display = gauge.type === 'dial-needle' ? '' : 'none';
  hub.style.display = gauge.type === 'dial-needle' ? '' : 'none';
  svg.append(base, low, high, fill, needle, hub, readout, minimum, state, maximum);
  return svg;
}

function createReadout() {
  const readout = document.createElement('div');
  readout.className = 'dashboard-gauge-readout';
  readout.dataset.gaugeReadout = '';
  const value = document.createElement('output');
  value.dataset.gaugeValue = '';
  value.textContent = '—';
  const units = document.createElement('span');
  units.dataset.gaugeUnits = '';
  readout.append(value, units);
  return readout;
}

function createRange() {
  const range = document.createElement('div');
  range.className = 'dashboard-gauge-range';
  const minimum = document.createElement('span');
  minimum.dataset.gaugeMin = '';
  const state = document.createElement('strong');
  state.dataset.gaugeState = '';
  state.classList.add('hidden');
  const maximum = document.createElement('span');
  maximum.dataset.gaugeMax = '';
  range.append(minimum, state, maximum);
  return range;
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
  low.className = 'dashboard-gauge-threshold low';
  low.dataset.gaugeLow = '';
  const high = document.createElement('span');
  high.className = 'dashboard-gauge-threshold high';
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
  setDialThreshold(low, lowRatio);
  setDialThreshold(high, highRatio);
  if (fill && gauge.type === 'dial-filled') fill.setAttribute('d', arcPath(0, ratio));
  if (needle && gauge.type === 'dial-needle') {
    const point = dialPoint(ratio, DIAL_RADIUS - 7);
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
  const lowRatio = limitRatio(gauge.low, gauge.min, gauge.max);
  const highRatio = limitRatio(gauge.high, gauge.min, gauge.max);
  const orientation = track.parentElement?.dataset.orientation ?? 'horizontal';

  for (const element of [fill, low, high]) element.removeAttribute('style');
  low.hidden = lowRatio === null;
  high.hidden = highRatio === null;
  if (orientation === 'horizontal') {
    fill.style.width = percent(ratio);
    if (lowRatio !== null) low.style.left = percent(lowRatio);
    if (highRatio !== null) high.style.left = percent(highRatio);
    return;
  }
  const inverted = orientation === 'vertical-inverted';
  fill.style.height = percent(ratio);
  fill.style.top = inverted ? '0' : 'auto';
  fill.style.bottom = inverted ? 'auto' : '0';
  if (lowRatio !== null) low.style.top = inverted ? percent(lowRatio) : percent(1 - lowRatio);
  if (highRatio !== null) high.style.top = inverted ? percent(highRatio) : percent(1 - highRatio);
}

function applyGaugeVisibility(root, gauge) {
  root.querySelector('[data-gauge-readout]')?.classList.toggle('hidden', !gauge.showValue);
  root.querySelector('[data-gauge-min]')?.classList.toggle('hidden', !gauge.showRange);
  root.querySelector('[data-gauge-max]')?.classList.toggle('hidden', !gauge.showRange);
}

function updateRangeLabels(root, gauge, precision) {
  const minimum = root.querySelector('[data-gauge-min]');
  const maximum = root.querySelector('[data-gauge-max]');
  const digits = precision;
  if (minimum) minimum.textContent = Number(gauge.min).toFixed(digits);
  if (maximum) maximum.textContent = Number(gauge.max).toFixed(digits);
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
    x: DIAL_CENTER_X + radius * Math.cos(radians),
    y: DIAL_CENTER_Y + radius * Math.sin(radians),
  };
}

function setDialThreshold(element, ratio) {
  if (!element) return;
  if (ratio === null) {
    element.style.display = 'none';
    return;
  }
  element.style.display = '';
  const inner = dialPoint(ratio, DIAL_RADIUS - 5);
  const outer = dialPoint(ratio, DIAL_RADIUS + 5);
  element.setAttribute('x1', inner.x.toFixed(2));
  element.setAttribute('y1', inner.y.toFixed(2));
  element.setAttribute('x2', outer.x.toFixed(2));
  element.setAttribute('y2', outer.y.toFixed(2));
}

function gaugeState(value, finite, gauge) {
  if (!finite) return 'unavailable';
  if (value < Number(gauge.min) || value > Number(gauge.max)) return 'out';
  const low = optionalNumber(gauge.low);
  const high = optionalNumber(gauge.high);
  if (low !== null && value < low) return 'low';
  if (high !== null && value > high) return 'high';
  return 'normal';
}

function stateLabel(state) {
  if (state === 'low') return 'Low';
  if (state === 'high') return 'High';
  if (state === 'out') return 'Out of range';
  return '';
}

function optionalNumber(value) {
  if (value === null || value === '' || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function svgElement(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function percent(value) { return `${Math.max(0, Math.min(1, value)) * 100}%`; }
