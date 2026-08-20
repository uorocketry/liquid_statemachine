import { loadConfiguration, previewConfiguration } from './daq-config/api.js';
import { createSignalCard, updateSignalCard, usesTimeline } from './dashboard-signal-card.js';
import { DashboardTimeController } from './dashboard-time-controller.js';
import { compactHistory } from './dashboard-time-utils.js';

const GROUPS = ['Fuel', 'LOX', 'Engine'];
const POLL_MS = 250;
const MAX_HISTORY_POINTS = 100_000;
const PLACEHOLDER_LABELS = new Set(['dashboard signal', 'signal']);

const page = document.querySelector('.dashboard-page');
const grid = document.querySelector('#telemetry-signal-grid');
const picker = document.querySelector('#telemetry-signal-options');
const pickerDetails = document.querySelector('.telemetry-signal-picker');
const empty = document.querySelector('#telemetry-empty');
const timeControl = document.querySelector('#telemetry-time-control');
const navigatorWrap = document.querySelector('.telemetry-navigator-wrap');
const navigator = document.querySelector('#telemetry-tier-navigator');
const timeTooltip = document.querySelector('#telemetry-time-tooltip');
const returnTail = document.querySelector('#telemetry-return-tail');

const histories = new Map();
let graph = { nodes: [], links: [] };
let signals = [];
let selected = new Set();
let timer = null;
let inFlight = false;
let sessionStart = null;
let timeline = null;
let sampleSegment = 0;

async function start() {
  graph = (await loadConfiguration()).graph;
  signals = graph.nodes
    .filter((node) => node.nodeType === 'dashboard-signal')
    .filter(hasOperatorLabel);
  pickerDetails.hidden = signals.length === 0;
  selected = loadSelection(signals);
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

function hasOperatorLabel(signal) {
  const label = String(signal.config?.label ?? '').trim();
  return Boolean(label) && !PLACEHOLDER_LABELS.has(label.toLowerCase());
}

function renderPicker() {
  picker.replaceChildren();
  for (const group of GROUPS) {
    const groupSignals = signals.filter((node) => node.config?.group === group);
    if (!groupSignals.length) continue;
    const section = document.createElement('div');
    section.className = 'telemetry-picker-group';
    section.innerHTML = `<strong>${escapeHtml(group)}</strong>`;
    for (const signal of groupSignals) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${escapeAttribute(signal.id)}" ${selected.has(signal.id) ? 'checked' : ''} />
        <span>${escapeHtml(signal.config.label)}</span>`;
      section.append(label);
    }
    picker.append(section);
  }
}

function onSelectionChange() {
  selected = new Set([...picker.querySelectorAll('input:checked')].map((input) => input.value));
  localStorage.setItem('liquid-dashboard-signals', JSON.stringify([...selected]));
  renderCards();
  schedule(0);
}

function renderCards() {
  grid.replaceChildren();
  const visible = signals.filter((signal) => selected.has(signal.id));
  const timelineSignals = visible.filter(usesTimeline);
  empty.hidden = signals.length > 0;
  timeControl.hidden = signals.length === 0;
  navigatorWrap.hidden = timelineSignals.length === 0;

  for (const group of GROUPS) {
    const groupSignals = visible.filter((signal) => signal.config?.group === group);
    if (!groupSignals.length) continue;
    const section = document.createElement('section');
    section.className = 'dashboard-signal-group';
    const heading = document.createElement('h2');
    heading.textContent = group;
    const cards = document.createElement('div');
    cards.className = 'dashboard-group-grid';
    for (const signal of groupSignals) cards.append(createSignalCard(signal));
    section.append(heading, cards);
    grid.append(section);
  }
  timeline.setSignals(timelineSignals);
}

async function poll() {
  if (document.hidden) return stopPolling();
  if (inFlight || !signals.length) return schedule(POLL_MS);
  inFlight = true;
  try {
    const payload = await previewConfiguration(graph);
    const timestamp = elapsedSeconds();
    for (const signal of signals) {
      const reading = payload.values?.[signal.id];
      if (usesTimeline(signal) && reading && Number.isFinite(Number(reading.value))) {
        appendReading(signal, reading, timestamp);
      }
      if (selected.has(signal.id)) {
        updateSignalCard(
          grid.querySelector(`[data-signal-id="${cssEscape(signal.id)}"]`),
          signal,
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

function appendReading(signal, reading, timestamp) {
  const history = histories.get(signal.id) ?? [];
  history.push({
    time: timestamp,
    value: Number(reading.value),
    unit: reading.unit ?? '',
    segment: sampleSegment,
  });
  if (history.length > MAX_HISTORY_POINTS) compactHistory(history);
  histories.set(signal.id, history);
}

function clearCurrentValues() {
  for (const signal of signals) {
    if (selected.has(signal.id)) {
      updateSignalCard(
        grid.querySelector(`[data-signal-id="${cssEscape(signal.id)}"]`),
        signal,
        null,
      );
    }
  }
}

function loadSelection(available) {
  const ids = new Set(available.map((node) => node.id));
  try {
    const stored = JSON.parse(localStorage.getItem('liquid-dashboard-signals') ?? 'null');
    if (Array.isArray(stored)) return new Set(stored.filter((id) => ids.has(id)));
  } catch { /* use all configured operator signals */ }
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
  cardFor: (signalId) => grid.querySelector(`[data-signal-id="${cssEscape(signalId)}"]`),
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
