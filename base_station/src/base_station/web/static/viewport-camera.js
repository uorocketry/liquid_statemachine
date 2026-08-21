/** Shared world-space camera math for pan/zoom engineering canvases. */

export const ENGINEERING_CANVAS_MAX_SCALE = 8;
export const ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE = 0.05;

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
  const fitted = fitScaleForBounds(bounds, viewportRect, { padding, minScale, maxScale });
  const scale = clampScale(Number.isFinite(options.scale) ? options.scale : fitted, minScale, maxScale);
  return {
    scale,
    x: (viewportRect.width - width * scale) / 2 - bounds.x * scale,
    y: (viewportRect.height - height * scale) / 2 - bounds.y * scale,
  };
}

export function fitScaleForBounds(bounds, viewportRect, options = {}) {
  if (!bounds || !viewportRect?.width || !viewportRect?.height) return 1;
  const padding = Number(options.padding) || 0;
  const minScale = Number.isFinite(options.minScale)
    ? options.minScale
    : ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE;
  const maxScale = Number.isFinite(options.maxScale) ? options.maxScale : 1;
  const width = Math.max(1, Number(bounds.width) || 1);
  const height = Math.max(1, Number(bounds.height) || 1);
  const availableWidth = Math.max(1, viewportRect.width - padding * 2);
  const availableHeight = Math.max(1, viewportRect.height - padding * 2);
  return clampScale(Math.min(availableWidth / width, availableHeight / height), minScale, maxScale);
}

export function beginPan(camera, event, options = {}) {
  return {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    camera: { ...camera },
    moved: false,
    openOnClick: Boolean(options.openOnClick),
  };
}

export function updatePan(pan, event, threshold = 3) {
  const dx = event.clientX - pan.x;
  const dy = event.clientY - pan.y;
  const moved = pan.moved || Math.hypot(dx, dy) > threshold;
  return {
    moved,
    camera: moved ? panCamera(pan.camera, dx, dy) : pan.camera,
  };
}

export function animateCamera(from, to, onFrame, options = {}) {
  const duration = Math.max(0, Number(options.duration) || 180);
  if (!duration || typeof requestAnimationFrame !== 'function') {
    onFrame({ ...to });
    return () => {};
  }
  let cancelled = false;
  let frameId = 0;
  const started = performance.now();
  const tick = (now) => {
    if (cancelled) return;
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    onFrame({
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
      scale: from.scale + (to.scale - from.scale) * eased,
    });
    if (t < 1) frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    if (frameId) cancelAnimationFrame(frameId);
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
