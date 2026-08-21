import {
  deleteView,
  gridPointFromWorld,
  setView,
  viewFor,
  viewFromGridPoints,
  viewWorldBounds,
} from './dashboard-layout-model.js';

const SLOTS = ['1', '2', '3'];

/** Select/move/resize saved Dashboard camera regions on the dedicated Views page. */
export class DashboardViewRegionEditor {
  constructor({ viewport, layer, canvas, buttons, getLayout, getTool, onChange }) {
    this.viewport = viewport;
    this.layer = layer;
    this.canvas = canvas;
    this.buttons = buttons;
    this.getLayout = getLayout;
    this.getTool = getTool;
    this.onChange = onChange;
    this.currentSlot = SLOTS.find((slot) => viewFor(this.getLayout(), slot)) ?? '1';
    this.selected = viewFor(this.getLayout(), this.currentSlot)
      ? new Set([this.currentSlot])
      : new Set();
    this.drag = null;
    this.marquee = null;
    this.bind();
  }

  bind() {
    for (const button of this.buttons) {
      button.addEventListener('click', () => this.selectSlot(button.dataset.dashboardViewSlotButton));
    }
    this.viewport.addEventListener('pointerdown', (event) => this.pointerDown(event), true);
    window.addEventListener('pointermove', (event) => this.pointerMove(event));
    window.addEventListener('pointerup', (event) => this.pointerUp(event));
    window.addEventListener('pointercancel', (event) => this.pointerUp(event));
    window.addEventListener('keydown', (event) => this.keyDown(event));
  }

  selectSlot(slot) {
    if (!SLOTS.includes(String(slot))) return;
    this.currentSlot = String(slot);
    this.selected = viewFor(this.getLayout(), this.currentSlot)
      ? new Set([this.currentSlot])
      : new Set();
    this.render();
  }

  pointerDown(event) {
    if (
      event.button !== 0
      || this.getTool() !== 'select'
      || event.target.closest('.dashboard-authoring-controls, engineering-canvas-zoom')
    ) return;
    const region = event.target.closest('[data-dashboard-view-slot]');
    if (region) this.beginRegionInteraction(region, event);
    else if (!viewFor(this.getLayout(), this.currentSlot)) this.beginDraw(event);
    else this.beginMarquee(event);
  }

