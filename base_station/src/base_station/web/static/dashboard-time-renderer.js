import {
  canvasColors,
  closestByTime,
  compactNumber,
  formatTime,
  prepareCanvas,
  summarizeSamples,
} from './dashboard-time-utils.js';
import {
  buildPlotAxis,
  plotAccessibilityText,
  plotTimeRange,
} from './dashboard-plot-axis.js';
import { drawPlotAxes, drawPlotGrid } from './dashboard-axis-renderer.js';

export class DashboardTimeRenderer {
  constructor(options) {
    Object.assign(this, options);
    this.plotAxes = new Map();
  }

  axisFor(plotId) {
    return this.plotAxes.get(plotId) ?? null;
  }

  renderPlot(plot, state) {
    const card = this.cardFor(plot.id);
    const canvas = card?.querySelector('[data-signal-chart]');
    if (!canvas) return;
    const tooltip = card.querySelector('[data-chart-tooltip]');
    if (tooltip && state.hoverPlotId !== plot.id) tooltip.hidden = true;

    const { context, width, height } = prepareCanvas(canvas);
    const history = this.histories.get(plot.id) ?? [];
    const xRange = plotTimeRange(plot, state, history);
    const summary = summarizeSamples(history, xRange, Math.max(1, Math.floor(width)));
    const colors = canvasColors();
    context.fillStyle = colors.input;
    context.fillRect(0, 0, width, height);
    const axis = buildPlotAxis(context, plot, state, summary, history, width, height);
    this.plotAxes.set(plot.id, axis);
    drawPlotGrid(context, axis, colors);
    this.drawSelection(context, axis, state.selectedRange, colors);
    if (summary.count && axis.validData) this.drawSeries(context, axis, summary, colors);
    drawPlotAxes(context, axis, colors);
    if (axis.invalidReason) this.drawPlotMessage(context, axis, axis.invalidReason, colors);

    const inspectionTime = state.navigatorHover?.time ?? state.hoverTime;
    if (inspectionTime !== null && inspectionTime >= axis.xRange[0] && inspectionTime <= axis.xRange[1]) {
      const x = axis.xAt(inspectionTime);
      context.strokeStyle = colors.crosshair;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + 0.5, axis.frame.top);
      context.lineTo(x + 0.5, axis.frame.bottom);
      context.stroke();
      if (state.hoverTime !== null && state.hoverPlotId === plot.id) {
        this.showChartTooltip(card, history, state.hoverTime, x, axis);
      }
    }
    this.updateAccessibility(card, canvas, plot, axis, summary, history);
  }

  drawSeries(context, axis, summary, colors) {
    const { frame } = axis;
    context.save();
    context.beginPath();
    context.rect(frame.left, frame.top, frame.width, frame.height);
    context.clip();
    context.strokeStyle = colors.line;
    context.lineWidth = 1;
    context.globalAlpha = 0.18;
    context.beginPath();
    for (const bucket of summary.buckets) {
      const minimum = axis.yScale === 'log10' ? bucket.positiveMin : bucket.min;
      const maximum = axis.yScale === 'log10' ? bucket.positiveMax : bucket.max;
      const top = axis.yAt(maximum);
      const bottom = axis.yAt(minimum);
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
      const x = axis.xAt(bucket.time);
      context.moveTo(x, top);
      context.lineTo(x, bottom);
    }
    context.stroke();
    context.globalAlpha = 1;
    context.lineWidth = 1.35;
    context.beginPath();
    let previousSegment = null;
    let previousValid = false;
    for (const bucket of summary.buckets) {
      const x = axis.xAt(bucket.time);
      const y = axis.yAt(bucket.last);
      const valid = Number.isFinite(y);
      if (!valid) {
        previousValid = false;
        previousSegment = bucket.segment;
        continue;
      }
      if (!previousValid || previousSegment === null || bucket.segment !== previousSegment) context.moveTo(x, y);
      else context.lineTo(x, y);
      previousValid = true;
      previousSegment = bucket.segment;
    }
    context.stroke();
    context.restore();
  }

  drawSelection(context, axis, selectedRange, colors) {
    if (!selectedRange) return;
    const start = Math.max(axis.xRange[0], selectedRange[0]);
    const end = Math.min(axis.xRange[1], selectedRange[1]);
    if (end <= start) return;
    const x = axis.xAt(start);
    const w = axis.xAt(end) - x;
    context.save();
    context.beginPath();
    context.rect(axis.frame.left, axis.frame.top, axis.frame.width, axis.frame.height);
    context.clip();
    context.fillStyle = colors.selectionFill;
    context.fillRect(x, axis.frame.top, Math.max(1, w), axis.frame.height);
    context.strokeStyle = colors.selectionStroke;
    context.strokeRect(x + 0.5, axis.frame.top + 0.5, Math.max(1, w - 1), Math.max(1, axis.frame.height - 1));
    context.restore();
  }

  drawPlotMessage(context, axis, message, colors) {
    context.fillStyle = colors.muted;
    context.font = '8px ui-monospace, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const clipped = message.length > 44 ? `${message.slice(0, 41)}…` : message;
    context.fillText(clipped, axis.frame.left + axis.frame.width / 2, axis.frame.top + axis.frame.height / 2);
  }

  showChartTooltip(card, history, hoverTime, x, axis) {
    const tooltip = card.querySelector('[data-chart-tooltip]');
    if (!tooltip) return;
    const firstTime = Number(history[0]?.time);
    const lastTime = Number(history.at(-1)?.time);
    if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime) || hoverTime < firstTime || hoverTime > lastTime) {
      tooltip.hidden = true;
      return;
    }
    const sample = closestByTime(history, hoverTime);
    if (!sample) {
      tooltip.hidden = true;
      return;
    }
    const outsideScale = axis?.yScale === 'log10' && Number(sample.value) <= 0 ? ' · outside log scale' : '';
    tooltip.textContent = `${compactNumber(sample.value)}${sample.unit ? ` ${sample.unit}` : ''} · ${formatTime(sample.time)}${outsideScale}`;
    tooltip.style.left = `${x}px`;
    tooltip.hidden = false;
  }

  updateAccessibility(card, canvas, plot, axis, summary, history) {
    const text = plotAccessibilityText(plot, axis, summary, history);
    const description = card.querySelector('[data-chart-accessible]');
    if (description) description.textContent = text;
    canvas.textContent = text;
  }

  renderNavigator(state) {
    if (!this.navigator.clientWidth || !this.navigator.clientHeight) return;
    const { context, width, height } = prepareCanvas(this.navigator);
    const colors = canvasColors();
    const bandHeight = height / 3;
    const selectedIndex = { full: 0, context: 1, detail: 2 }[state.selectedTier] ?? 2;
    const names = ['FULL', this.durationLabel(state.contextSeconds), this.durationLabel(state.detailSeconds)];
    context.fillStyle = colors.surface;
    context.fillRect(0, 0, width, height);

    state.ranges.forEach((range, index) => {
      const y = index * bandHeight;
      if (index === selectedIndex) {
        context.fillStyle = colors.selected;
        context.fillRect(0, y, width, bandHeight);
      }
      if (index) {
        context.strokeStyle = colors.borderSoft;
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(width, y + 0.5);
        context.stroke();
      }
      this.drawNavigatorPlots(context, range, y, bandHeight, width, colors, state.plots);
      this.drawNavigatorSelection(context, range, y, bandHeight, width, colors, state.selectedRange);
      context.fillStyle = index === selectedIndex ? colors.text : colors.muted;
      context.font = `${index === selectedIndex ? '700' : '600'} 8px ui-monospace, monospace`;
      context.textBaseline = 'top';
      context.fillText(names[index], 6, y + 5);
    });

    for (let parentIndex = 0; parentIndex < 2; parentIndex += 1) {
      const parent = state.ranges[parentIndex];
      const child = state.ranges[parentIndex + 1];
      const x = (child[0] - parent[0]) / Math.max(1e-9, parent[1] - parent[0]) * width;
      const w = (child[1] - child[0]) / Math.max(1e-9, parent[1] - parent[0]) * width;
      context.fillStyle = colors.windowFill;
      context.fillRect(x, parentIndex * bandHeight, Math.max(2, w), bandHeight);
      context.strokeStyle = colors.windowStroke;
      context.strokeRect(x + 0.5, parentIndex * bandHeight + 0.5, Math.max(1, w - 1), bandHeight - 1);
    }

    const inspectionTime = state.navigatorHover?.time ?? state.hoverTime;
    if (inspectionTime !== null) {
      state.ranges.forEach((range, index) => {
        if (inspectionTime < range[0] || inspectionTime > range[1]) return;
        const x = (inspectionTime - range[0]) / Math.max(1e-9, range[1] - range[0]) * width;
        context.strokeStyle = colors.crosshair;
        context.beginPath();
        context.moveTo(x + 0.5, index * bandHeight);
        context.lineTo(x + 0.5, (index + 1) * bandHeight);
        context.stroke();
      });
    }
  }

  drawNavigatorPlots(context, range, y, bandHeight, width, colors, plots) {
    const plotTop = y + 4;
    const plotHeight = Math.max(4, bandHeight - 8);
    for (const plot of plots) {
      const history = this.histories.get(plot.id) ?? [];
      const summary = summarizeSamples(history, range, Math.max(1, Math.floor(width / 2)));
      if (summary.count < 2) continue;
      const log = plot.config?.yAxisScale === 'log10';
      const minimum = log ? summary.positiveMinimum : summary.minimum;
      const maximum = log ? summary.positiveMaximum : summary.maximum;
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) continue;
      const transform = log ? (value) => value > 0 ? Math.log10(value) : null : (value) => value;
      const transformedMin = transform(minimum);
      const transformedMax = transform(maximum);
      const span = Math.max(1e-12, transformedMax - transformedMin);
      context.strokeStyle = colors.navigatorLine;
      context.globalAlpha = Math.max(0.12, Math.min(0.35, 1 / Math.sqrt(plots.length)));
      context.lineWidth = 1;
      context.beginPath();
      let previousSegment = null;
      let previousValid = false;
      summary.buckets.forEach((bucket) => {
        const x = (bucket.time - range[0]) / Math.max(1e-9, range[1] - range[0]) * width;
        const transformed = transform(bucket.last);
        if (!Number.isFinite(transformed)) {
          previousValid = false;
          previousSegment = bucket.segment;
          return;
        }
        const yy = plotTop + (transformedMax - transformed) / span * plotHeight;
        if (!previousValid || previousSegment === null || bucket.segment !== previousSegment) context.moveTo(x, yy);
        else context.lineTo(x, yy);
        previousValid = true;
        previousSegment = bucket.segment;
      });
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  drawNavigatorSelection(context, range, y, bandHeight, width, colors, selectedRange) {
    if (!selectedRange) return;
    const start = Math.max(range[0], selectedRange[0]);
    const end = Math.min(range[1], selectedRange[1]);
    if (end <= start) return;
    const x = (start - range[0]) / Math.max(1e-9, range[1] - range[0]) * width;
    const w = (end - start) / Math.max(1e-9, range[1] - range[0]) * width;
    context.fillStyle = colors.selectionFill;
    context.fillRect(x, y, Math.max(1, w), bandHeight);
  }

  durationLabel(seconds) {
    if (Math.abs(seconds - Math.round(seconds)) < 1e-6) return `${Math.round(seconds)} s`;
    return `${seconds.toFixed(seconds < 1 ? 2 : 1)} s`;
  }
}
