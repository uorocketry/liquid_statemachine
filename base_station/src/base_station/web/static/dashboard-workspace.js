import {
  cameraForBounds,
  cameraForWorldCenter,
  cameraTransform,
  clampScale,
  panCamera,
  worldCenter,
  zoomCameraAt,
} from './viewport-camera.js';
import {
  DASHBOARD_MAX_SCALE,
  DASHBOARD_MIN_SCALE,
  DASHBOARD_REFERENCE_COLUMNS,
  itemWorldBounds,
  layoutWorldBounds,
} from './dashboard-layout-model.js';

/** Camera + viewport interaction for the snap-grid Dashboard world. */
export class DashboardWorkspace {
  constructor(options) {
    Object.assign(this, options);
    this.camera = { x: 24, y: 24, scale: 1 };
    this.layout = { items: {}, cameraPresets: {} };
    this.widgets = [];
    this.pan = null;
    this.initialized = false;
    this.cameraFrame = 0;
    this.metricsCache = this.readMetrics();
    this.viewportSize = { width: this.viewport.clientWidth, height: this.viewport.clientHeight };
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.bind();
  }

  get scale() { return this.camera.scale; }
  metrics() { return this.metricsCache; }

  configure(widgets, layout) {
    this.widgets = widgets;
    this.syncLayout(layout);
    if (!this.initialized) {
      this.initialized = true;
      requestAnimationFrame(() => this.frame());
    }
  }

  syncLayout(layout) {
    this.layout = layout ?? { items: {}, cameraPresets: {} };
    this.updatePresetButtons();
  }

  setEditing(editing) {
    this.viewport.classList.toggle('dashboard-layout-editing', Boolean(editing));
  }

  frame() {
    const bounds = layoutWorldBounds(this.widgets, this.layout, this.metricsCache);
    if (!bounds) return;
    const rect = this.viewport.getBoundingClientRect();
    this.camera = cameraForBounds(bounds, rect, {
      padding: 32,
      minScale: DASHBOARD_MIN_SCALE,
      maxScale: 1,
    });
    this.applyCamera();
  }

  revealItem(item) {
    if (!item) return;
    const rect = this.viewport.getBoundingClientRect();
    const bounds = itemWorldBounds(item, this.metricsCache);
    const margin = 24;
    const left = this.camera.x + bounds.x * this.camera.scale;
    const top = this.camera.y + bounds.y * this.camera.scale;
    const right = left + bounds.width * this.camera.scale;
    const bottom = top + bounds.height * this.camera.scale;
    if (left >= margin && top >= margin && right <= rect.width - margin && bottom <= rect.height - margin) return;
    this.camera = cameraForWorldCenter(
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      rect,
      this.camera.scale,
    );
    this.applyCamera();
  }

  recallPreset(slot) {
    const preset = this.layout?.cameraPresets?.[String(slot)];
    if (!preset) return false;
    const rect = this.viewport.getBoundingClientRect();
    const metrics = this.metricsCache;
    const scale = clampScale(preset.scale, DASHBOARD_MIN_SCALE, DASHBOARD_MAX_SCALE);
    this.camera = cameraForWorldCenter(
      { x: preset.x * metrics.columnStep, y: preset.y * metrics.rowStep },
      rect,
      scale,
    );
    this.applyCamera();
    return true;
  }

  savePreset(slot) {
    const rect = this.viewport.getBoundingClientRect();
    const center = worldCenter(this.camera, rect);
    const preset = {
      x: center.x / this.metricsCache.columnStep,
      y: center.y / this.metricsCache.rowStep,
      scale: this.camera.scale,
    };
    const layout = this.onSavePreset?.(String(slot), preset);
    if (layout) this.syncLayout(layout);
  }

  readMetrics() {
    const style = getComputedStyle(this.viewport);
    const gap = Number.parseFloat(style.getPropertyValue('--dashboard-gap')) || 8;
    const rowHeight = Number.parseFloat(style.getPropertyValue('--dashboard-row-height')) || 48;
    const width = Math.max(1, this.viewport.clientWidth);
    const columnWidth = Math.max(40, (width - gap * (DASHBOARD_REFERENCE_COLUMNS - 1)) / DASHBOARD_REFERENCE_COLUMNS);
    return {
      gap,
      rowHeight,
      columnWidth,
      columnStep: columnWidth + gap,
      rowStep: rowHeight + gap,
    };
  }

