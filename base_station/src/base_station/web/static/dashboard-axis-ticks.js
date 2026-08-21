import { formatTime } from './dashboard-time-utils.js';

const MAX_RENDERED_TICKS = 160;

export function buildLinearTicks(range, targetCount = 6, manualStep = null, timeAxis = false) {
  const span = Math.max(1e-12, range[1] - range[0]);
  const requested = positive(manualStep)
    ? Number(manualStep)
    : niceStep(span / Math.max(1, targetCount - 1));
  const estimatedCount = span / requested + 1;
  const stride = Math.max(1, Math.ceil(estimatedCount / MAX_RENDERED_TICKS));
  const step = requested * stride;
  const first = Math.ceil((range[0] - step * 1e-9) / step) * step;
  const major = [];
  for (let index = 0; index < MAX_RENDERED_TICKS; index += 1) {
    const raw = first + index * step;
    if (raw > range[1] + step * 1e-9) break;
    const value = cleanNumber(raw, step);
    major.push({ value, label: timeAxis ? formatTimeTick(value, step) : formatNumberTick(value, step) });
  }
  return { major, step, requestedStep: requested };
}

export function buildLogTicks(range, targetCount = 6) {
  const [minimum, maximum] = range;
  if (!(minimum > 0 && maximum > minimum)) return { major: [], step: 1, requestedStep: 1 };
  const startExponent = Math.floor(Math.log10(minimum)) - 1;
  const endExponent = Math.ceil(Math.log10(maximum)) + 1;
  let candidates = [];
  for (let exponent = startExponent; exponent <= endExponent; exponent += 1) {
    const power = 10 ** exponent;
    for (const multiplier of [1, 2, 5]) {
      const value = multiplier * power;
      if (value >= minimum * (1 - 1e-12) && value <= maximum * (1 + 1e-12)) candidates.push(value);
    }
  }
  if (candidates.length > Math.max(2, targetCount * 2)) {
    const powers = candidates.filter((value) => nearlyPowerOfTen(value));
    if (powers.length >= 2) candidates = powers;
  }
  const stride = Math.max(1, Math.ceil(candidates.length / MAX_RENDERED_TICKS));
  const major = candidates.filter((_, index) => index % stride === 0)
    .map((value) => ({ value, label: formatLogTick(value) }));
  return { major, step: 1, requestedStep: 1 };
}

export function buildLinearMinorTicks(ticks, range) {
  if (!positive(ticks.step)) return [];
  const minorStep = ticks.step / 4;
  const first = Math.ceil((range[0] - minorStep * 1e-9) / minorStep) * minorStep;
  const values = [];
  for (let index = 0; index < MAX_RENDERED_TICKS; index += 1) {
    const value = cleanNumber(first + index * minorStep, minorStep);
    if (value > range[1] + minorStep * 1e-9) break;
    const majorRatio = value / ticks.step;
    if (Math.abs(majorRatio - Math.round(majorRatio)) > 1e-7) values.push({ value });
  }
  return values;
}

export function buildLogMinorTicks(range) {
  if (!(range[0] > 0 && range[1] > range[0])) return [];
  const values = [];
  const startExponent = Math.floor(Math.log10(range[0])) - 1;
  const endExponent = Math.ceil(Math.log10(range[1])) + 1;
  for (let exponent = startExponent; exponent <= endExponent && values.length < MAX_RENDERED_TICKS; exponent += 1) {
    const power = 10 ** exponent;
    for (const multiplier of [3, 4, 6, 7, 8, 9]) {
      const value = multiplier * power;
      if (value >= range[0] && value <= range[1]) values.push({ value });
    }
  }
  return values;
}

export function niceStep(rawStep) {
  const value = Math.max(Number.MIN_VALUE, Math.abs(Number(rawStep) || 1));
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  const nice = [1, 2, 2.5, 5, 10].find((candidate) => fraction <= candidate) ?? 10;
  return nice * magnitude;
}

function formatTimeTick(value, step) {
  if (Math.abs(value) >= 120) return formatTime(value).replace(/ s$/, '');
  const decimals = step >= 1 ? (step < 10 && !Number.isInteger(step) ? 1 : 0)
    : Math.min(4, Math.max(1, Math.ceil(-Math.log10(step))));
  return `${cleanZero(value).toFixed(decimals)} s`;
}

function formatNumberTick(value, step) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || (magnitude > 0 && magnitude < 1e-4)) return value.toExponential(1);
  const decimals = step >= 1 ? 0 : Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
  return cleanZero(value).toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatLogTick(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 100_000 || (magnitude > 0 && magnitude < 0.001)) {
    return value.toExponential(1).replace('.0e', 'e');
  }
  return Number(value.toPrecision(5)).toString();
}

function cleanNumber(value, step) {
  const decimals = Math.max(0, Math.min(12, Math.ceil(-Math.log10(Math.abs(step))) + 2));
  return cleanZero(Number(Number(value).toFixed(decimals)));
}

function cleanZero(value) {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function positive(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
}

function nearlyPowerOfTen(value) {
  const exponent = Math.log10(value);
  return Math.abs(exponent - Math.round(exponent)) < 1e-9;
}
