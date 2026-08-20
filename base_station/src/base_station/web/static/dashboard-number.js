import { createWidgetCard, formatReading } from './dashboard-widget-shell.js';

export function createNumberWidget(node) {
  const { card, header } = createWidgetCard(node);
  const output = document.createElement('output');
  output.dataset.widgetValue = '';
  output.textContent = '—';
  header.append(output);
  return card;
}

export function updateNumberWidget(card, node, reading) {
  const output = card?.querySelector('[data-widget-value]');
  if (!output) return;
  output.textContent = formatReading(
    reading,
    node.config?.precision,
    node.config?.showUnits !== false,
  );
}
