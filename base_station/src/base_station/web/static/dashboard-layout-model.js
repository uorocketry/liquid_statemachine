export const DASHBOARD_REFERENCE_COLUMNS = 12;
export const DASHBOARD_MAX_ITEM_WIDTH = 24;
export const DASHBOARD_MAX_ITEM_HEIGHT = 12;
export const DASHBOARD_WORLD_LIMIT = 10_000;
export const DASHBOARD_MIN_SCALE = 0.5;
export const DASHBOARD_MAX_SCALE = 1.5;

const MIN_SIZES = {
  number: [2, 1],
  gauge: [3, 4],
  'time-plot': [5, 4],
};

export function cloneLayout(layout) {
  return structuredClone(layout ?? { items: {}, cameraPresets: {} });
}

export function visibleWidgets(widgets, layout) {
  return widgets.filter((widget) => itemFor(layout, widget.id)?.visible !== false);
}

export function itemFor(layout, widgetId) {
  return layout?.items?.[widgetId] ?? null;
}

export function applyWidgetGeometry(card, item, metrics) {
  if (!card || !item || !metrics) return;
  const width = item.w * metrics.columnWidth + Math.max(0, item.w - 1) * metrics.gap;
  const height = item.h * metrics.rowHeight + Math.max(0, item.h - 1) * metrics.gap;
  card.style.left = `${item.x * metrics.columnStep}px`;
  card.style.top = `${item.y * metrics.rowStep}px`;
  card.style.width = `${width}px`;
  card.style.height = `${height}px`;
  card.style.zIndex = String(item.z ?? 0);
}

export function itemWorldBounds(item, metrics) {
  const width = item.w * metrics.columnWidth + Math.max(0, item.w - 1) * metrics.gap;
  const height = item.h * metrics.rowHeight + Math.max(0, item.h - 1) * metrics.gap;
  return {
    x: item.x * metrics.columnStep,
    y: item.y * metrics.rowStep,
    width,
    height,
  };
}

export function layoutWorldBounds(widgets, layout, metrics) {
  const bounds = widgets
    .map((widget) => itemFor(layout, widget.id))
    .filter((item) => item?.visible !== false)
    .map((item) => itemWorldBounds(item, metrics));
  if (!bounds.length) return null;
  const minX = Math.min(...bounds.map((box) => box.x));
  const minY = Math.min(...bounds.map((box) => box.y));
  const maxX = Math.max(...bounds.map((box) => box.x + box.width));
  const maxY = Math.max(...bounds.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
    x: clamp(item.x + dx, -DASHBOARD_WORLD_LIMIT, DASHBOARD_WORLD_LIMIT),
    y: clamp(item.y + dy, -DASHBOARD_WORLD_LIMIT, DASHBOARD_WORLD_LIMIT),
  };
}

export function clampResize(item, nodeType, dw, dh) {
  const minimum = minSize(nodeType);
  return {
    ...item,
    w: clamp(item.w + dw, minimum.w, DASHBOARD_MAX_ITEM_WIDTH),
    h: clamp(item.h + dh, minimum.h, DASHBOARD_MAX_ITEM_HEIGHT),
  };
}

export function setCameraPreset(layout, slot, preset) {
  if (!['1', '2', '3'].includes(String(slot))) return false;
  layout.cameraPresets ??= {};
  layout.cameraPresets[String(slot)] = {
    x: Number(preset.x),
    y: Number(preset.y),
    scale: Number(preset.scale),
  };
  return true;
}

function numericZ(item) {
  return Number.isInteger(item?.z) ? item.z : 0;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}
