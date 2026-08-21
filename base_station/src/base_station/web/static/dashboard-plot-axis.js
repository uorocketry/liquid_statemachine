import { clamp, compactNumber, formatTime } from './dashboard-time-utils.js';
import {
  buildLinearMinorTicks,
  buildLinearTicks,
  buildLogMinorTicks,
  buildLogTicks,
} from './dashboard-axis-ticks.js';

const TICK_FONT = '8px ui-monospace, monospace';

export function plotTimeRange(plot, state, history = []) {
  const config = plot?.config ?? {};
  const shared = validRange(state?.range) ? state.range : [0, 1];
  const historyBounds = history.length
    ? [Number(history[0].time), Math.max(Number(history[0].time) + 0.001, Number(history.at(-1).time))]
    : null;
  const bounds = validRange(historyBounds)
    ? historyBounds
    : (validRange(state?.bounds) ? state.bounds : shared);
  if (config.xRangeMode === 'fixed' && validOrdered(config.xMinS, config.xMaxS)) {
    return [Number(config.xMinS), Number(config.xMaxS)];
  }
  if (config.xRangeMode === 'auto') return [...bounds];
  if (config.xRangeMode !== 'window' || !positive(config.xWindowS)) return [...shared];

  const width = Number(config.xWindowS);
  const available = Math.max(0, bounds[1] - bounds[0]);
  if (available <= width) return [...bounds];
  const end = clamp(Number(state?.viewTime ?? shared[1]), bounds[0] + width, bounds[1]);
  return [end - width, end];
}

export function buildPlotAxis(context, plot, state, summary, history, width, height) {
  const config = plot?.config ?? {};
  const xRange = plotTimeRange(plot, state, history);
  const yDomain = resolveYDomain(config, summary);
  const unit = latestUnit(plot, history);
  const xTitle = String(config.xLabel ?? 'Elapsed time').trim();
  const yTitle = String(config.yLabel ?? '').trim() || unit;
  const yScale = config.yAxisScale === 'log10' ? 'log10' : 'linear';

  context.font = TICK_FONT;
  let xTicks = buildLinearTicks(
    xRange,
    Math.max(2, Math.floor((width - 64) / 72)),
    config.xTickMode === 'manual' && positive(config.xMajorStepS) ? Number(config.xMajorStepS) : null,
    true,
  );
  let yTicks = yScale === 'log10'
    ? buildLogTicks(yDomain.range, Math.max(2, Math.floor((height - 42) / 30)))
    : buildLinearTicks(
      yDomain.range,
      Math.max(2, Math.floor((height - 42) / 30)),
      config.yTickMode === 'manual' && positive(config.yMajorStep) ? Number(config.yMajorStep) : null,
      false,
    );

  let frame = frameFor(context, width, height, xTicks, yTicks, xTitle, yTitle);
  xTicks = buildLinearTicks(
    xRange,
    Math.max(2, Math.floor(frame.width / 72)),
    config.xTickMode === 'manual' && positive(config.xMajorStepS) ? Number(config.xMajorStepS) : null,
    true,
  );
  yTicks = yScale === 'log10'
    ? buildLogTicks(yDomain.range, Math.max(2, Math.floor(frame.height / 28)))
    : buildLinearTicks(
      yDomain.range,
      Math.max(2, Math.floor(frame.height / 28)),
      config.yTickMode === 'manual' && positive(config.yMajorStep) ? Number(config.yMajorStep) : null,
      false,
    );
  frame = frameFor(context, width, height, xTicks, yTicks, xTitle, yTitle);

  const xAt = (value) => frame.left
    + (Number(value) - xRange[0]) / Math.max(1e-12, xRange[1] - xRange[0]) * frame.width;
  const yTransform = yScale === 'log10'
    ? (value) => Number(value) > 0 ? Math.log10(Number(value)) : null
    : (value) => Number(value);
  const transformedMin = yTransform(yDomain.range[0]);
  const transformedMax = yTransform(yDomain.range[1]);
  const yAt = (value) => {
    const transformed = yTransform(value);
    if (!Number.isFinite(transformed)) return null;
    return frame.top + (transformedMax - transformed)
      / Math.max(1e-12, transformedMax - transformedMin) * frame.height;
  };

  return {
    config,
    frame,
    xRange,
    yRange: yDomain.range,
    yScale,
    xTitle,
    yTitle,
    unit,
    xTicks,
    yTicks,
    xMinorTicks: config.showMinorGrid ? buildLinearMinorTicks(xTicks, xRange) : [],
    yMinorTicks: config.showMinorGrid
      ? (yScale === 'log10' ? buildLogMinorTicks(yDomain.range) : buildLinearMinorTicks(yTicks, yDomain.range))
      : [],
    validData: yDomain.validData,
    invalidReason: yDomain.invalidReason,
    xAt,
    yAt,
  };
}

