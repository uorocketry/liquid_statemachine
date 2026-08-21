import { DashboardTimeRenderer } from './dashboard-time-renderer.js';
import { clamp } from './dashboard-time-utils.js';
import { DashboardTimeInspection } from './dashboard-time-inspection.js';
import { DashboardTimeNavigation } from './dashboard-time-navigation.js';

export class DashboardTimeController {
  constructor(options) {
    Object.assign(this, options);
    this.plots = [];
    this.following = true;
    this.center = 0;
    this.hoverTime = null;
    this.hoverPlotId = null;
    this.navigatorHover = null;
    this.selectedRange = null;
    this.ranges = [];
    this.contextSeconds = 60;
    this.detailSeconds = 1;
    this.selectedTier = this.loadTier?.() ?? 'detail';
    this.renderer = new DashboardTimeRenderer({
      histories: this.histories,
      navigator: this.navigator,
      cardFor: (plotId) => this.cardFor(plotId),
    });
    this.inspection = new DashboardTimeInspection(this);
    this.navigation = new DashboardTimeNavigation(this);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.selectedRange) this.inspection.clearSelection();
    });
  }

  setPlots(plots) {
    this.plots = plots;
    this.inspection.bindCanvases();
    this.render();
  }

  ingest(timestamp) {
    if (this.following) this.center = timestamp;
    this.render();
  }

  bounds() {
    const active = this.plots
      .map((plot) => this.histories.get(plot.id) ?? [])
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
    this.sessionBounds = [start, end];
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
    for (const plot of this.plots) this.renderer.renderPlot(plot, state);
    this.renderer.renderNavigator(state);
    this.returnTail.hidden = this.following;
  }

  renderState() {
    return {
      plots: this.plots,
      ranges: this.ranges,
      range: this.selectedViewRange(),
      selectedTier: this.selectedTier,
      selectedRange: this.selectedRange,
      hoverTime: this.hoverTime,
      hoverPlotId: this.hoverPlotId,
      navigatorHover: this.navigatorHover,
      contextSeconds: this.contextSeconds,
      detailSeconds: this.detailSeconds,
      bounds: this.sessionBounds ?? this.bounds(),
      viewTime: this.center,
      following: this.following,
    };
  }
}
