import { loadDashboardLayout, loadGraph, saveDashboardLayout } from './daq-config/api.js';
import { DashboardLayoutEditor } from './dashboard-layout-editor.js';
import { visibleWidgets } from './dashboard-layout-model.js';
import {
  DASHBOARD_NODE_TYPES,
  createDashboardWidget,
  updateDashboardWidget,
  usesTimeline,
} from './dashboard-widget-registry.js';
import { DashboardTimeController } from './dashboard-time-controller.js';
import { compactHistory } from './dashboard-time-utils.js';

const MAX_HISTORY_POINTS = 100_000;

const page = document.querySelector('.dashboard-page');
const grid = document.querySelector('#dashboard-widget-grid');
const picker = document.querySelector('#dashboard-widget-options');
const pickerDetails = document.querySelector('.dashboard-widget-picker');
const empty = document.querySelector('#telemetry-empty');
const timeControl = document.querySelector('#telemetry-time-control');
const navigatorWrap = document.querySelector('.telemetry-navigator-wrap');
const navigator = document.querySelector('#telemetry-tier-navigator');
const timeTooltip = document.querySelector('#telemetry-time-tooltip');
const returnTail = document.querySelector('#telemetry-return-tail');
const editButton = document.querySelector('#dashboard-layout-edit');
const cancelButton = document.querySelector('#dashboard-layout-cancel');
const saveButton = document.querySelector('#dashboard-layout-save');

const histories = new Map();
let graph = { nodes: [], links: [] };
let widgets = [];
let telemetryStream = null;
let sessionStart = null;
let sampleSegment = 0;

const timeline = new DashboardTimeController({
  histories,
  grid,
  navigator,
  tooltip: timeTooltip,
  returnTail,
  cardFor: (widgetId) => grid.querySelector(`[data-widget-id="${cssEscape(widgetId)}"]`),
  loadTier,
  onTierChange: () => localStorage.setItem('liquid-dashboard-tier', timeline.selectedTier),
});

const layoutEditor = new DashboardLayoutEditor({
  grid,
  picker,
  pickerDetails,
  timeControl,
  editButton,
  cancelButton,
  saveButton,
  onLayoutChange: (layout) => renderCards(layout),
  onGeometryChange: () => timeline.render(),
  onSave: async (layout) => {
    const result = await saveDashboardLayout(layout);
    return result.layout;
  },
  onError: () => { page.dataset.telemetryState = 'error'; },
});

async function start() {
  const [graphPayload, layoutPayload] = await Promise.all([
    loadGraph(),
    loadDashboardLayout(),
  ]);
  graph = graphPayload.graph;
  widgets = graph.nodes
    .filter((node) => DASHBOARD_NODE_TYPES.has(node.nodeType))
    .filter(hasOperatorLabel);
  layoutEditor.configure(widgets, layoutPayload.layout ?? { items: {} });
  renderCards(layoutEditor.currentLayout());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTelemetryStream();
    } else {
      sampleSegment += 1;
      startTelemetryStream();
    }
  });
  window.addEventListener('resize', () => timeline.render());
  startTelemetryStream();
}

function hasOperatorLabel(widget) {
  return Boolean(String(widget.config?.label ?? '').trim());
}

function renderCards(layout) {
  grid.replaceChildren();
  const visible = visibleWidgets(widgets, layout);
  const timelinePlots = visible.filter(usesTimeline);
  empty.hidden = widgets.length > 0;
  timeControl.hidden = widgets.length === 0;
  timeControl.classList.toggle('telemetry-no-timeline', timelinePlots.length === 0);
  navigatorWrap.hidden = layoutEditor.editing || timelinePlots.length === 0;

  for (const widget of visible) {
    const card = createDashboardWidget(widget);
    layoutEditor.decorateCard(card, widget);
    grid.append(card);
  }
  timeline.setPlots(timelinePlots);
}

function startTelemetryStream() {
  if (telemetryStream || document.hidden || !widgets.length || !('EventSource' in window)) return;
  const stream = new EventSource('/api/dashboard/telemetry/events');
  let opened = false;
  telemetryStream = stream;
  stream.addEventListener('open', () => {
    if (opened) sampleSegment += 1;
    opened = true;
  });
  stream.addEventListener('telemetry', (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.issues?.length) {
      page.dataset.telemetryState = 'configuration';
      clearCurrentValues();
      return;
    }
    ingestTelemetry(payload);
  });
  stream.addEventListener('error', () => {
    page.dataset.telemetryState = 'error';
  });
}

function stopTelemetryStream() {
  telemetryStream?.close();
  telemetryStream = null;
}

function ingestTelemetry(payload) {
  const timestamp = elapsedSeconds();
  for (const widget of widgets) {
    const reading = payload.values?.[widget.id];
    if (usesTimeline(widget) && reading && Number.isFinite(Number(reading.value))) {
      appendReading(widget, reading, timestamp);
    }
    const card = grid.querySelector(`[data-widget-id="${cssEscape(widget.id)}"]`);
    if (card) updateDashboardWidget(card, widget, reading);
  }
  page.dataset.telemetryState = payload.errors?.length ? 'unavailable' : 'ready';
  timeline.ingest(timestamp);
}

function elapsedSeconds() {
  const now = performance.now() / 1000;
  if (sessionStart === null) sessionStart = now;
  return now - sessionStart;
}

function appendReading(widget, reading, timestamp) {
  const history = histories.get(widget.id) ?? [];
  history.push({
    time: timestamp,
    value: Number(reading.value),
    unit: reading.unit ?? '',
    segment: sampleSegment,
  });
  if (history.length > MAX_HISTORY_POINTS) compactHistory(history);
  histories.set(widget.id, history);
}

function clearCurrentValues() {
  for (const widget of widgets) {
    const card = grid.querySelector(`[data-widget-id="${cssEscape(widget.id)}"]`);
    if (card) updateDashboardWidget(card, widget, null);
  }
}

start().catch(() => {
  page.dataset.telemetryState = 'error';
});

function loadTier() {
  const saved = localStorage.getItem('liquid-dashboard-tier');
  return ['full', 'context', 'detail'].includes(saved) ? saved : 'detail';
}
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : value; }
