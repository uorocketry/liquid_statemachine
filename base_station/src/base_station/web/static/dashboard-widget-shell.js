export function createWidgetCard(node) {
  const card = document.createElement('article');
  card.className = 'dashboard-widget';
  card.dataset.widgetId = node.id;
  card.dataset.widgetType = node.nodeType;

  const header = document.createElement('header');
  const label = document.createElement('strong');
  label.textContent = node.config?.label ?? '';
  header.append(label);
  card.append(header);
  return { card, header };
}

export function formatReading(reading, precision = 1, showUnits = true) {
  const value = Number(reading?.value);
  if (!Number.isFinite(value)) return '—';
  const digits = Number.isInteger(Number(precision)) ? Number(precision) : 1;
  const unit = showUnits && reading?.unit ? ` ${reading.unit}` : '';
  return `${value.toFixed(digits)}${unit}`;
}