export function plotAccessibilityText(plot, axis, summary, history) {
  const label = String(plot?.config?.label ?? 'Time plot').trim() || 'Time plot';
  const latest = latestFinite(history, axis.yScale, axis.xRange);
  const scale = axis.yScale === 'log10' ? 'logarithmic base 10' : 'linear';
  const parts = [
    `${label} time plot.`,
    `${axis.xTitle || 'X axis'} from ${formatTime(axis.xRange[0])} to ${formatTime(axis.xRange[1])}.`,
    `${axis.yTitle || 'Y axis'} ${scale} scale from ${compactNumber(axis.yRange[0])} to ${compactNumber(axis.yRange[1])}.`,
  ];
  if (summary.count) {
    parts.push(`${summary.count.toLocaleString()} samples in view.`);
  } else {
    parts.push('No samples in view.');
  }
  if (latest) {
    parts.push(`Latest visible value ${compactNumber(latest.value)}${latest.unit ? ` ${latest.unit}` : ''} at ${formatTime(latest.time)}.`);
  }
  if (axis.invalidReason) parts.push(axis.invalidReason);
  return parts.join(' ');
}

function resolveYDomain(config, summary) {
  const log = config.yAxisScale === 'log10';
  const dataMin = log ? summary.positiveMinimum : summary.minimum;
  const dataMax = log ? summary.positiveMaximum : summary.maximum;
  const hasData = Number.isFinite(dataMin) && Number.isFinite(dataMax) && dataMax >= dataMin;

  if (config.yRangeMode === 'fixed' && validOrdered(config.yMin, config.yMax)) {
    const minimum = Number(config.yMin);
    const maximum = Number(config.yMax);
    return {
      range: log && minimum <= 0 ? [1, 10] : [minimum, maximum],
      validData: !log || hasData,
      invalidReason: log && !hasData ? 'No positive values for log scale.' : '',
    };
  }

  let minimum = hasData ? dataMin : (log ? 1 : 0);
  let maximum = hasData ? dataMax : (log ? 10 : 1);
  let preserveMinimum = false;
  let preserveMaximum = false;
  if (config.yRangeMode === 'soft') {
    if (finite(config.ySoftMin) && (!log || Number(config.ySoftMin) > 0)) {
      const softMinimum = Number(config.ySoftMin);
      preserveMinimum = !hasData || dataMin >= softMinimum;
      minimum = Math.min(minimum, softMinimum);
    }
    if (finite(config.ySoftMax) && (!log || Number(config.ySoftMax) > 0)) {
      const softMaximum = Number(config.ySoftMax);
      preserveMaximum = !hasData || dataMax <= softMaximum;
      maximum = Math.max(maximum, softMaximum);
    }
  }

  if (log) {
    if (maximum <= minimum) {
      if (!preserveMinimum) minimum /= Math.sqrt(10);
      if (!preserveMaximum) maximum *= Math.sqrt(10);
    } else {
      const logSpan = Math.log10(maximum) - Math.log10(minimum);
      const padding = Math.max(0.04, logSpan * 0.06);
      if (!preserveMinimum) minimum = 10 ** (Math.log10(minimum) - padding);
      if (!preserveMaximum) maximum = 10 ** (Math.log10(maximum) + padding);
    }
  } else {
    const span = maximum - minimum;
    const reference = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
    const padding = span > 0 ? Math.max(span * 0.06, reference * 1e-6) : reference * 0.05;
    if (!preserveMinimum) minimum -= padding;
    if (!preserveMaximum) maximum += padding;
  }
  if (!(maximum > minimum)) maximum = minimum + (log ? minimum * 9 : 1);
  return {
    range: [minimum, maximum],
    validData: !log || hasData,
    invalidReason: log && !hasData ? 'No positive values for log scale.' : '',
  };
}

function frameFor(context, width, height, xTicks, yTicks, xTitle, yTitle) {
  context.font = TICK_FONT;
  const yLabelWidth = Math.max(18, ...yTicks.major.map((tick) => context.measureText(tick.label).width));
  const left = Math.min(width * 0.38, 8 + yLabelWidth + 7 + (yTitle ? 11 : 0));
  const rightMargin = 8;
  const bottomMargin = 15 + (xTitle ? 11 : 0);
  const top = 7;
  const right = Math.max(left + 20, width - rightMargin);
  const bottom = Math.max(top + 20, height - bottomMargin);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    canvasWidth: width,
    canvasHeight: height,
  };
}

function latestUnit(plot, history) {
  const latest = [...(history ?? [])].reverse().find((sample) => String(sample?.unit ?? '').trim());
  if (latest?.unit) return String(latest.unit);
  const pinType = plot?.pins?.find((pin) => pin.id === 'value')?.type;
  return pinType && !['*', 'infer'].includes(pinType) ? String(pinType) : '';
}

function latestFinite(history, scale, range = null) {
  for (let index = (history?.length ?? 0) - 1; index >= 0; index -= 1) {
    const sample = history[index];
    if (range && (sample.time < range[0] || sample.time > range[1])) continue;
    if (!Number.isFinite(Number(sample?.value))) continue;
    if (scale === 'log10' && Number(sample.value) <= 0) continue;
    return sample;
  }
  return null;
}

function finite(value) { return value !== null && value !== '' && Number.isFinite(Number(value)); }
function positive(value) { return finite(value) && Number(value) > 0; }
function validOrdered(low, high) { return finite(low) && finite(high) && Number(high) > Number(low); }
function validRange(range) { return Array.isArray(range) && validOrdered(range[0], range[1]); }
