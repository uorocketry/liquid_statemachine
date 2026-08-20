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

/** Scan one time range without allocating a copy of every visible sample. */
export function summarizeSamples(samples, range, bucketCount) {
  if (!samples.length) return emptySummary();
  const lower = lowerBound(samples, range[0]);
  const upper = lowerBound(samples, range[1], lower);
  const end = upper < samples.length && samples[upper].time <= range[1] ? upper + 1 : upper;
  const count = Math.max(0, end - lower);
  if (!count) return emptySummary();

  const buckets = [];
  const rangeWidth = Math.max(1e-9, range[1] - range[0]);
  let minimum = Infinity;
  let maximum = -Infinity;
  let currentBucket = null;
  let currentBucketIndex = -1;
  for (let sampleIndex = lower; sampleIndex < end; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const sampleMin = sample.min ?? sample.value;
    const sampleMax = sample.max ?? sample.value;
    const segment = sample.segment ?? 0;
    minimum = Math.min(minimum, sampleMin);
    maximum = Math.max(maximum, sampleMax);

    if (count <= bucketCount) {
      buckets.push({
        time: sample.time,
        min: sampleMin,
        max: sampleMax,
        last: sample.value,
        segment,
      });
      continue;
    }
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((sample.time - range[0]) / rangeWidth * bucketCount),
    );
    if (!currentBucket || currentBucketIndex !== bucketIndex || currentBucket.segment !== segment) {
      currentBucket = {
        time: sample.time,
        min: sampleMin,
        max: sampleMax,
        last: sample.value,
        segment,
      };
      currentBucketIndex = bucketIndex;
      buckets.push(currentBucket);
      continue;
    }
    currentBucket.time = sample.time;
    currentBucket.min = Math.min(currentBucket.min, sampleMin);
    currentBucket.max = Math.max(currentBucket.max, sampleMax);
    currentBucket.last = sample.value;
  }
  return { count, minimum, maximum, buckets };
}

function emptySummary() {
  return { count: 0, minimum: Infinity, maximum: -Infinity, buckets: [] };
}

/** Keep a bounded, multi-resolution display history without discarding session start. */
export function compactHistory(samples, recentCount = 20_000) {
  if (samples.length <= recentCount + 2) return samples;
  const split = Math.max(2, samples.length - recentCount);
  const compacted = [samples[0]];
  for (let index = 1; index < split;) {
    const first = samples[index];
    const second = samples[index + 1];
    if (!second || (first.segment ?? 0) !== (second.segment ?? 0)) {
      compacted.push(first);
      index += 1;
      continue;
    }
    compacted.push({
      time: second.time,
      value: second.value,
      unit: second.unit ?? first.unit ?? '',
      min: Math.min(first.min ?? first.value, second.min ?? second.value),
      max: Math.max(first.max ?? first.value, second.max ?? second.value),
      segment: second.segment ?? first.segment ?? 0,
    });
    index += 2;
  }
  compacted.push(...samples.slice(split));
  samples.splice(0, samples.length, ...compacted);
  return samples;
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
  if (
    before !== after
    && before.time < time
    && time < after.time
    && (before.segment ?? 0) !== (after.segment ?? 0)
  ) return null;
  return Math.abs(before.time - time) <= Math.abs(after.time - time) ? before : after;
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
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`;
  }
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