  beginRegionInteraction(region, event) {
    const slot = region.dataset.dashboardViewSlot;
    const resize = event.target.closest('[data-dashboard-view-resize]');
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    this.currentSlot = slot;
    if (resize) this.selected = new Set([slot]);
    else if (additive) this.selected.has(slot) ? this.selected.delete(slot) : this.selected.add(slot);
    else if (!this.selected.has(slot)) this.selected = new Set([slot]);
    this.render();
    if (!this.selected.has(slot)) return;

    const layout = this.getLayout();
    const origins = new Map();
    for (const selectedSlot of this.selected) {
      const view = viewFor(layout, selectedSlot);
      if (view) origins.set(selectedSlot, { ...view });
    }
    this.drag = {
      pointerId: event.pointerId,
      mode: resize ? 'resize' : 'move',
      slot,
      start: this.gridPoint(event),
      origins,
      changed: false,
    };
    this.capture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  beginDraw(event) {
    const point = this.gridPoint(event);
    this.selected = new Set([this.currentSlot]);
    this.drag = {
      pointerId: event.pointerId,
      mode: 'draw',
      slot: this.currentSlot,
      start: point,
      origins: new Map(),
      changed: false,
    };
    setView(this.getLayout(), this.currentSlot, { x: point.x, y: point.y, w: 0.25, h: 0.25 });
    this.capture(event.pointerId);
    this.render();
    event.preventDefault();
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
    this.capture(event.pointerId);
    this.render();
    event.preventDefault();
  }

  pointerMove(event) {
    if (this.marquee?.pointerId === event.pointerId) {
      this.marquee.current = this.canvas.worldPointAt(event.clientX, event.clientY);
      this.updateMarqueeSelection();
      this.render();
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = this.gridPoint(event);
    if (drag.mode === 'draw') {
      setView(this.getLayout(), drag.slot, viewFromGridPoints(drag.start, point));
      drag.changed = true;
    } else if (drag.mode === 'move') {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      if (!dx && !dy) return;
      drag.changed = true;
      for (const [slot, origin] of drag.origins) {
        setView(this.getLayout(), slot, { ...origin, x: origin.x + dx, y: origin.y + dy });
      }
    } else if (drag.mode === 'resize') {
      const origin = drag.origins.get(drag.slot);
      if (!origin) return;
      setView(this.getLayout(), drag.slot, viewFromGridPoints(
        { x: origin.x, y: origin.y },
        point,
      ));
      drag.changed = true;
    }
    this.render();
  }

  pointerUp(event) {
    if (this.marquee?.pointerId === event.pointerId) {
      this.marquee = null;
      this.release(event.pointerId);
      this.render();
      return;
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const changed = this.drag.changed || this.drag.mode === 'draw';
    this.drag = null;
    this.release(event.pointerId);
    this.render();
    if (changed) this.onChange?.();
  }

  updateMarqueeSelection() {
    const box = rectFromPoints(this.marquee.start, this.marquee.current);
    const selected = new Set(this.marquee.base);
    const layout = this.getLayout();
    for (const slot of SLOTS) {
      const view = viewFor(layout, slot);
      if (view && intersects(box, viewWorldBounds(view, this.canvas.metrics()))) selected.add(slot);
    }
    this.selected = selected;
  }

  keyDown(event) {
    const target = event.target;
    if (target.matches?.('input, textarea, select') || target.isContentEditable) return;
    if (/^Digit[123]$/.test(event.code)) {
      this.selectSlot(event.code.slice(-1));
      event.preventDefault();
      return;
    }
    if (!['Delete', 'Backspace'].includes(event.key) || !this.selected.size) return;
    let changed = false;
    for (const slot of this.selected) changed = deleteView(this.getLayout(), slot) || changed;
    this.selected.clear();
    if (changed) {
      this.render();
      this.onChange?.();
    }
    event.preventDefault();
  }

  gridPoint(event) {
    return gridPointFromWorld(
      this.canvas.worldPointAt(event.clientX, event.clientY),
      this.canvas.metrics(),
    );
  }

  capture(pointerId) { this.viewport.setPointerCapture(pointerId); }

  release(pointerId) {
    if (this.viewport.hasPointerCapture(pointerId)) this.viewport.releasePointerCapture(pointerId);
  }

  render() {
    this.layer.replaceChildren();
    const layout = this.getLayout();
    this.selected = new Set([...this.selected].filter((slot) => Boolean(viewFor(layout, slot))));
    for (const slot of SLOTS) {
      const view = viewFor(layout, slot);
      if (!view) continue;
      const bounds = viewWorldBounds(view, this.canvas.metrics());
      const region = document.createElement('div');
      region.className = 'dashboard-view-region';
      region.dataset.dashboardViewSlot = slot;
      region.classList.toggle('selected', this.selected.has(slot));
      region.classList.toggle('current', slot === this.currentSlot);
      Object.assign(region.style, {
        left: `${bounds.x}px`, top: `${bounds.y}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`,
      });
      const label = document.createElement('span');
      label.textContent = slot;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.dataset.dashboardViewResize = '';
      handle.hidden = !this.selected.has(slot) || slot !== this.currentSlot;
      handle.setAttribute('aria-label', `Resize Dashboard view ${slot}`);
      region.append(label, handle);
      this.layer.append(region);
    }
    this.renderMarquee();
    for (const button of this.buttons) {
      const slot = button.dataset.dashboardViewSlotButton;
      button.classList.toggle('saved', Boolean(viewFor(layout, slot)));
      button.classList.toggle('current', slot === this.currentSlot);
      button.classList.toggle('selected', this.selected.has(slot));
      button.setAttribute('aria-pressed', String(slot === this.currentSlot));
    }
  }

  renderMarquee() {
    if (!this.marquee) return;
    const box = rectFromPoints(this.marquee.start, this.marquee.current);
    const element = document.createElement('div');
    element.className = 'dashboard-selection-marquee';
    Object.assign(element.style, {
      left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`,
    });
    this.layer.append(element);
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
