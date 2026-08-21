import { updateDashboardWidget, usesHistory, usesTimeline } from './dashboard-widget-registry.js';
import { closestByTime } from './dashboard-time-utils.js';
import { bindPageResource } from './page-resource-lifecycle.js';

/** SSE/live-history adapter used only by the read-only Dashboard page. */
export class DashboardLiveStream {
  constructor({ page, widgets, grid, histories, timeline }) {
    this.page = page;
    this.widgets = widgets;
    this.grid = grid;
    this.histories = histories;
    this.timeline = timeline;
    this.stream = null;
    this.sessionId = null;
    this.retentionSeconds = 600;
    this.latestValues = {};
  }

  bind() {
    bindPageResource({
      start: () => this.start(),
      stop: () => this.stop(),
      pauseWhenHidden: true,
    });
  }

  start() {
    if (this.stream || document.hidden || !this.widgets.length || !('EventSource' in window)) return;
    this.stream = new EventSource('/api/dashboard/telemetry/events');
    this.stream.addEventListener('history', (event) => {
      const payload = parsePayload(event.data);
      if (payload) this.restore(payload);
    });
    this.stream.addEventListener('telemetry', (event) => {
      const payload = parsePayload(event.data);
      if (payload) this.ingest(payload);
    });
    this.stream.addEventListener('error', () => {
      this.page.dataset.telemetryState = 'error';
    });
  }

  stop() {
    this.stream?.close();
    this.stream = null;
  }

  restore(payload) {
    this.sessionId = payload.session?.id ?? null;
    this.retentionSeconds = Number(payload.session?.retentionSeconds) || 600;
    this.histories.clear();
    for (const widget of this.widgets.filter(usesHistory)) {
      const samples = Array.isArray(payload.histories?.[widget.id]) ? payload.histories[widget.id] : [];
      this.histories.set(widget.id, samples.filter((sample) => (
        Number.isFinite(Number(sample?.time)) && Number.isFinite(Number(sample?.value))
      )));
    }
    this.renderLatest(payload.latest);
  }

  ingest(payload) {
    if (this.sessionId !== null && payload.sessionId !== this.sessionId) return;
    if (payload.issues?.length) {
      this.page.dataset.telemetryState = 'configuration';
      this.clearValues();
      return;
    }
    const timestamp = Number(payload.timestamp);
    if (!Number.isFinite(timestamp)) return;
    this.latestValues = payload.values ?? {};
    for (const widget of this.widgets) {
      const reading = payload.values?.[widget.id];
      if (usesHistory(widget) && reading && Number.isFinite(Number(reading.value))) {
        this.append(widget, reading, timestamp, payload.segments?.[widget.id] ?? 0);
      }
      if (!usesHistory(widget) || this.timeline.following) this.updateCard(widget, reading);
    }
    this.page.dataset.telemetryState = payload.errors?.length ? 'unavailable' : 'ready';
    this.timeline.ingest(timestamp);
  }

  append(widget, reading, timestamp, segment) {
    const history = this.histories.get(widget.id) ?? [];
    history.push({
      time: timestamp,
      value: Number(reading.value),
      unit: reading.unit ?? '',
      segment: Number(segment) || 0,
    });
    const cutoff = timestamp - this.retentionSeconds;
    while (history.length && history[0].time < cutoff) history.shift();
    this.histories.set(widget.id, history);
  }

  renderLatest(payload) {
    if (!payload) {
      this.timeline.render();
      return;
    }
    this.latestValues = payload.values ?? {};
    for (const widget of this.widgets) this.updateCard(widget, payload.values?.[widget.id]);
    this.page.dataset.telemetryState = payload.errors?.length ? 'unavailable' : 'ready';
    const timestamp = Number(payload.timestamp);
    if (Number.isFinite(timestamp)) this.timeline.ingest(timestamp);
    else this.timeline.render();
  }

  clearValues() {
    this.latestValues = {};
    for (const widget of this.widgets) this.updateCard(widget, null);
  }

  renderHistoryState(state) {
    const inspectionTime = state.hoverTime ?? (state.following ? null : state.viewTime);
    for (const widget of this.widgets) {
      if (!usesHistory(widget) || usesTimeline(widget)) continue;
      const reading = inspectionTime === null
        ? this.latestValues[widget.id]
        : closestByTime(this.histories.get(widget.id) ?? [], inspectionTime);
      this.updateCard(widget, reading);
    }
  }

  updateCard(widget, reading) {
    const card = this.grid.querySelector(`[data-widget-id="${cssEscape(widget.id)}"]`);
    if (card) updateDashboardWidget(card, widget, reading);
  }
}

function parsePayload(data) {
  try { return JSON.parse(data); } catch { return null; }
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value;
}
