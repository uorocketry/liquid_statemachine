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
}

export function minSize(nodeType) {
  const [w, h] = MIN_SIZES[nodeType] ?? [2, 1];
  return { w, h };
}

export function setVisible(layout, widgetId, visible) {
  const item = layout.items?.[widgetId];
  if (!item) return false;
  item.visible = Boolean(visible);
  if (item.visible && collides(item, layout, widgetId)) {
    const position = firstOpenPosition(item.w, item.h, layout, widgetId);
    item.x = position.x;
    item.y = position.y;
  }
  return true;
}

export function canPlace(layout, widgetId, candidate) {
  if (!candidate || candidate.x < 0 || candidate.y < 0) return false;
  if (candidate.w < 1 || candidate.h < 1 || candidate.x + candidate.w > DASHBOARD_COLUMNS) return false;
  return !collides(candidate, layout, widgetId);
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

export function firstOpenPosition(width, height, layout, ignoredId = null) {
  for (let y = 0; y <= 10_000; y += 1) {
    for (let x = 0; x <= DASHBOARD_COLUMNS - width; x += 1) {
      const candidate = { x, y, w: width, h: height, visible: true };
      if (!collides(candidate, layout, ignoredId)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function collides(candidate, layout, ignoredId) {
  return Object.entries(layout?.items ?? {}).some(([id, other]) => (
    id !== ignoredId && other?.visible !== false && overlaps(candidate, other)
  ));
}

function overlaps(first, second) {
  return !(
    first.x + first.w <= second.x
    || second.x + second.w <= first.x
    || first.y + first.h <= second.y
    || second.y + second.h <= first.y
  );
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}
