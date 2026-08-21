export const DASHBOARD_COLUMNS = 12;

const MIN_SIZES = {
  number: [2, 1],
  gauge: [3, 4],
  'time-plot': [5, 4],
};

export function cloneLayout(layout) {
  return structuredClone(layout ?? { items: {} });
}

export function visibleWidgets(widgets, layout) {
  return widgets.filter((widget) => itemFor(layout, widget.id)?.visible !== false);
}

export function itemFor(layout, widgetId) {
  return layout?.items?.[widgetId] ?? null;
}

export function applyWidgetGeometry(card, item) {
  if (!card || !item) return;
  card.style.gridColumn = `${item.x + 1} / span ${item.w}`;
  card.style.gridRow = `${item.y + 1} / span ${item.h}`;
  card.style.zIndex = String(item.z ?? 0);
}

export function minSize(nodeType) {
  const [w, h] = MIN_SIZES[nodeType] ?? [2, 1];
  return { w, h };
}

export function setVisible(layout, widgetId, visible) {
  const item = layout.items?.[widgetId];
  if (!item) return false;
  item.visible = Boolean(visible);
  if (item.visible) bringToFront(layout, widgetId);
  return true;
}

export function bringToFront(layout, widgetId) {
  const entries = Object.entries(layout?.items ?? {});
  const target = layout?.items?.[widgetId];
  if (!target) return false;
  const ordered = entries
    .filter(([id]) => id !== widgetId)
    .sort(([, first], [, second]) => numericZ(first) - numericZ(second));
  ordered.push([widgetId, target]);
  ordered.forEach(([, item], index) => { item.z = index; });
  return true;
}

export function clampMove(item, dx, dy) {
  return {
    ...item,
    x: clamp(item.x + dx, 0, DASHBOARD_COLUMNS - item.w),
    y: Math.max(0, item.y + dy),
  };
}

export function clampResize(item, nodeType, dw, dh) {
  const minimum = minSize(nodeType);
  return {
    ...item,
    w: clamp(item.w + dw, minimum.w, DASHBOARD_COLUMNS - item.x),
    h: clamp(item.h + dh, minimum.h, 12),
  };
}

function numericZ(item) {
  return Number.isInteger(item?.z) ? item.z : 0;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}
