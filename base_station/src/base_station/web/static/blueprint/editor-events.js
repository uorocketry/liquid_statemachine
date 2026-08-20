import { MAX_SCALE, MIN_SCALE } from './editor-constants.js';
import { clamp } from './editor-utils.js';

export const eventMethods = {
  _bindEvents() {
    this.addEventListener('pointerdown', (event) => this._onPointerDown(event));
    this.addEventListener('contextmenu', (event) => this._onContextMenu(event));
    this.addEventListener('dblclick', (event) => this._onDoubleClick(event));
    this.addEventListener('click', (event) => this._onClick(event));
    this.addEventListener('change', (event) => this._onInlineChange(event));
    this._viewport.addEventListener('wheel', (event) => this._onWheel(event), { passive: false });
    this._viewport.addEventListener('keydown', (event) => this._onKeyDown(event));
    window.addEventListener('pointermove', this._boundPointerMove);
    window.addEventListener('pointerup', this._boundPointerUp);
    window.addEventListener('pointercancel', this._boundPointerCancel);
  },

  _onInlineChange(event) {
    const input = event.target.closest('[data-blueprint-config-key]');
    const nodeElement = input?.closest('liquid-blueprint-node');
    if (!input || !nodeElement) return;
    const node = this._nodeById(nodeElement.dataset.nodeId);
    if (!node) return;
    const value = input.dataset.valueType === 'number'
      ? (input.value === '' ? null : Number(input.value))
      : input.dataset.valueType === 'boolean' ? input.value === 'true' : input.value;
    const patch = this.inlineEditPolicy(node, input.dataset.blueprintConfigKey, value, this.graph);
    if (patch) this.updateNode(node.id, patch);
    event.stopPropagation();
  },

  _onClick(event) {
    const actionButton = event.target.closest('[data-blueprint-action]');
    if (actionButton) {
      const action = actionButton.dataset.blueprintAction;
      if (action === 'undo') this.undo();
      else if (action === 'redo') this.redo();
      else if (action === 'fit') this.fitGraph();
      else if (action === 'zoom-in') this._zoomAroundCenter(0.1);
      else if (action === 'zoom-out') this._zoomAroundCenter(-0.1);
      return;
    }
    const menuButton = event.target.closest('[data-menu-action]');
    if (!menuButton) return;
    const action = menuButton.dataset.menuAction;
    if (action === 'create') {
      this.dispatchEvent(new CustomEvent('blueprint-create-request', {
        bubbles: true, detail: { point: { ...this._canvasMenuPoint } },
      }));
    } else if (action === 'paste') this.pasteSelection();
    else if (action === 'fit') this.fitGraph();
    else if (action === 'cut') this.cutSelection();
    else if (action === 'copy') this.copySelection();
    else if (action === 'duplicate') this.duplicateSelection();
    else if (action === 'break') this.breakSelectionLinks();
    else if (action === 'delete') this.deleteSelection();
    this._closeMenus();
  },

  _onContextMenu(event) {
    event.preventDefault();
    const nodeElement = event.target.closest('liquid-blueprint-node');
    const wireElement = event.target.closest('.blueprint-wire-hit');
    if (nodeElement) {
      const node = this._nodeById(nodeElement.dataset.nodeId);
      if (!node) return;
      if (!this._selectedNodes.has(node.id)) {
        this._selectedNodes = new Set([node.id]);
        this._selectedLinks.clear();
        this._emitSelection();
        this._renderGraph();
      }
      this._openNodeMenu(event.clientX, event.clientY);
      return;
    }
    if (wireElement) {
      const linkId = wireElement.dataset.linkId;
      if (!this._selectedLinks.has(linkId)) {
        this._selectedNodes.clear();
        this._selectedLinks = new Set([linkId]);
        this._emitSelection();
        this._renderGraph();
      }
      this._openNodeMenu(event.clientX, event.clientY);
      return;
    }
  },

  _onDoubleClick(event) {
    const nodeElement = event.target.closest('liquid-blueprint-node');
    if (!nodeElement || event.target.closest('.blueprint-pin')) return;
    const node = this._nodeById(nodeElement.dataset.nodeId);
    if (!node) return;
    this.dispatchEvent(new CustomEvent('blueprint-node-activate', {
      bubbles: true, detail: { node: structuredClone(node) },
    }));
  },

  _onWheel(event) {
    event.preventDefault();
    this._closeMenus();
    const before = this._worldPoint(event.clientX, event.clientY);
    const rect = this._viewport.getBoundingClientRect();
    const scale = clamp(this._camera.scale * Math.exp(-event.deltaY * 0.0012), MIN_SCALE, MAX_SCALE);
    this._camera = {
      scale,
      x: event.clientX - rect.left - before.x * scale,
      y: event.clientY - rect.top - before.y * scale,
    };
    this._applyCamera();
  },

  _onKeyDown(event) {
    const target = event.target;
    if (target.matches?.('input, textarea, select') || target.isContentEditable) return;
    if (event.key === 'Escape') {
      this._linkDrag = null;
      this._compatiblePin = null;
      this._incompatiblePin = null;
      this._closeMenus();
      this._renderGraph();
      event.preventDefault();
      return;
    }
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (command && key === 'z' && event.shiftKey) this.redo();
    else if (command && key === 'z') this.undo();
    else if (command && key === 'y') this.redo();
    else if (command && key === 'c') this.copySelection();
    else if (command && key === 'x') this.cutSelection();
    else if (command && key === 'v') this.pasteSelection();
    else if (command && key === 'd') this.duplicateSelection();
    else if (event.key === 'Delete' || event.key === 'Backspace') this.deleteSelection();
    else handled = false;
    if (handled) event.preventDefault();
  },
};
