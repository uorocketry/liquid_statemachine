import { itemWorldBounds, viewWorldBounds } from './dashboard-layout-model.js';

/** Map canonical 100%-zoom world boxes into the read-only Dashboard viewport. */
export function projectionForView(view, metrics, viewport) {
  const source = viewWorldBounds(view, metrics);
  if (!source?.width || !source?.height || !viewport?.width || !viewport?.height) return null;
  return {
    source,
    scaleX: viewport.width / source.width,
    scaleY: viewport.height / source.height,
  };
}

export function projectWorldBounds(bounds, projection) {
  if (!bounds || !projection) return null;
  const { source, scaleX, scaleY } = projection;
  return {
    x: (bounds.x - source.x) * scaleX,
    y: (bounds.y - source.y) * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY,
  };
}

export function projectedItemBounds(item, view, metrics, viewport) {
  return projectWorldBounds(
    itemWorldBounds(item, metrics),
    projectionForView(view, metrics, viewport),
  );
}

export function applyProjectedWidgetGeometry(card, item, view, metrics, viewport) {
  const bounds = projectedItemBounds(item, view, metrics, viewport);
  if (!card || !bounds) return false;
  Object.assign(card.style, {
    left: `${bounds.x}px`,
    top: `${bounds.y}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    zIndex: String(item.z ?? 0),
  });
  return true;
}
