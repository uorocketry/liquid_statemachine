const MIN_X_LABEL_GAP = 7;
const MIN_Y_LABEL_GAP = 4;
const TICK_FONT = '8px ui-monospace, monospace';
const TITLE_FONT = '600 8px ui-monospace, monospace';

export function drawPlotGrid(context, axis, colors) {
  const { frame, config } = axis;
  context.save();
  context.beginPath();
  context.rect(frame.left, frame.top, frame.width, frame.height);
  context.clip();

  if (config.showMinorGrid) {
    context.strokeStyle = colors.gridMinor;
    context.lineWidth = 1;
    drawGridLines(context, axis.xMinorTicks, axis.xAt, frame, true);
    drawGridLines(context, axis.yMinorTicks, axis.yAt, frame, false);
  }
  if (config.showGrid !== false) {
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    drawGridLines(context, axis.xTicks.major, axis.xAt, frame, true);
    drawGridLines(context, axis.yTicks.major, axis.yAt, frame, false);
  }
  context.restore();
}

export function drawPlotAxes(context, axis, colors) {
  const { frame } = axis;
  context.save();
  context.strokeStyle = colors.muted;
  context.fillStyle = colors.muted;
  context.lineWidth = 1;
  context.font = TICK_FONT;
  context.textBaseline = 'top';

  context.beginPath();
  context.moveTo(frame.left + 0.5, frame.top);
  context.lineTo(frame.left + 0.5, frame.bottom);
  context.lineTo(frame.right, frame.bottom + 0.5);
  context.stroke();

  const xLabels = nonOverlappingXLabels(context, axis.xTicks.major, axis.xAt, frame);
  for (const tick of axis.xTicks.major) {
    const x = axis.xAt(tick.value);
    if (!inside(x, frame.left, frame.right)) continue;
    context.beginPath();
    context.moveTo(x + 0.5, frame.bottom);
    context.lineTo(x + 0.5, frame.bottom + 4);
    context.stroke();
    if (!xLabels.has(tick)) continue;
    context.textAlign = 'center';
    context.fillText(tick.label, x, frame.bottom + 6);
  }
  drawMinorAxisTicks(context, axis.xMinorTicks, axis.xAt, frame, true);

  const yLabels = nonOverlappingYLabels(axis.yTicks.major, axis.yAt, frame);
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (const tick of axis.yTicks.major) {
    const y = axis.yAt(tick.value);
    if (!Number.isFinite(y) || !inside(y, frame.top, frame.bottom)) continue;
    context.beginPath();
    context.moveTo(frame.left - 4, y + 0.5);
    context.lineTo(frame.left, y + 0.5);
    context.stroke();
    if (yLabels.has(tick)) context.fillText(tick.label, frame.left - 6, y);
  }
  drawMinorAxisTicks(context, axis.yMinorTicks, axis.yAt, frame, false);

  context.font = TITLE_FONT;
  context.fillStyle = colors.text;
  if (axis.xTitle) {
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.fillText(fitText(context, axis.xTitle, frame.width), frame.left + frame.width / 2, frame.canvasHeight - 2);
  }
  if (axis.yTitle) {
    context.save();
    context.translate(8, frame.top + frame.height / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(fitText(context, axis.yTitle, frame.height), 0, 0);
    context.restore();
  }
  context.restore();
}

function drawGridLines(context, ticks, mapper, frame, vertical) {
  for (const tick of ticks) {
    const position = mapper(tick.value);
    if (!Number.isFinite(position)) continue;
    context.beginPath();
    if (vertical) {
      context.moveTo(position + 0.5, frame.top);
      context.lineTo(position + 0.5, frame.bottom);
    } else {
      context.moveTo(frame.left, position + 0.5);
      context.lineTo(frame.right, position + 0.5);
    }
    context.stroke();
  }
}

function drawMinorAxisTicks(context, ticks, mapper, frame, xAxis) {
  for (const tick of ticks) {
    const position = mapper(tick.value);
    if (!Number.isFinite(position)) continue;
    context.beginPath();
    if (xAxis) {
      if (!inside(position, frame.left, frame.right)) continue;
      context.moveTo(position + 0.5, frame.bottom);
      context.lineTo(position + 0.5, frame.bottom + 2);
    } else {
      if (!inside(position, frame.top, frame.bottom)) continue;
      context.moveTo(frame.left - 2, position + 0.5);
      context.lineTo(frame.left, position + 0.5);
    }
    context.stroke();
  }
}

function nonOverlappingXLabels(context, ticks, mapper, frame) {
  const kept = new Set();
  let previousRight = -Infinity;
  for (const tick of ticks) {
    const x = mapper(tick.value);
    if (!inside(x, frame.left, frame.right)) continue;
    const half = context.measureText(tick.label).width / 2;
    const left = x - half;
    const right = x + half;
    if (left < previousRight + MIN_X_LABEL_GAP || left < frame.left - 1 || right > frame.right + 1) continue;
    kept.add(tick);
    previousRight = right;
  }
  return kept;
}

function nonOverlappingYLabels(ticks, mapper, frame) {
  const kept = new Set();
  let previousY = -Infinity;
  const ordered = [...ticks].sort((first, second) => mapper(first.value) - mapper(second.value));
  for (const tick of ordered) {
    const y = mapper(tick.value);
    if (!Number.isFinite(y) || !inside(y, frame.top, frame.bottom)) continue;
    if (y - previousY < 10 + MIN_Y_LABEL_GAP) continue;
    kept.add(tick);
    previousY = y;
  }
  return kept;
}

function inside(value, low, high) {
  return value >= low - 1e-6 && value <= high + 1e-6;
}

function fitText(context, value, maximumWidth) {
  const text = String(value ?? '');
  if (!text || context.measureText(text).width <= maximumWidth) return text;
  const ellipsis = '…';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, middle)}${ellipsis}`).width <= maximumWidth) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low)}${ellipsis}`;
}
