import './engineering-canvas-zoom.js';
import {
  ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE,
  ENGINEERING_CANVAS_MAX_SCALE,
  beginPan,
  cameraForBounds,
  cameraTransform,
  clampScale,
  updatePan,
  worldPoint,
  zoomCameraAt,
} from './viewport-camera.js';
import { dashboardGridMetrics } from './dashboard-layout-model.js';

/** Pan/zoom shell shared only by Dashboard authoring pages. */
export class DashboardAuthoringCanvas {
  constructor({ viewport, world, overlay = null, zoomControl = null, getBounds, onChange }) {
    this.viewport = viewport;
    this.world = world;
    this.overlay = overlay;
    this.zoomControl = zoomControl;
    this.getBounds = getBounds;
    this.onChange = onChange;
    this.camera = { x: 24, y: 24, scale: 1 };
    this.metricsCache = dashboardGridMetrics(viewport);
    this.tool = 'select';
    this.pan = null;
    this.bind();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
  }

  get scale() { return this.camera.scale; }
  metrics() { return this.metricsCache; }
  setTool(tool) {
    this.tool = tool === 'hand' ? 'hand' : 'select';
    this.viewport.dataset.canvasTool = this.tool;
  }

  start() {
    requestAnimationFrame(() => this.fit());
  }

  fit() {
    const bounds = this.getBounds?.();
    if (!bounds) return;
    this.camera = cameraForBounds(bounds, this.viewport.getBoundingClientRect(), {
      padding: 32,
      minScale: ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE,
      maxScale: 1,
    });
    this.apply();
  }

  worldPointAt(clientX, clientY) {
    return worldPoint(this.camera, this.viewport.getBoundingClientRect(), clientX, clientY);
  }

  apply() {
    const transform = cameraTransform(this.camera);
    this.world.style.transform = transform;
    if (this.overlay) this.overlay.style.transform = transform;
    const metrics = this.metricsCache;
    this.viewport.style.setProperty('--engineering-grid-x', `${this.camera.x}px`);
    this.viewport.style.setProperty('--engineering-grid-y', `${this.camera.y}px`);
    this.viewport.style.setProperty('--engineering-grid-major-x', `${metrics.columnStep * this.camera.scale}px`);
    this.viewport.style.setProperty('--engineering-grid-major-y', `${metrics.rowStep * this.camera.scale}px`);
    this.viewport.style.setProperty('--engineering-grid-minor-x', `${metrics.columnStep * this.camera.scale / 4}px`);
    this.viewport.style.setProperty('--engineering-grid-minor-y', `${metrics.rowStep * this.camera.scale / 4}px`);
    if (this.zoomControl) this.zoomControl.scale = this.camera.scale;
    this.onChange?.();
  }

  resize() {
    this.metricsCache = dashboardGridMetrics(this.viewport);
    this.apply();
  }

  zoomTo(scale) {
    const rect = this.viewport.getBoundingClientRect();
    const next = clampScale(scale, ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE, ENGINEERING_CANVAS_MAX_SCALE);
    this.camera = zoomCameraAt(this.camera, rect, rect.left + rect.width / 2, rect.top + rect.height / 2, next);
    this.apply();
  }

  bind() {
    this.zoomControl?.addEventListener('engineering-canvas-zoom-request', (event) => {
      if (event.detail?.kind === 'fit') this.fit();
      else if (event.detail?.kind === 'scale') this.zoomTo(event.detail.scale);
    });
    this.viewport.addEventListener('pointerdown', (event) => {
      const handPan = event.button === 0 && this.tool === 'hand';
      if (!handPan && ![1, 2].includes(event.button)) return;
      if (event.target.closest('.dashboard-authoring-controls, engineering-canvas-zoom')) return;
      if (!handPan && event.target.closest('button, input, summary, details, a')) return;
      this.pan = beginPan(this.camera, event);
      this.viewport.dataset.canvasPanning = 'true';
      this.viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    this.viewport.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.dashboard-authoring-controls, engineering-canvas-zoom')) return;
      event.preventDefault();
    });
    this.viewport.addEventListener('pointermove', (event) => {
      if (!this.pan || this.pan.pointerId !== event.pointerId) return;
      const update = updatePan(this.pan, event);
      this.pan.moved = update.moved;
      if (!update.moved) return;
      this.camera = update.camera;
      this.apply();
    });
    const finish = (event) => {
      if (!this.pan || this.pan.pointerId !== event.pointerId) return;
      this.pan = null;
      delete this.viewport.dataset.canvasPanning;
      if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
    };
    this.viewport.addEventListener('pointerup', finish);
    this.viewport.addEventListener('pointercancel', finish);
    this.viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      const scale = clampScale(
        this.camera.scale * Math.exp(-event.deltaY * 0.0012),
        ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE,
        ENGINEERING_CANVAS_MAX_SCALE,
      );
      this.camera = zoomCameraAt(this.camera, rect, event.clientX, event.clientY, scale);
      this.apply();
    }, { passive: false });
  }
}
