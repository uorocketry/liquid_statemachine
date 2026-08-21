import {
  applyWidgetGeometry,
  bringToFront,
  clampMove,
  clampResize,
  cloneLayout,
  itemFor,
  setCameraPreset,
  setVisible,
} from './dashboard-layout-model.js';

export class DashboardLayoutEditor {
  constructor(options) {
    Object.assign(this, options);
    this.widgets = [];
    this.committed = { items: {}, cameraPresets: {} };
    this.viewLayout = { items: {}, cameraPresets: {} };
    this.draft = null;
    this.editing = false;
    this.drag = null;
    this.saving = false;

    this.editButton.addEventListener('click', () => this.start());
    this.cancelButton.addEventListener('click', () => this.cancel());
    this.saveButton.addEventListener('click', () => this.save());
    this.picker.addEventListener('change', (event) => this.onPickerChange(event));
    this.grid.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    window.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.editing && !this.drag) this.cancel();
    });
  }

  configure(widgets, layout) {
    this.widgets = widgets;
    this.committed = cloneLayout(layout);
    if (!this.editing) this.viewLayout = cloneLayout(this.committed);
    if (!this.editing) {
      this.renderPicker();
      this.syncChrome();
    }
    this.workspace?.syncLayout(this.currentLayout());
  }

  currentLayout() {
    return this.draft ?? this.viewLayout;
  }

  start() {
    if (this.editing || !this.widgets.length) return;
    this.editing = true;
    this.draft = cloneLayout(this.viewLayout);
    this.syncChrome();
    this.renderPicker();
    this.onLayoutChange(this.draft);
    this.workspace?.syncLayout(this.draft);
  }

  cancel() {
    if (!this.editing || this.saving) return;
    this.drag = null;
    this.editing = false;
    this.draft = null;
    this.syncChrome();
    this.renderPicker();
    this.onLayoutChange(this.viewLayout);
    this.workspace?.syncLayout(this.viewLayout);
  }

  async save() {
    if (!this.editing || this.saving || !this.draft) return;
    this.saving = true;
    this.saveButton.disabled = true;
    try {
      const saved = await this.onSave(cloneLayout(this.draft));
      this.committed = cloneLayout(saved ?? this.draft);
      this.viewLayout = cloneLayout(this.committed);
      this.editing = false;
      this.draft = null;
      this.syncChrome();
      this.renderPicker();
      this.onLayoutChange(this.committed);
      this.workspace?.syncLayout(this.committed);
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.saving = false;
      this.saveButton.disabled = false;
    }
  }

  decorateCard(card, widget) {
    const item = itemFor(this.currentLayout(), widget.id);
    applyWidgetGeometry(card, item, this.workspace?.metrics());
    card.dataset.dashboardFrame = '';
    card.querySelector('header')?.setAttribute('data-dashboard-drag-handle', '');
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'dashboard-resize-handle';
    handle.dataset.dashboardResizeHandle = '';
    handle.setAttribute('aria-label', `Resize ${widget.config?.label ?? 'dashboard widget'}`);
    card.append(handle);
  }

  onPickerChange(event) {
    const input = event.target.closest('input[data-dashboard-widget-id]');
    if (!input) return;
    const widgetId = input.dataset.dashboardWidgetId;
    const visible = input.checked;
    if (!this.editing) this.start();
    if (!this.draft) return;
    setVisible(this.draft, widgetId, visible);
    this.renderPicker();
    this.onLayoutChange(this.draft);
    this.workspace?.syncLayout(this.draft);
    if (visible) this.workspace?.revealItem(itemFor(this.draft, widgetId));
  }

  saveCameraPreset(slot, preset) {
    if (this.saving) return null;
    if (!this.editing) this.start();
    if (!this.draft || !setCameraPreset(this.draft, slot, preset)) return null;
    this.workspace?.syncLayout(this.draft);
    return this.draft;
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    const card = event.target.closest('[data-dashboard-frame]');
    if (!card) return;

    const widgetId = card.dataset.widgetId;
    if (!this.editing) {
      if (bringToFront(this.viewLayout, widgetId)) this.syncFrameStack(this.viewLayout);
      return;
    }
    if (!this.draft) return;

    // Raising is independent from dragging/resizing. Clicking any visible part
    // of an overlapping frame should make it immediately usable.
    bringToFront(this.draft, widgetId);
    this.syncFrameStack(this.draft);

    const resize = event.target.closest('[data-dashboard-resize-handle]');
    const move = event.target.closest('[data-dashboard-drag-handle]');
    if (!resize && !move) return;

    const widget = this.widgets.find((candidate) => candidate.id === widgetId);
    const item = itemFor(this.draft, widgetId);
    if (!widget || !item) return;
    const metrics = this.gridMetrics();
    this.drag = {
      pointerId: event.pointerId,
      mode: resize ? 'resize' : 'move',
      widget,
      card,
      startX: event.clientX,
      startY: event.clientY,
      startItem: { ...item },
      metrics,
    };
    card.classList.add('dashboard-frame-active');
    event.preventDefault();
  }

  onPointerMove(event) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId || !this.draft) return;
    const scale = this.workspace?.scale ?? 1;
    const dx = Math.round((event.clientX - drag.startX) / (drag.metrics.columnStep * scale));
    const dy = Math.round((event.clientY - drag.startY) / (drag.metrics.rowStep * scale));
    const candidate = drag.mode === 'resize'
      ? clampResize(drag.startItem, drag.widget.nodeType, dx, dy)
      : clampMove(drag.startItem, dx, dy);
    Object.assign(this.draft.items[drag.widget.id], candidate);
    applyWidgetGeometry(drag.card, candidate, drag.metrics);
    this.onGeometryChange?.();
  }

  onPointerUp(event) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.card.classList.remove('dashboard-frame-active');
    this.drag = null;
    this.onGeometryChange?.();
  }

  syncFrameStack(layout = this.currentLayout()) {
    const metrics = this.workspace?.metrics();
    for (const card of this.grid.querySelectorAll('[data-dashboard-frame]')) {
      applyWidgetGeometry(card, itemFor(layout, card.dataset.widgetId), metrics);
    }
  }

  gridMetrics() {
    return this.workspace?.metrics() ?? { columnStep: 1, rowStep: 1 };
  }

  renderPicker() {
    this.picker.replaceChildren();
    const layout = this.currentLayout();
    for (const widget of this.widgets) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.dashboardWidgetId = widget.id;
      input.checked = itemFor(layout, widget.id)?.visible !== false;
      const text = document.createElement('span');
      text.textContent = widget.config?.label ?? widget.id;
      label.append(input, text);
      this.picker.append(label);
    }
  }

  syncChrome() {
    this.grid.classList.toggle('dashboard-layout-editing', this.editing);
    this.workspace?.setEditing(this.editing);
    this.timeControl.classList.toggle('dashboard-layout-editing', this.editing);
    this.editButton.hidden = this.editing;
    this.cancelButton.hidden = !this.editing;
    this.saveButton.hidden = !this.editing;
    this.pickerDetails.hidden = !this.widgets.length;
    if (!this.editing) this.pickerDetails.removeAttribute('open');
  }
}
