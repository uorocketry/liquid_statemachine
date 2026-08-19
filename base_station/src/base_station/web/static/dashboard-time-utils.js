export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

export function bucketSamples(samples, range, bucketCount) {
  if (samples.length <= bucketCount) {
    return samples.map((sample) => ({
      time: sample.time,
      min: sample.value,
      max: sample.value,
      last: sample.value,
    }));
  }
  const buckets = [];
  const width = Math.max(1e-9, range[1] - range[0]);
  for (const sample of samples) {
    const index = Math.min(bucketCount - 1, Math.floor((sample.time - range[0]) / width * bucketCount));
    const current = buckets[index];
    if (!current) {
      buckets[index] = { time: sample.time, min: sample.value, max: sample.value, last: sample.value };
      continue;
    }
    current.time = sample.time;
    current.min = Math.min(current.min, sample.value);
    current.max = Math.max(current.max, sample.value);
    current.last = sample.value;
  }
  return buckets.filter(Boolean);
}

export function closestByTime(samples, time) {
  if (!samples.length) return null;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const before = samples[Math.max(0, low - 1)];
  const after = samples[low];
  return Math.abs(before.time - time) <= Math.abs(after.time - time) ? before : after;
}

export function samplesInRange(samples, range) {
  if (!samples.length) return [];
  const lower = lowerBound(samples, range[0]);
  const upper = lowerBound(samples, range[1], lower);
  const end = upper < samples.length && samples[upper].time <= range[1] ? upper + 1 : upper;
  return samples.slice(lower, end);
}

function lowerBound(samples, time, start = 0) {
  let low = start;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function formatTime(seconds) {
  if (seconds < 10) return `${seconds.toFixed(3)} s`;
  if (seconds < 120) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

export function compactNumber(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1000 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  if (magnitude >= 100) return value.toFixed(1);
  if (magnitude >= 1) return value.toFixed(2);
  return value.toPrecision(3);
}

export function canvasColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    input: style.getPropertyValue('--color-input').trim(),
    surface: style.getPropertyValue('--color-surface').trim(),
    selected: style.getPropertyValue('--color-surface-subtle').trim(),
    text: style.getPropertyValue('--color-text').trim(),
    muted: style.getPropertyValue('--color-text-muted').trim(),
    line: style.getPropertyValue('--color-text').trim(),
    navigatorLine: style.getPropertyValue('--color-text-muted').trim(),
    borderSoft: style.getPropertyValue('--color-border-soft').trim(),
    grid: style.getPropertyValue('--color-grid-major').trim(),
    crosshair: style.getPropertyValue('--color-text-muted').trim(),
    selectionFill: colorWithAlpha(style.getPropertyValue('--color-text-muted').trim(), 0.09),
    selectionStroke: colorWithAlpha(style.getPropertyValue('--color-text-muted').trim(), 0.55),
    windowFill: colorWithAlpha(style.getPropertyValue('--color-text-muted').trim(), 0.08),
    windowStroke: colorWithAlpha(style.getPropertyValue('--color-text-muted').trim(), 0.45),
  };
}

function colorWithAlpha(color, alpha) {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
