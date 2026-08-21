import { loadConfiguration, previewConfiguration, saveDashboardLayout } from './daq-config/api.js';
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

const POLL_MS = 250;
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
let graph = { nodes: [], links: [], metadata: {} };
let widgets = [];
let timer = null;
let inFlight = false;
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
    graph.metadata.dashboardLayout = result.layout;
    return result.layout;
  },
  onError: () => { page.dataset.telemetryState = 'error'; },
});

async function start() {
  graph = (await loadConfiguration()).graph;
  widgets = graph.nodes
    .filter((node) => DASHBOARD_NODE_TYPES.has(node.nodeType))
    .filter(hasOperatorLabel);
  layoutEditor.configure(widgets, graph.metadata?.dashboardLayout ?? { items: {} });
  renderCards(layoutEditor.currentLayout());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      sampleSegment += 1;
      schedule(0);
    }
  });
  window.addEventListener('resize', () => timeline.render());
  schedule(0);
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

async function poll() {
  if (document.hidden) return stopPolling();
  if (inFlight || !widgets.length) return schedule(POLL_MS);
  inFlight = true;
  try {
    const payload = await previewConfiguration(graph);
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
  } catch (error) {
    sampleSegment += 1;
    page.dataset.telemetryState = error.status === 422 ? 'configuration' : 'error';
    clearCurrentValues();
  } finally {
    inFlight = false;
    if (document.hidden) stopPolling();
    else schedule(POLL_MS);
  }
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

function schedule(delay) {
  stopPolling();
  timer = window.setTimeout(poll, delay);
}

function stopPolling() {
  if (timer) window.clearTimeout(timer);
  timer = null;
}

start().catch(() => {
  page.dataset.telemetryState = 'error';
});

function loadTier() {
  const saved = localStorage.getItem('liquid-dashboard-tier');
  return ['full', 'context', 'detail'].includes(saved) ? saved : 'detail';
}
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : value; }
