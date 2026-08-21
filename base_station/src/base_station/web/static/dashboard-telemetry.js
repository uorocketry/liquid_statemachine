import {
  loadDashboardLayout,
  loadGraph,
  resetDashboardHistory,
  saveDashboardLayout,
} from './daq-config/api.js';
import { DashboardLayoutEditor } from './dashboard-layout-editor.js';
import { visibleWidgets } from './dashboard-layout-model.js';
import { DashboardWorkspace } from './dashboard-workspace.js';
import {
  DASHBOARD_NODE_TYPES,
  createDashboardWidget,
  updateDashboardWidget,
  usesTimeline,
} from './dashboard-widget-registry.js';
import { DashboardTimeController } from './dashboard-time-controller.js';

const page = document.querySelector('.dashboard-page');
const viewport = document.querySelector('#dashboard-viewport');
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
const resetHistoryButton = document.querySelector('#dashboard-history-reset');
const frameButton = document.querySelector('#dashboard-frame-workspace');
const presetButtons = [...document.querySelectorAll('[data-dashboard-camera-slot]')];

const histories = new Map();
let graph = { nodes: [], links: [] };
let widgets = [];
let telemetryStream = null;
let sessionId = null;
let historyRetentionSeconds = 600;

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

let layoutEditor;
const workspace = new DashboardWorkspace({
  viewport,
  world: grid,
  frameButton,
  presetButtons,
  onCameraChange: () => timeline.render(),
  onMetricsChange: () => layoutEditor?.syncFrameStack(),
  onSavePreset: (slot, preset) => layoutEditor?.saveCameraPreset(slot, preset),
});

layoutEditor = new DashboardLayoutEditor({
  grid,
  workspace,
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
  workspace.configure(widgets, layoutEditor.currentLayout());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTelemetryStream();
    } else {
      startTelemetryStream();
    }
  });
  resetHistoryButton.addEventListener('click', resetLiveSession);
  startTelemetryStream();
}

function hasOperatorLabel(widget) {
  return Boolean(String(widget.config?.label ?? '').trim());
}

function renderCards(layout) {
  workspace.syncLayout(layout);
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
  telemetryStream = stream;
  stream.addEventListener('history', (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    restoreHistory(payload);
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
  if (sessionId !== null && payload.sessionId !== sessionId) return;
  const timestamp = Number(payload.timestamp);
  if (!Number.isFinite(timestamp)) return;
  for (const widget of widgets) {
    const reading = payload.values?.[widget.id];
    if (usesTimeline(widget) && reading && Number.isFinite(Number(reading.value))) {
      appendReading(widget, reading, timestamp, payload.segments?.[widget.id] ?? 0);
    }
    const card = grid.querySelector(`[data-widget-id="${cssEscape(widget.id)}"]`);
    if (card) updateDashboardWidget(card, widget, reading);
  }
  page.dataset.telemetryState = payload.errors?.length ? 'unavailable' : 'ready';
  timeline.ingest(timestamp);
}

function appendReading(widget, reading, timestamp, segment) {
  const history = histories.get(widget.id) ?? [];
  history.push({
    time: timestamp,
    value: Number(reading.value),
    unit: reading.unit ?? '',
    segment: Number(segment) || 0,
  });
  const cutoff = timestamp - historyRetentionSeconds;
  while (history.length && history[0].time < cutoff) history.shift();
  histories.set(widget.id, history);
}

function restoreHistory(payload) {
  sessionId = payload.session?.id ?? null;
  historyRetentionSeconds = Number(payload.session?.retentionSeconds) || 600;
  histories.clear();
  for (const widget of widgets.filter(usesTimeline)) {
    const samples = Array.isArray(payload.histories?.[widget.id]) ? payload.histories[widget.id] : [];
    histories.set(widget.id, samples.filter((sample) => (
      Number.isFinite(Number(sample?.time)) && Number.isFinite(Number(sample?.value))
    )));
  }
  renderLatest(payload.latest);
}

function renderLatest(payload) {
  if (!payload) {
    timeline.render();
    return;
  }
  for (const widget of widgets) {
    const card = grid.querySelector(`[data-widget-id="${cssEscape(widget.id)}"]`);
    if (card) updateDashboardWidget(card, widget, payload.values?.[widget.id]);
  }
  page.dataset.telemetryState = payload.errors?.length ? 'unavailable' : 'ready';
  const timestamp = Number(payload.timestamp);
  if (Number.isFinite(timestamp)) timeline.ingest(timestamp);
  else timeline.render();
}

async function resetLiveSession() {
  if (!confirm('Start a new live Dashboard session? Recent live history will be cleared. Saved recordings are not deleted.')) return;
  resetHistoryButton.disabled = true;
  try {
    await resetDashboardHistory();
  } finally {
    resetHistoryButton.disabled = false;
  }
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
