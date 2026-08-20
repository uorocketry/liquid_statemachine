import {
  canvasColors,
  closestByTime,
  compactNumber,
  formatTime,
  prepareCanvas,
  summarizeSamples,
} from './dashboard-time-utils.js';

export class DashboardTimeRenderer {
  constructor(options) {
    Object.assign(this, options);
  }

  renderSignal(signal, state) {
    const card = this.cardFor(signal.id);
    const canvas = card?.querySelector('[data-signal-chart]');
    if (!canvas) return;
    const tooltip = card.querySelector('[data-chart-tooltip]');
    if (tooltip && state.hoverSignalId !== signal.id) tooltip.hidden = true;

    const { context, width, height } = prepareCanvas(canvas);
    const history = this.histories.get(signal.id) ?? [];
    const summary = summarizeSamples(history, state.range, Math.max(1, Math.floor(width)));
    const colors = canvasColors();
    context.fillStyle = colors.input;
    context.fillRect(0, 0, width, height);
    this.drawGrid(context, width, height, colors.grid);
    this.drawSelection(context, width, height, state.range, state.selectedRange, colors);
    if (!summary.count) return;

    let { minimum, maximum } = summary;
    const padding = Math.max((maximum - minimum) * 0.08, Math.abs(maximum) * 1e-6, 1e-9);
    minimum -= padding;
    maximum += padding;

    const xAt = (time) => (time - state.range[0]) / Math.max(1e-9, state.range[1] - state.range[0]) * width;
    const yAt = (value) => 7 + (maximum - value) / Math.max(1e-12, maximum - minimum) * (height - 14);
    const buckets = summary.buckets;

    context.strokeStyle = colors.line;
    context.lineWidth = 1;
    context.globalAlpha = 0.18;
    context.beginPath();
    for (const bucket of buckets) {
      const x = xAt(bucket.time);
      context.moveTo(x, yAt(bucket.min));
      context.lineTo(x, yAt(bucket.max));
    }
    context.stroke();
    context.globalAlpha = 1;
    context.lineWidth = 1.35;
    context.beginPath();
    buckets.forEach((bucket, index) => {
      const x = xAt(bucket.time);
      const y = yAt(bucket.last);
      if (!index) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    context.fillStyle = colors.muted;
    context.font = '8px ui-monospace, monospace';
    context.textBaseline = 'top';
    context.fillText(compactNumber(maximum), 5, 4);
    context.textBaseline = 'bottom';
    context.fillText(compactNumber(minimum), 5, height - 4);

    const inspectionTime = state.navigatorHover?.time ?? state.hoverTime;
    if (inspectionTime !== null && inspectionTime >= state.range[0] && inspectionTime <= state.range[1]) {
      const x = xAt(inspectionTime);
      context.strokeStyle = colors.crosshair;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
      if (state.hoverTime !== null && state.hoverSignalId === signal.id) {
        this.showChartTooltip(card, history, state.hoverTime, x);
      }
    }
  }

  drawGrid(context, width, height, color) {
    context.strokeStyle = color;
    context.lineWidth = 1;
    for (let index = 1; index < 4; index += 1) {
      const x = Math.round(width * index / 4) + 0.5;
      const y = Math.round(height * index / 4) + 0.5;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }

  drawSelection(context, width, height, range, selectedRange, colors) {
    if (!selectedRange) return;
    const start = Math.max(range[0], selectedRange[0]);
    const end = Math.min(range[1], selectedRange[1]);
    if (end <= start) return;
    const x = (start - range[0]) / Math.max(1e-9, range[1] - range[0]) * width;
    const w = (end - start) / Math.max(1e-9, range[1] - range[0]) * width;
    context.fillStyle = colors.selectionFill;
    context.fillRect(x, 0, Math.max(1, w), height);
    context.strokeStyle = colors.selectionStroke;
    context.strokeRect(x + 0.5, 0.5, Math.max(1, w - 1), Math.max(1, height - 1));
  }

  showChartTooltip(card, history, hoverTime, x) {
    const sample = closestByTime(history, hoverTime);
    const tooltip = card.querySelector('[data-chart-tooltip]');
    if (!tooltip || !sample) return;
    tooltip.textContent = `${compactNumber(sample.value)}${sample.unit ? ` ${sample.unit}` : ''} · ${formatTime(sample.time)}`;
    tooltip.style.left = `${x}px`;
    tooltip.hidden = false;
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
      this.drawNavigatorSignals(context, range, y, bandHeight, width, colors, state.signals);
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

  drawNavigatorSignals(context, range, y, bandHeight, width, colors, signals) {
    const plotTop = y + 4;
    const plotHeight = Math.max(4, bandHeight - 8);
    for (const signal of signals) {
      const history = this.histories.get(signal.id) ?? [];
      const summary = summarizeSamples(history, range, Math.max(1, Math.floor(width / 2)));
      if (summary.count < 2) continue;
      const { minimum, maximum, buckets } = summary;
      const span = Math.max(1e-12, maximum - minimum);
      context.strokeStyle = colors.navigatorLine;
      context.globalAlpha = Math.max(0.12, Math.min(0.35, 1 / Math.sqrt(signals.length)));
      context.lineWidth = 1;
      context.beginPath();
      buckets.forEach((bucket, index) => {
        const x = (bucket.time - range[0]) / Math.max(1e-9, range[1] - range[0]) * width;
        const yy = plotTop + (maximum - bucket.last) / span * plotHeight;
        if (!index) context.moveTo(x, yy);
        else context.lineTo(x, yy);
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
