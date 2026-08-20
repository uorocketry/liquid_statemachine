import { DashboardTimeRenderer } from './dashboard-time-renderer.js';
import { clamp, formatTime } from './dashboard-time-utils.js';

const TIERS = ['full', 'context', 'detail'];

export class DashboardTimeController {
  constructor(options) {
    Object.assign(this, options);
    this.signals = [];
    this.following = true;
    this.center = 0;
    this.hoverTime = null;
    this.hoverSignalId = null;
    this.navigatorHover = null;
    this.navigatorDrag = null;
    this.selectedRange = null;
    this.ranges = [];
    this.contextSeconds = 60;
    this.detailSeconds = 1;
    this.selectedTier = this.loadTier?.() ?? 'detail';
    this.renderer = new DashboardTimeRenderer({
      histories: this.histories,
      navigator: this.navigator,
      cardFor: (signalId) => this.cardFor(signalId),
    });

    this.navigator.addEventListener('pointerdown', (event) => this.startNavigate(event));
    this.navigator.addEventListener('pointermove', (event) => this.moveNavigator(event));
    this.navigator.addEventListener('pointerup', (event) => this.stopNavigate(event));
    this.navigator.addEventListener('pointercancel', (event) => this.cancelNavigate(event));
    this.navigator.addEventListener('pointerleave', () => this.leaveNavigator());
    this.returnTail.addEventListener('click', () => this.followTail());
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.selectedRange) this.clearSelection();
    });
  }

  setSignals(signals) {
    this.signals = signals;
    this.bindCanvases();
    this.render();
  }

  bindCanvases() {
    for (const signal of this.signals) {
      const canvas = this.cardFor(signal.id)?.querySelector('[data-signal-chart]');
      if (!canvas || canvas.dataset.timelineBound === 'true') continue;
      canvas.dataset.timelineBound = 'true';
      canvas.addEventListener('pointerdown', (event) => this.startInspect(event, signal.id));
      canvas.addEventListener('pointermove', (event) => this.moveInspect(event, signal.id));
      canvas.addEventListener('pointerup', (event) => this.finishInspect(event));
      canvas.addEventListener('pointercancel', (event) => this.finishInspect(event));
      canvas.addEventListener('pointerleave', () => this.clearInspection());
    }
  }

  ingest(timestamp) {
    if (this.following) this.center = timestamp;
    this.render();
  }

  bounds() {
    const active = this.signals
      .map((signal) => this.histories.get(signal.id) ?? [])
      .filter((history) => history.length);
    if (!active.length) return [0, 1];
    const start = Math.min(...active.map((history) => history[0].time));
    const end = Math.max(...active.map((history) => history.at(-1).time));
    return [start, Math.max(start + 0.001, end)];
  }

  windowAt(seconds, start, end, center = this.center) {
    const width = Math.min(seconds, end - start);
    if (width >= end - start) return [start, end];
    const low = clamp(center - width / 2, start, end - width);
    return [low, low + width];
  }

  buildRanges() {
    const [start, end] = this.bounds();
    if (this.following) this.center = end;
    this.center = clamp(this.center || end, start, end);
    this.ranges = [
      [start, end],
      this.windowAt(this.contextSeconds, start, end),
      this.windowAt(this.detailSeconds, start, end),
    ];
    return this.ranges;
  }

  selectedViewRange() {
    const index = { full: 0, context: 1, detail: 2 }[this.selectedTier] ?? 2;
    return this.ranges[index] ?? [0, 1];
  }

  render() {
    this.buildRanges();
    const state = this.renderState();
    for (const signal of this.signals) this.renderer.renderSignal(signal, state);
    this.renderer.renderNavigator(state);
    this.returnTail.hidden = this.following;
  }

  renderState() {
    return {
      signals: this.signals,
      ranges: this.ranges,
      range: this.selectedViewRange(),
      selectedTier: this.selectedTier,
      selectedRange: this.selectedRange,
      hoverTime: this.hoverTime,
      hoverSignalId: this.hoverSignalId,
      navigatorHover: this.navigatorHover,
      contextSeconds: this.contextSeconds,
      detailSeconds: this.detailSeconds,
    };
  }

  eventTime(event, canvas) {
    const bounds = canvas.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    const range = this.selectedViewRange();
    return range[0] + fraction * (range[1] - range[0]);
  }

  startInspect(event, signalId) {
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    const time = this.eventTime(event, canvas);
    this.chartDrag = {
      pointerId: event.pointerId,
      signalId,
      startClientX: event.clientX,
      startTime: time,
      currentTime: time,
      zoom: event.shiftKey,
      moved: false,
    };
    this.selectedRange = null;
    this.hoverTime = time;
    this.hoverSignalId = signalId;
    this.render();
  }

  moveInspect(event, signalId) {
    const canvas = event.currentTarget;
    const time = this.eventTime(event, canvas);
    if (this.chartDrag?.pointerId === event.pointerId) {
      this.chartDrag.currentTime = time;
      this.chartDrag.moved ||= Math.abs(event.clientX - this.chartDrag.startClientX) >= 4;
      if (this.chartDrag.moved) {
        this.following = false;
        this.selectedRange = orderedRange(this.chartDrag.startTime, time);
      }
    }
    this.hoverTime = time;
    this.hoverSignalId = signalId;
    this.render();
  }

  finishInspect(event) {
    const drag = this.chartDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const canvas = event.currentTarget;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    this.chartDrag = null;
    if (drag.moved && drag.zoom && this.selectedRange) this.zoomToSelection();
    else this.render();
  }

  zoomToSelection() {
    const [start, end] = this.selectedRange;
    const span = Math.max(0.001, end - start);
    const fullSpan = Math.max(0.001, this.bounds()[1] - this.bounds()[0]);
    this.contextSeconds = clamp(span, this.detailSeconds, fullSpan);
    this.center = (start + end) / 2;
    this.selectedTier = 'context';
    this.following = false;
    this.selectedRange = null;
    this.onTierChange?.(this.selectedTier);
    this.render();
  }

  clearInspection() {
    if (this.chartDrag) return;
    this.hoverTime = null;
    this.hoverSignalId = null;
    for (const tooltip of this.grid.querySelectorAll('[data-chart-tooltip]')) tooltip.hidden = true;
    this.render();
  }

  clearSelection() {
    this.selectedRange = null;
    this.render();
  }

  navigatorPosition(event) {
    const bounds = this.navigator.getBoundingClientRect();
    const bandHeight = bounds.height / 3;
    const index = clamp(Math.floor((event.clientY - bounds.top) / Math.max(1, bandHeight)), 0, 2);
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    return { bounds, bandHeight, index, fraction };
  }

  startNavigate(event) {
    const { bounds, bandHeight, index, fraction } = this.navigatorPosition(event);
    const range = [...(this.ranges[index] ?? this.bounds())];
    this.navigatorDrag = {
      pointerId: event.pointerId,
      index,
      range,
      bounds,
      bandHeight,
      startClientX: event.clientX,
      moved: false,
    };
    this.navigator.setPointerCapture(event.pointerId);
    this.updateNavigatorInspection(index, this.timeAtFraction(range, fraction), fraction, bounds, bandHeight);
  }

  moveNavigator(event) {
    if (this.navigator.hasPointerCapture(event.pointerId)) this.scrubNavigator(event);
    else this.previewNavigator(event);
  }

  stopNavigate(event) {
    const drag = this.navigatorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const fraction = this.navigatorFraction(event.clientX, drag.bounds);
    const time = this.timeAtFraction(drag.range, fraction);
    if (this.navigator.hasPointerCapture(event.pointerId)) this.navigator.releasePointerCapture(event.pointerId);
    this.navigatorDrag = null;
    if (!drag.moved) {
      this.selectedTier = TIERS[drag.index];
      this.onTierChange?.(this.selectedTier);
      this.center = time;
      this.following = false;
      this.selectedRange = null;
    }
    const inside = event.clientX >= drag.bounds.left && event.clientX <= drag.bounds.right
      && event.clientY >= drag.bounds.top && event.clientY <= drag.bounds.bottom;
    this.navigatorHover = inside ? { index: drag.index, time } : null;
    this.tooltip.hidden = !inside;
    this.render();
  }

  cancelNavigate(event) {
    const drag = this.navigatorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (this.navigator.hasPointerCapture(event.pointerId)) this.navigator.releasePointerCapture(event.pointerId);
    this.navigatorDrag = null;
    this.navigatorHover = null;
    this.tooltip.hidden = true;
    this.render();
  }

  leaveNavigator() {
    if (this.navigatorDrag) return;
    this.navigatorHover = null;
    this.tooltip.hidden = true;
    this.renderer.renderNavigator(this.renderState());
  }

  scrubNavigator(event) {
    const drag = this.navigatorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.moved ||= Math.abs(event.clientX - drag.startClientX) >= 4;
    const fraction = this.navigatorFraction(event.clientX, drag.bounds);
    const time = this.timeAtFraction(drag.range, fraction);
    if (drag.moved) {
      this.center = time;
      this.following = false;
      this.selectedRange = null;
    }
    this.updateNavigatorInspection(drag.index, time, fraction, drag.bounds, drag.bandHeight, drag.moved);
  }

  previewNavigator(event) {
    const { bounds, bandHeight, index, fraction } = this.navigatorPosition(event);
    const range = this.ranges[index] ?? this.bounds();
    const time = this.timeAtFraction(range, fraction);
    this.updateNavigatorInspection(index, time, fraction, bounds, bandHeight);
  }

  updateNavigatorInspection(index, time, fraction, bounds, bandHeight, renderAll = false) {
    this.navigatorHover = { index, time };
    this.tooltip.textContent = formatTime(time);
    this.tooltip.style.left = `${fraction * bounds.width}px`;
    this.tooltip.style.top = `${(index + 0.5) * bandHeight}px`;
    this.tooltip.hidden = false;
    if (renderAll) this.render();
    else this.renderer.renderNavigator(this.renderState());
  }

  navigatorFraction(clientX, bounds) {
    return clamp((clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
  }

  timeAtFraction(range, fraction) {
    return range[0] + fraction * (range[1] - range[0]);
  }

  followTail() {
    this.following = true;
    this.center = this.bounds()[1];
    this.selectedRange = null;
    this.render();
  }
}

function orderedRange(first, second) {
  return first <= second ? [first, second] : [second, first];
}
