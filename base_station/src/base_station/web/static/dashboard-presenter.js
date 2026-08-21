import { loadDashboardLayout, loadGraph } from './daq-config/api.js';
import { DashboardLiveStream } from './dashboard-live-stream.js';
import {
  applyWidgetGeometry,
  dashboardGridMetrics,
  itemFor,
  viewFor,
  visibleWidgets,
} from './dashboard-layout-model.js';
import { DashboardTimeController } from './dashboard-time-controller.js';
import { applyProjectedWidgetGeometry } from './dashboard-view-projection.js';
import {
  DASHBOARD_NODE_TYPES,
  createDashboardWidget,
  usesTimeline,
} from './dashboard-widget-registry.js';

const page = document.querySelector('.dashboard-page');
const viewport = document.querySelector('#dashboard-viewport');
const grid = document.querySelector('#dashboard-widget-grid');
const empty = document.querySelector('#telemetry-empty');
const timeControl = document.querySelector('#telemetry-time-control');
const navigator = document.querySelector('#telemetry-tier-navigator');
const tooltip = document.querySelector('#telemetry-time-tooltip');
const returnTail = document.querySelector('#telemetry-return-tail');

const histories = new Map();
let widgets = [];
let layout = { items: {}, views: {} };
let activeViewSlot = null;
let metrics = null;
let stream = null;

const timeline = new DashboardTimeController({
  histories,
  grid,
  navigator,
  tooltip,
  returnTail,
  cardFor: (widgetId) => grid.querySelector(`[data-widget-id="${cssEscape(widgetId)}"]`),
  loadTier,
  onTierChange: () => localStorage.setItem('liquid-dashboard-tier', timeline.selectedTier),
  onRender: (state) => stream?.renderHistoryState(state),
});

async function start() {
  const [graphPayload, layoutPayload] = await Promise.all([loadGraph(), loadDashboardLayout()]);
  widgets = graphPayload.graph.nodes
    .filter((node) => DASHBOARD_NODE_TYPES.has(node.nodeType))
    .filter((node) => String(node.config?.label ?? '').trim());
  layout = layoutPayload.layout ?? { items: {}, views: {} };
  activeViewSlot = initialViewSlot();
  renderCards();
  bindViewKeys();
  new ResizeObserver(() => syncGeometry()).observe(viewport);
  stream = new DashboardLiveStream({ page, widgets, grid, histories, timeline });
  stream.bind();
}

function renderCards() {
  grid.replaceChildren();
  const visible = visibleWidgets(widgets, layout);
  for (const widget of visible) grid.append(createDashboardWidget(widget));
  const plots = visible.filter(usesTimeline);
  timeline.setPlots(plots);
  timeControl.hidden = plots.length === 0;
  empty.hidden = widgets.length > 0;
  syncGeometry();
}

function syncGeometry() {
  metrics = dashboardGridMetrics(viewport);
  const rect = viewport.getBoundingClientRect();
  const view = activeViewSlot ? viewFor(layout, activeViewSlot) : null;
  viewport.dataset.dashboardView = activeViewSlot ?? '';
  for (const card of grid.querySelectorAll('[data-widget-id]')) {
    const item = itemFor(layout, card.dataset.widgetId);
    if (!item) continue;
    if (view) applyProjectedWidgetGeometry(card, item, view, metrics, rect);
    else applyWidgetGeometry(card, item, metrics);
  }
  timeline.render();
}

function bindViewKeys() {
  window.addEventListener('keydown', (event) => {
    if (!/^Digit[123]$/.test(event.code) || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target.matches?.('input, textarea, select') || target.isContentEditable) return;
    const slot = event.code.slice(-1);
    if (!viewFor(layout, slot)) return;
    activeViewSlot = slot;
    localStorage.setItem('liquid-dashboard-view', slot);
    syncGeometry();
    event.preventDefault();
  });
}

function initialViewSlot() {
  const saved = localStorage.getItem('liquid-dashboard-view');
  if (saved && viewFor(layout, saved)) return saved;
  return ['1', '2', '3'].find((slot) => viewFor(layout, slot)) ?? null;
}

function loadTier() {
  const saved = localStorage.getItem('liquid-dashboard-tier');
  return ['full', 'context', 'detail'].includes(saved) ? saved : 'detail';
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value;
}

start().catch(() => { page.dataset.telemetryState = 'error'; });
