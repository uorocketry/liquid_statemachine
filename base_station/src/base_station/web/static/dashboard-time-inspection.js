import { plotTimeRange } from './dashboard-plot-axis.js';
import { clamp } from './dashboard-time-utils.js';

export class DashboardTimeInspection {
  constructor(controller) {
    this.controller = controller;
  }

  bindCanvases() {
    const controller = this.controller;
    for (const plot of controller.plots) {
      const canvas = controller.cardFor(plot.id)?.querySelector('[data-signal-chart]');
      if (!canvas || canvas.dataset.timelineBound === 'true') continue;
      canvas.dataset.timelineBound = 'true';
      canvas.addEventListener('pointerdown', (event) => this.start(event, plot.id));
      canvas.addEventListener('pointermove', (event) => this.move(event, plot.id));
      canvas.addEventListener('pointerup', (event) => this.finish(event));
      canvas.addEventListener('pointercancel', (event) => this.finish(event));
      canvas.addEventListener('pointerleave', () => this.clear());
      canvas.addEventListener('keydown', (event) => this.byKeyboard(event, plot.id));
      canvas.addEventListener('blur', () => this.endKeyboard(plot.id));
    }
  }

  eventTime(event, canvas, plotId) {
    const controller = this.controller;
    const bounds = canvas.getBoundingClientRect();
    const axis = controller.renderer.axisFor(plotId);
    const plot = controller.plots.find((candidate) => candidate.id === plotId);
    const history = controller.histories.get(plotId) ?? [];
    const range = axis?.xRange ?? plotTimeRange(plot, controller.renderState(), history);
    const plotLeft = axis?.frame?.left ?? 0;
    const plotWidth = axis?.frame?.width ?? bounds.width;
    const localX = event.clientX - bounds.left;
    const fraction = clamp((localX - plotLeft) / Math.max(1, plotWidth), 0, 1);
    return range[0] + fraction * (range[1] - range[0]);
  }

  start(event, plotId) {
    const controller = this.controller;
    const canvas = event.currentTarget;
    this.setTooltipAnnouncement(plotId, false);
    canvas.setPointerCapture(event.pointerId);
    const time = this.eventTime(event, canvas, plotId);
    controller.chartDrag = {
      pointerId: event.pointerId,
      plotId,
      startClientX: event.clientX,
      startTime: time,
      currentTime: time,
      zoom: event.shiftKey,
      moved: false,
    };
    controller.selectedRange = null;
    controller.hoverTime = time;
    controller.hoverPlotId = plotId;
    controller.render();
  }

  move(event, plotId) {
    const controller = this.controller;
    const canvas = event.currentTarget;
    const time = this.eventTime(event, canvas, plotId);
    if (controller.chartDrag?.pointerId === event.pointerId) {
      controller.chartDrag.currentTime = time;
      controller.chartDrag.moved ||= Math.abs(event.clientX - controller.chartDrag.startClientX) >= 4;
      if (controller.chartDrag.moved) {
        controller.following = false;
        controller.selectedRange = orderedRange(controller.chartDrag.startTime, time);
      }
    }
    controller.hoverTime = time;
    controller.hoverPlotId = plotId;
    controller.render();
  }

  finish(event) {
    const controller = this.controller;
    const drag = controller.chartDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const canvas = event.currentTarget;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    controller.chartDrag = null;
    const plot = controller.plots.find((candidate) => candidate.id === drag.plotId);
    if (drag.moved && drag.zoom && controller.selectedRange && plot?.config?.xRangeMode === 'shared') {
      this.zoomToSelection();
    } else controller.render();
  }

  byKeyboard(event, plotId) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const controller = this.controller;
    const plot = controller.plots.find((candidate) => candidate.id === plotId);
    const history = controller.histories.get(plotId) ?? [];
    if (!plot || !history.length) return;
    const range = plotTimeRange(plot, controller.renderState(), history);
    const first = firstIndexAtOrAfter(history, range[0]);
    const last = lastIndexAtOrBefore(history, range[1]);
    if (first < 0 || last < first) return;

    let index;
    if (event.key === 'Home') index = first;
    else if (event.key === 'End') index = last;
    else {
      const reference = controller.hoverPlotId === plotId && controller.hoverTime !== null
        ? controller.hoverTime : range[1];
      index = closestIndex(history, reference, first, last);
      index = clamp(index + (event.key === 'ArrowLeft' ? -1 : 1), first, last);
    }
    controller.hoverTime = history[index].time;
    controller.hoverPlotId = plotId;
    controller.selectedRange = null;
    this.setTooltipAnnouncement(plotId, true);
    controller.render();
    event.preventDefault();
  }

  endKeyboard(plotId) {
    const controller = this.controller;
    this.setTooltipAnnouncement(plotId, false);
    if (controller.hoverPlotId !== plotId || controller.chartDrag) return;
    controller.hoverTime = null;
    controller.hoverPlotId = null;
    controller.render();
  }

  setTooltipAnnouncement(plotId, enabled) {
    const tooltip = this.controller.cardFor(plotId)?.querySelector('[data-chart-tooltip]');
    if (!tooltip) return;
    if (enabled) {
      tooltip.setAttribute('role', 'status');
      tooltip.setAttribute('aria-live', 'polite');
    } else {
      tooltip.removeAttribute('role');
      tooltip.removeAttribute('aria-live');
    }
  }

  zoomToSelection() {
    const controller = this.controller;
    const [start, end] = controller.selectedRange;
    const span = Math.max(0.001, end - start);
    const fullSpan = Math.max(0.001, controller.bounds()[1] - controller.bounds()[0]);
    controller.contextSeconds = clamp(span, controller.detailSeconds, fullSpan);
    controller.center = (start + end) / 2;
    controller.selectedTier = 'context';
    controller.following = false;
    controller.selectedRange = null;
    controller.onTierChange?.(controller.selectedTier);
    controller.render();
  }

  clear() {
    const controller = this.controller;
    if (controller.chartDrag) return;
    controller.hoverTime = null;
    controller.hoverPlotId = null;
    for (const tooltip of controller.grid.querySelectorAll('[data-chart-tooltip]')) tooltip.hidden = true;
    controller.render();
  }

  clearSelection() {
    this.controller.selectedRange = null;
    this.controller.render();
  }
}

function orderedRange(first, second) {
  return first <= second ? [first, second] : [second, first];
}

function firstIndexAtOrAfter(samples, time) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low < samples.length ? low : -1;
}

function lastIndexAtOrBefore(samples, time) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function closestIndex(samples, time, first, last) {
  let low = first;
  let high = last;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const after = clamp(low, first, last);
  const before = clamp(after - 1, first, last);
  return Math.abs(samples[before].time - time) <= Math.abs(samples[after].time - time) ? before : after;
}
