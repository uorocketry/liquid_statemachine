import { loadConfiguration, previewConfiguration } from './daq-config/api.js';

const grid = document.querySelector('#telemetry-signal-grid');
const picker = document.querySelector('#telemetry-signal-options');
const status = document.querySelector('#telemetry-live-state');
const empty = document.querySelector('#telemetry-empty');
const histories = new Map();
let graph = { nodes: [], links: [] };
let signals = [];
let selected = new Set();
let timer = null;
let inFlight = false;

start().catch((error) => setStatus(error.message, 'error'));

async function start() {
  graph = (await loadConfiguration()).graph;
  signals = graph.nodes.filter((node) => node.nodeType === 'dashboard-signal');
  selected = loadSelection(signals);
  renderPicker();
  renderCards();
  picker.addEventListener('change', onSelectionChange);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else schedule(0);
  });
  schedule(0);
}

function renderPicker() {
  picker.replaceChildren();
  for (const group of ['Fuel', 'LOX', 'Engine']) {
    const groupSignals = signals.filter((node) => node.config?.group === group);
    if (!groupSignals.length) continue;
    const section = document.createElement('div');
    section.className = 'telemetry-picker-group';
    section.innerHTML = `<strong>${escapeHtml(group)}</strong>`;
    for (const signal of groupSignals) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${escapeAttribute(signal.id)}" ${selected.has(signal.id) ? 'checked' : ''} />
        <span>${escapeHtml(signal.config?.label || signal.title)}</span>`;
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
  empty.hidden = visible.length > 0;
  for (const signal of visible) grid.append(signalCard(signal));
}

function signalCard(signal) {
  const article = document.createElement('article');
  const display = signal.config?.display ?? 'both';
  article.className = 'blueprint-telemetry-card';
  article.dataset.signalId = signal.id;
  article.innerHTML = `
    <header><div><span>${escapeHtml(signal.config?.group ?? '')}</span><strong>${escapeHtml(signal.config?.label || signal.title)}</strong></div>
      ${display !== 'plot' ? '<output data-signal-value>—</output>' : ''}</header>
    ${display !== 'number' ? '<canvas data-signal-chart aria-label="Live signal plot"></canvas>' : ''}`;
  return article;
}

async function poll() {
  if (inFlight || document.hidden) return schedule(650);
  inFlight = true;
  try {
    const payload = await previewConfiguration(graph);
    for (const signal of signals) {
      if (!selected.has(signal.id)) continue;
      updateCard(signal, payload.values?.[signal.id]);
    }
    setStatus(payload.errors?.[0] ?? 'Live', payload.errors?.length ? 'warning' : 'live');
  } catch (error) {
    setStatus(error.status === 422 ? 'Configuration needs attention' : error.message, 'error');
  } finally {
    inFlight = false;
    schedule(650);
  }
}

function updateCard(signal, reading) {
  const card = grid.querySelector(`[data-signal-id="${cssEscape(signal.id)}"]`);
  if (!card) return;
  const output = card.querySelector('[data-signal-value]');
  if (output) output.textContent = reading ? formatReading(reading, signal.config?.precision) : '—';
  const canvas = card.querySelector('[data-signal-chart]');
  if (!canvas || !reading || !Number.isFinite(Number(reading.value))) return;
  const history = histories.get(signal.id) ?? [];
  history.push(Number(reading.value));
  if (history.length > 120) history.shift();
  histories.set(signal.id, history);
  drawHistory(canvas, history);
}

function drawHistory(canvas, values) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  if (values.length < 2) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-12, max - min);
  context.beginPath();
  values.forEach((value, index) => {
    const x = index / (values.length - 1) * width;
    const y = height - 8 - (value - min) / span * (height - 16);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.strokeStyle = '#007c69';
  context.lineWidth = 1.5;
  context.stroke();
}

function loadSelection(available) {
  const ids = new Set(available.map((node) => node.id));
  try {
    const stored = JSON.parse(localStorage.getItem('liquid-dashboard-signals') ?? 'null');
    if (Array.isArray(stored)) return new Set(stored.filter((id) => ids.has(id)));
  } catch { /* use all signals */ }
  return ids;
}

function formatReading(reading, precision = 1) {
  const value = Number(reading.value);
  return Number.isFinite(value) ? `${value.toFixed(Number(precision))}${reading.unit ? ` ${reading.unit}` : ''}` : '—';
}

function setStatus(message, kind) {
  status.textContent = message;
  status.className = `telemetry-live-state ${kind}`;
}

function schedule(delay) { stopPolling(); timer = window.setTimeout(poll, delay); }
function stopPolling() { if (timer) window.clearTimeout(timer); timer = null; }
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : value; }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
