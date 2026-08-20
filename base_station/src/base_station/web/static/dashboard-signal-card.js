import { createGauge, updateGauge } from './dashboard-gauge.js';

export function createSignalCard(signal) {
  const display = signal.config?.display ?? 'both';
  const article = document.createElement('article');
  article.className = 'dashboard-signal-card';
  article.dataset.signalId = signal.id;
  article.dataset.display = display;

  const header = document.createElement('header');
  const label = document.createElement('strong');
  label.textContent = signal.config?.label ?? '';
  header.append(label);
  if (display === 'number' || display === 'both') {
    const output = document.createElement('output');
    output.dataset.signalValue = '';
    output.textContent = '—';
    header.append(output);
  }
  article.append(header);

  if (usesTimeline(signal)) article.append(createPlot(signal));
  else if (display === 'gauge') article.append(createGauge(signal));
  return article;
}

export function updateSignalCard(card, signal, reading) {
  if (!card) return;
  const output = card.querySelector('[data-signal-value]');
  if (output) output.textContent = formatReading(reading, signal.config?.precision);
  if (signal.config?.display === 'gauge') {
    updateGauge(card.querySelector('.dashboard-gauge'), signal, reading);
  }
}

export function usesTimeline(signal) {
  return ['plot', 'both'].includes(signal.config?.display ?? 'both');
}

function createPlot(signal) {
  const shell = document.createElement('div');
  shell.className = 'dashboard-chart-shell';
  const canvas = document.createElement('canvas');
  canvas.dataset.signalChart = '';
  canvas.setAttribute('aria-label', `${signal.config?.label ?? 'Signal'} history`);
  const tooltip = document.createElement('output');
  tooltip.className = 'dashboard-chart-tooltip';
  tooltip.dataset.chartTooltip = '';
  tooltip.hidden = true;
  shell.append(canvas, tooltip);
  return shell;
}

function formatReading(reading, precision = 1) {
  const value = Number(reading?.value);
  if (!Number.isFinite(value)) return '—';
  const digits = Number.isInteger(Number(precision)) ? Number(precision) : 1;
  return `${value.toFixed(digits)}${reading?.unit ? ` ${reading.unit}` : ''}`;
}
