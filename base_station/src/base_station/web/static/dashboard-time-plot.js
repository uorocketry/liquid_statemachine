import { createWidgetCard } from './dashboard-widget-shell.js';

export function createTimePlotWidget(node) {
  const { card } = createWidgetCard(node);
  const shell = document.createElement('div');
  shell.className = 'dashboard-chart-shell';
  const canvas = document.createElement('canvas');
  canvas.dataset.signalChart = '';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${node.config?.label ?? 'Signal'} time plot`);
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End');
  const tooltip = document.createElement('output');
  tooltip.className = 'dashboard-chart-tooltip';
  tooltip.dataset.chartTooltip = '';
  tooltip.hidden = true;
  const summary = document.createElement('span');
  summary.className = 'dashboard-chart-accessible';
  summary.dataset.chartAccessible = '';
  summary.id = `dashboard-chart-summary-${node.id}`;
  canvas.setAttribute('aria-describedby', summary.id);
  shell.append(canvas, tooltip, summary);
  card.append(shell);
  return card;
}
