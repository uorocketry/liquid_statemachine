import {
  applyWidgetGeometry,
  clampMove,
  clampResize,
  itemFor,
  itemWorldBounds,
} from './dashboard-layout-model.js';

/** Marquee selection plus grid-snapped group movement for Dashboard Layout. */
export class DashboardLayoutSelection {
  constructor({ viewport, grid, layer, canvas, widgets, getLayout, getTool, onChange }) {
    this.viewport = viewport;
    this.grid = grid;
    this.layer = layer;
    this.canvas = canvas;
    this.widgets = widgets;
    this.getLayout = getLayout;
    this.getTool = getTool;
    this.onChange = onChange;
    this.selected = new Set();
    this.drag = null;
    this.marquee = null;
    viewport.addEventListener('pointerdown', (event) => this.pointerDown(event));
    window.addEventListener('pointermove', (event) => this.pointerMove(event));
    window.addEventListener('pointerup', (event) => this.pointerUp(event));
    window.addEventListener('pointercancel', (event) => this.pointerUp(event));
  }

  pointerDown(event) {
    if (event.button !== 0 || this.getTool() !== 'select') return;
    if (event.target.closest('.dashboard-authoring-controls, engineering-canvas-zoom')) return;
    const card = event.target.closest('[data-dashboard-frame]');
    const resize = event.target.closest('[data-dashboard-resize-handle]');
    if (card) this.beginCardInteraction(card, resize, event);
    else this.beginMarquee(event);
  }

  beginCardInteraction(card, resize, event) {
    const id = card.dataset.widgetId;
    const layout = this.getLayout();
    const widget = this.widgets.find((candidate) => candidate.id === id);
    const item = itemFor(layout, id);
    if (!widget || !item) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (resize) this.selected = new Set([id]);
    else if (additive) this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    else if (!this.selected.has(id)) this.selected = new Set([id]);
    this.syncSelection();
    if (!this.selected.has(id)) return;

    const origins = new Map();
    for (const selectedId of this.selected) {
      const selectedItem = itemFor(layout, selectedId);
      if (selectedItem) origins.set(selectedId, { ...selectedItem });
    }
    this.drag = {
      pointerId: event.pointerId,
      mode: resize ? 'resize' : 'move',
      id,
      widget,
      startX: event.clientX,
      startY: event.clientY,
      origins,
      moved: false,
    };
    this.viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  beginMarquee(event) {
    const point = this.canvas.worldPointAt(event.clientX, event.clientY);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    this.marquee = {
      pointerId: event.pointerId,
      start: point,
      current: point,
      base: additive ? new Set(this.selected) : new Set(),
    };
    if (!additive) this.selected.clear();
    this.viewport.setPointerCapture(event.pointerId);
    this.renderMarquee();
    this.syncSelection();
    event.preventDefault();
  }

  pointerMove(event) {
    if (this.marquee?.pointerId === event.pointerId) {
      this.marquee.current = this.canvas.worldPointAt(event.clientX, event.clientY);
      this.updateMarqueeSelection();
      this.renderMarquee();
      this.syncSelection();
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const metrics = this.canvas.metrics();
    const scale = this.canvas.scale || 1;
    const dx = Math.round((event.clientX - drag.startX) / (metrics.columnStep * scale));
    const dy = Math.round((event.clientY - drag.startY) / (metrics.rowStep * scale));
    if (!dx && !dy) return;
    drag.moved = true;
    if (drag.mode === 'resize') {
      const origin = drag.origins.get(drag.id);
      const next = clampResize(origin, drag.widget.nodeType, dx, dy);
      Object.assign(this.getLayout().items[drag.id], next);
    } else {
      for (const [id, origin] of drag.origins) {
        Object.assign(this.getLayout().items[id], clampMove(origin, dx, dy));
      }
    }
    this.syncGeometry();
  }

  pointerUp(event) {
    if (this.marquee?.pointerId === event.pointerId) {
      this.marquee = null;
      this.renderMarquee();
      this.release(event.pointerId);
      return;
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const changed = this.drag.moved;
    this.drag = null;
    this.release(event.pointerId);
    if (changed) this.onChange?.();
  }

  updateMarqueeSelection() {
    const box = rectFromPoints(this.marquee.start, this.marquee.current);
    const hits = new Set(this.marquee.base);
    const metrics = this.canvas.metrics();
    for (const card of this.grid.querySelectorAll('[data-dashboard-frame]')) {
      const item = itemFor(this.getLayout(), card.dataset.widgetId);
      if (item && intersects(box, itemWorldBounds(item, metrics))) hits.add(card.dataset.widgetId);
    }
    this.selected = hits;
  }

  syncGeometry() {
    const metrics = this.canvas.metrics();
    for (const card of this.grid.querySelectorAll('[data-dashboard-frame]')) {
      applyWidgetGeometry(card, itemFor(this.getLayout(), card.dataset.widgetId), metrics);
    }
    this.syncSelection();
  }

  syncSelection() {
    const existing = new Set([...this.grid.querySelectorAll('[data-dashboard-frame]')].map((card) => card.dataset.widgetId));
    this.selected = new Set([...this.selected].filter((id) => existing.has(id)));
    for (const card of this.grid.querySelectorAll('[data-dashboard-frame]')) {
      card.classList.toggle('dashboard-frame-selected', this.selected.has(card.dataset.widgetId));
    }
  }

  renderMarquee() {
    this.layer.replaceChildren();
    if (!this.marquee) return;
    const box = rectFromPoints(this.marquee.start, this.marquee.current);
    const element = document.createElement('div');
    element.className = 'dashboard-selection-marquee';
    Object.assign(element.style, {
      left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`,
    });
    this.layer.append(element);
  }

  release(pointerId) {
    if (this.viewport.hasPointerCapture(pointerId)) this.viewport.releasePointerCapture(pointerId);
  }
}

function rectFromPoints(first, second) {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return { x, y, width: Math.abs(second.x - first.x), height: Math.abs(second.y - first.y) };
}

function intersects(first, second) {
  return first.x <= second.x + second.width && first.x + first.width >= second.x
    && first.y <= second.y + second.height && first.y + first.height >= second.y;
}