  onResize() {
    const previous = this.metricsCache;
    const previousRect = { left: 0, top: 0, ...this.viewportSize };
    const center = worldCenter(this.camera, previousRect);
    const gridCenter = {
      x: center.x / previous.columnStep,
      y: center.y / previous.rowStep,
    };
    this.metricsCache = this.readMetrics();
    const rect = this.viewport.getBoundingClientRect();
    this.viewportSize = { width: rect.width, height: rect.height };
    this.camera = cameraForWorldCenter(
      {
        x: gridCenter.x * this.metricsCache.columnStep,
        y: gridCenter.y * this.metricsCache.rowStep,
      },
      rect,
      this.camera.scale,
    );
    this.onMetricsChange?.();
    this.applyCamera();
  }

  applyCamera() {
    this.world.style.transform = cameraTransform(this.camera);
    const metrics = this.metricsCache;
    this.viewport.style.setProperty('--dashboard-grid-x', `${this.camera.x}px`);
    this.viewport.style.setProperty('--dashboard-grid-y', `${this.camera.y}px`);
    this.viewport.style.setProperty('--dashboard-grid-column', `${metrics.columnStep * this.camera.scale}px`);
    this.viewport.style.setProperty('--dashboard-grid-row', `${metrics.rowStep * this.camera.scale}px`);
    if (!this.cameraFrame) {
      this.cameraFrame = requestAnimationFrame(() => {
        this.cameraFrame = 0;
        this.onCameraChange?.();
      });
    }
  }

  updatePresetButtons() {
    for (const button of this.presetButtons ?? []) {
      const saved = Boolean(this.layout?.cameraPresets?.[button.dataset.dashboardCameraSlot]);
      button.classList.toggle('saved', saved);
      const slot = button.dataset.dashboardCameraSlot;
      button.title = saved
        ? `View ${slot} · Shift-click or Shift+${slot} to replace`
        : `Shift-click or Shift+${slot} to save this view`;
    }
  }

  bind() {
    this.frameButton?.addEventListener('click', () => this.frame());
    for (const button of this.presetButtons ?? []) {
      button.addEventListener('click', (event) => {
        const slot = button.dataset.dashboardCameraSlot;
        if (event.shiftKey) this.savePreset(slot);
        else this.recallPreset(slot);
      });
    }
    this.viewport.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.viewport.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.viewport.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.viewport.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    this.viewport.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.resizeObserver.observe(this.viewport);
  }

  onPointerDown(event) {
    if (![0, 1].includes(event.button)) return;
    if (event.target.closest('[data-dashboard-frame], a, button, input, summary, details')) return;
    this.pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera: { ...this.camera },
    };
    this.viewport.setPointerCapture(event.pointerId);
    this.viewport.classList.add('dashboard-panning');
    event.preventDefault();
  }

  onPointerMove(event) {
    if (!this.pan || this.pan.pointerId !== event.pointerId) return;
    this.camera = panCamera(
      this.pan.camera,
      event.clientX - this.pan.x,
      event.clientY - this.pan.y,
    );
    this.applyCamera();
  }

  onPointerUp(event) {
    if (!this.pan || this.pan.pointerId !== event.pointerId) return;
    this.pan = null;
    this.viewport.classList.remove('dashboard-panning');
    if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
  }

  onWheel(event) {
    event.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const scale = clampScale(
      this.camera.scale * Math.exp(-event.deltaY * 0.0012),
      DASHBOARD_MIN_SCALE,
      DASHBOARD_MAX_SCALE,
    );
    this.camera = zoomCameraAt(this.camera, rect, event.clientX, event.clientY, scale);
    this.applyCamera();
  }

  onKeyDown(event) {
    const slot = /^Digit[123]$/.test(event.code) ? event.code.slice(-1) : event.key;
    if (!['1', '2', '3'].includes(slot)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target.matches?.('input, textarea, select') || target.isContentEditable) return;
    if (event.shiftKey) this.savePreset(slot);
    else this.recallPreset(slot);
    event.preventDefault();
  }
}
