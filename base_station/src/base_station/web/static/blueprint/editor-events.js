import { MAX_SCALE, MIN_SCALE } from './editor-constants.js';
import { clampScale, zoomCameraAt } from '../viewport-camera.js';

export const eventMethods = {
  _bindEvents() {
    this.addEventListener('pointerdown', (event) => this._onPointerDown(event));
    this.addEventListener('contextmenu', (event) => this._onContextMenu(event));
    this.addEventListener('dblclick', (event) => this._onDoubleClick(event));
    this.addEventListener('click', (event) => this._onClick(event));
    this.addEventListener('input', (event) => this._onInlineInput(event));
    this.addEventListener('change', (event) => this._onInlineChange(event));
    this._viewport.addEventListener('wheel', (event) => this._onWheel(event), { passive: false });
    this._viewport.addEventListener('keydown', (event) => this._onKeyDown(event));
    window.addEventListener('pointermove', this._boundPointerMove);
    window.addEventListener('pointerup', this._boundPointerUp);
    window.addEventListener('pointercancel', this._boundPointerCancel);
  },

  _onInlineInput(event) {
    const input = event.target.closest('[data-blueprint-config-key]');
    if (!input || !input.matches('input[type="text"], input[type="number"]')) return;
    const nodeElement = input.closest('liquid-blueprint-node');
    const node = nodeElement ? this._nodeById(nodeElement.dataset.nodeId) : null;
    if (!node) return;
    const key = input.dataset.blueprintConfigKey;
    const value = this._inlineElementValue(input);
    this._inlineDraft = Object.is(node.config?.[key], value)
      ? null
      : { nodeId: node.id, key, value };
    this._emitInlineDraftChange();
    event.stopPropagation();
  },

  _onInlineChange(event) {
    const input = event.target.closest('[data-blueprint-config-key]');
    if (!input) return;
    const nodeElement = input.closest('liquid-blueprint-node');
    const node = nodeElement ? this._nodeById(nodeElement.dataset.nodeId) : null;
    if (!node) return;
    const key = input.dataset.blueprintConfigKey;
    const value = this._inlineElementValue(input);
    if (this._inlineDraft && (this._inlineDraft.nodeId !== node.id || this._inlineDraft.key !== key)) {
      this.flushInlineEdit();
    }
    this._commitInlineValue(node.id, key, value);
    event.stopPropagation();
  },

  /** Commit any typed control draft, even if its DOM element was re-rendered. */
  flushInlineEdit() {
    const draft = this._inlineDraft;
    if (!draft) return false;
    return this._commitInlineValue(draft.nodeId, draft.key, draft.value);
  },

  _commitInlineValue(nodeId, key, value) {
    const node = this._nodeById(nodeId);
    this._inlineDraft = null;
    if (!node || Object.is(node.config?.[key], value)) {
      this._emitInlineDraftChange();
      return false;
    }
    const patch = this.inlineEditPolicy(node, key, value, this.graph);
    if (!patch) {
      this._emitInlineDraftChange();
      return false;
    }
    this.updateNode(node.id, patch);
    this._emitInlineDraftChange();
    return true;
  },

  _emitInlineDraftChange() {
    this.dispatchEvent(new CustomEvent('blueprint-inline-draft-change', {
      bubbles: true,
      detail: { pending: Boolean(this._inlineDraft) },
    }));
  },

  _inlineElementValue(input) {
    if (input.dataset.valueType === 'number') return input.value === '' ? null : Number(input.value);
    if (input.dataset.valueType === 'boolean') return input.value === 'true';
    return input.value;
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
    const rect = this._viewport.getBoundingClientRect();
    const scale = clampScale(
      this._camera.scale * Math.exp(-event.deltaY * 0.0012),
      MIN_SCALE,
      MAX_SCALE,
    );
    this._camera = zoomCameraAt(this._camera, rect, event.clientX, event.clientY, scale);
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
