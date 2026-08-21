/** Shared world-space camera math for pan/zoom engineering canvases. */

export function clampScale(scale, minScale, maxScale) {
  return Math.max(minScale, Math.min(maxScale, Number(scale) || 1));
}

export function worldPoint(camera, viewportRect, clientX, clientY) {
  return {
    x: (clientX - viewportRect.left - camera.x) / camera.scale,
    y: (clientY - viewportRect.top - camera.y) / camera.scale,
  };
}

export function panCamera(camera, dx, dy) {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

export function zoomCameraAt(camera, viewportRect, clientX, clientY, nextScale) {
  const before = worldPoint(camera, viewportRect, clientX, clientY);
  return {
    scale: nextScale,
    x: clientX - viewportRect.left - before.x * nextScale,
    y: clientY - viewportRect.top - before.y * nextScale,
  };
}

export function cameraForBounds(bounds, viewportRect, options = {}) {
  const padding = Number(options.padding) || 0;
  const minScale = Number.isFinite(options.minScale) ? options.minScale : 0.1;
  const maxScale = Number.isFinite(options.maxScale) ? options.maxScale : 4;
  const width = Math.max(1, Number(bounds.width) || 1);
  const height = Math.max(1, Number(bounds.height) || 1);
  const availableWidth = Math.max(1, viewportRect.width - padding * 2);
  const availableHeight = Math.max(1, viewportRect.height - padding * 2);
  const fitted = Math.min(availableWidth / width, availableHeight / height);
  const scale = clampScale(
    Number.isFinite(options.scale) ? options.scale : fitted,
    minScale,
    maxScale,
  );
  return {
    scale,
    x: (viewportRect.width - width * scale) / 2 - bounds.x * scale,
    y: (viewportRect.height - height * scale) / 2 - bounds.y * scale,
  };
}

export function cameraForWorldCenter(point, viewportRect, scale) {
  return {
    scale,
    x: viewportRect.width / 2 - point.x * scale,
    y: viewportRect.height / 2 - point.y * scale,
  };
}

export function worldCenter(camera, viewportRect) {
  return {
    x: (viewportRect.width / 2 - camera.x) / camera.scale,
    y: (viewportRect.height / 2 - camera.y) / camera.scale,
  };
}

export function cameraTransform(camera) {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
}
