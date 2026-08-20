import { loadConfiguration, previewConfiguration } from './daq-config/api.js';
import {
  DASHBOARD_NODE_TYPES,
  createDashboardWidget,
  updateDashboardWidget,
  usesTimeline,
} from './dashboard-widget-registry.js';
import { DashboardTimeController } from './dashboard-time-controller.js';
import { compactHistory } from './dashboard-time-utils.js';

const GROUPS = ['Fuel', 'LOX', 'Engine'];
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

const histories = new Map();
let graph = { nodes: [], links: [] };
let widgets = [];
let selected = new Set();
let timer = null;
let inFlight = false;
let sessionStart = null;
let timeline = null;
let sampleSegment = 0;

async function start() {
  graph = (await loadConfiguration()).graph;
  widgets = graph.nodes
    .filter((node) => DASHBOARD_NODE_TYPES.has(node.nodeType))
    .filter(hasOperatorLabel);
  pickerDetails.hidden = widgets.length === 0;
  selected = loadSelection(widgets);
  renderPicker();
  renderCards();
  picker.addEventListener('change', onSelectionChange);
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

function renderPicker() {
  picker.replaceChildren();
  for (const group of GROUPS) {
    const groupWidgets = widgets.filter((node) => node.config?.group === group);
    if (!groupWidgets.length) continue;
    const section = document.createElement('div');
    section.className = 'telemetry-picker-group';
    section.innerHTML = `<strong>${escapeHtml(group)}</strong>`;
    for (const widget of groupWidgets) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${escapeAttribute(widget.id)}" ${selected.has(widget.id) ? 'checked' : ''} />
        <span>${escapeHtml(widget.config.label)}</span>`;
      section.append(label);
    }
    picker.append(section);
  }
}

function onSelectionChange() {
  selected = new Set([...picker.querySelectorAll('input:checked')].map((input) => input.value));
  localStorage.setItem('liquid-dashboard-widgets', JSON.stringify([...selected]));
  renderCards();
  schedule(0);
}

function renderCards() {
  grid.replaceChildren();
  const visible = widgets.filter((widget) => selected.has(widget.id));
  const timelinePlots = visible.filter(usesTimeline);
  empty.hidden = widgets.length > 0;
  timeControl.hidden = widgets.length === 0;
  navigatorWrap.hidden = timelinePlots.length === 0;

  for (const group of GROUPS) {
    const groupWidgets = visible.filter((widget) => widget.config?.group === group);
    if (!groupWidgets.length) continue;
    const section = document.createElement('section');
    section.className = 'dashboard-widget-group';
    const heading = document.createElement('h2');
    heading.textContent = group;
    const cards = document.createElement('div');
    cards.className = 'dashboard-group-grid';
    for (const widget of groupWidgets) cards.append(createDashboardWidget(widget));
    section.append(heading, cards);
    grid.append(section);
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
      if (selected.has(widget.id)) {
        updateDashboardWidget(
          grid.querySelector(`[data-widget-id="${cssEscape(widget.id)}"]`),
          widget,
          reading,
        );
      }
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
    if (selected.has(widget.id)) {
      updateDashboardWidget(
        grid.querySelector(`[data-widget-id="${cssEscape(widget.id)}"]`),
        widget,
        null,
      );
    }
  }
}

function loadSelection(available) {
  const ids = new Set(available.map((node) => node.id));
  try {
    const stored = JSON.parse(localStorage.getItem('liquid-dashboard-widgets') ?? 'null');
    if (Array.isArray(stored)) return new Set(stored.filter((id) => ids.has(id)));
  } catch { /* use all configured dashboard widgets */ }
  return ids;
}

function schedule(delay) {
  stopPolling();
  timer = window.setTimeout(poll, delay);
}

function stopPolling() {
  if (timer) window.clearTimeout(timer);
  timer = null;
}

timeline = new DashboardTimeController({
  histories,
  grid,
  navigator,
  tooltip: timeTooltip,
  returnTail,
  cardFor: (widgetId) => grid.querySelector(`[data-widget-id="${cssEscape(widgetId)}"]`),
  loadTier,
  onTierChange: () => localStorage.setItem('liquid-dashboard-tier', timeline.selectedTier),
});

start().catch(() => {
  page.dataset.telemetryState = 'error';
});

function loadTier() {
  const saved = localStorage.getItem('liquid-dashboard-tier');
  return ['full', 'context', 'detail'].includes(saved) ? saved : 'detail';
}
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : value; }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
