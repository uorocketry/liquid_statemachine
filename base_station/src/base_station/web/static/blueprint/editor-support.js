import { cloneGraph, normalizeGraph } from './model.js';
import { compatibleConnection } from './graph.js';
import { cssEscape } from './editor-utils.js';

export const supportMethods = {
  _candidatePinKeys() {
    if (!this._linkDrag) return new Set();
    const origin = this._nodeById(this._linkDrag.nodeId);
    if (!origin) return new Set();
    const keys = [];
    for (const node of this._graph.nodes) {
      if (node.id === origin.id) continue;
      for (const pin of node.pins) {
        if (this._resolveConnection(this._linkDrag.pin, pin, origin, node)) keys.push(`${node.id}:${pin.id}`);
      }
    }
    return new Set(keys);
  },

  _blockedPinKeys() {
    if (!this._linkDrag) return new Set();
    const origin = this._nodeById(this._linkDrag.nodeId);
    if (!origin) return new Set();
    const keys = [];
    for (const node of this._graph.nodes) {
      if (node.id === origin.id) continue;
      for (const pin of node.pins) {
        if (pin.direction === this._linkDrag.pin.direction) continue;
        if (!this._resolveConnection(this._linkDrag.pin, pin, origin, node)) keys.push(`${node.id}:${pin.id}`);
      }
    }
    return new Set(keys);
  },

  _connectionFocus(node) {
    if (!this._linkDrag) return null;
    if (node.id === this._linkDrag.nodeId) return 'origin';
    const candidates = this._candidatePinKeys();
    return node.pins.some((pin) => candidates.has(`${node.id}:${pin.id}`)) ? 'compatible' : 'muted';
  },

  _resolveConnection(first, second, firstNode, secondNode) {
    return compatibleConnection(first, second, (source, target) => {
      const sourceNode = source === first ? firstNode : secondNode;
      const targetNode = target === first ? firstNode : secondNode;
      return this.connectionPolicy(source, target, sourceNode, targetNode);
    });
  },

  _oppositePinAt(clientX, clientY, originPin) {
    const element = document.elementFromPoint(clientX, clientY)?.closest('.blueprint-pin');
    if (!element || !this.contains(element) || element.dataset.direction === originPin.direction) return null;
    const nodeElement = element.closest('liquid-blueprint-node');
    const node = this._nodeById(nodeElement?.dataset.nodeId);
    const pin = node?.pins.find((candidate) => candidate.id === element.dataset.pin);
    return node && pin ? { element, node, pin } : null;
  },

  _openCanvasMenu(clientX, clientY) {
    this._canvasMenuPoint = this._worldPoint(clientX, clientY);
    this._placeMenu(this._canvasMenu, clientX, clientY, 250, 150);
    this._canvasMenu.hidden = false;
    this._nodeMenu.hidden = true;
    this._updateMenus();
  },

  _openNodeMenu(clientX, clientY) {
    this._placeMenu(this._nodeMenu, clientX, clientY, 250, 230);
    this._nodeMenu.hidden = false;
    this._canvasMenu.hidden = true;
    this._updateMenus();
  },

  _placeMenu(menu, clientX, clientY, width, height) {
    const rect = this._viewport.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(clientX - rect.left, rect.width - width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(clientY - rect.top, rect.height - height - 6))}px`;
  },

  _closeMenus() {
    if (this._canvasMenu) this._canvasMenu.hidden = true;
    if (this._nodeMenu) this._nodeMenu.hidden = true;
  },

  _updateMenus() {
    if (!this._rendered) return;
    const undo = this.querySelector('[data-blueprint-action="undo"]');
    const redo = this.querySelector('[data-blueprint-action="redo"]');
    if (undo) undo.disabled = !this._history.canUndo;
    if (redo) redo.disabled = !this._history.canRedo;
    const paste = this._canvasMenu?.querySelector('[data-menu-action="paste"]');
    if (paste) paste.disabled = !this._clipboard?.nodes?.length;
    const editable = this._graph.nodes.some((node) => this._selectedNodes.has(node.id) && !node.locked);
    const selectedLink = this._selectedLinks.size > 0;
    const breakable = selectedLink || this._graph.links.some((link) => (
      this._selectedNodes.has(link.fromNode) || this._selectedNodes.has(link.toNode)
    ));
    for (const action of ['cut', 'duplicate']) {
      const button = this._nodeMenu?.querySelector(`[data-menu-action="${action}"]`);
      if (button) button.disabled = !editable;
    }
    const deleteButton = this._nodeMenu?.querySelector('[data-menu-action="delete"]');
    if (deleteButton) deleteButton.disabled = !editable && !selectedLink;
    const copy = this._nodeMenu?.querySelector('[data-menu-action="copy"]');
    if (copy) copy.disabled = !editable;
    const breakButton = this._nodeMenu?.querySelector('[data-menu-action="break"]');
    if (breakButton) breakButton.disabled = !breakable;
  },

  _commit(next, reason, structural) {
    this._history.record(this._graph);
    this._graph = normalizeGraph(next);
    this._pruneSelection();
    this._renderGraph();
    this._emitChange(reason, structural);
  },

  _emitChange(reason, structural) {
    this.dispatchEvent(new CustomEvent('blueprint-change', {
      bubbles: true,
      detail: { graph: cloneGraph(this._graph), reason, structural },
    }));
  },

  _emitSelection() {
    this.dispatchEvent(new CustomEvent('blueprint-selection-change', {
      bubbles: true, detail: this.selection,
    }));
  },

  _pruneSelection() {
    const nodes = new Set(this._graph.nodes.map((node) => node.id));
    const links = new Set(this._graph.links.map((link) => link.id));
    this._selectedNodes = new Set([...this._selectedNodes].filter((id) => nodes.has(id)));
    this._selectedLinks = new Set([...this._selectedLinks].filter((id) => links.has(id)));
    this._previewPath = this._previewPath.filter((id) => nodes.has(id));
    for (const id of this._nodePreviews.keys()) {
      if (!nodes.has(id)) this._nodePreviews.delete(id);
    }
  },

  _nodeById(nodeId) {
    return this._graph.nodes.find((node) => node.id === nodeId);
  },

  _fitGraphAfterRender() {
    if (!this.isConnected || !this._graph.nodes.length) return;
    requestAnimationFrame(async () => {
      const pending = this._graph.nodes
        .map((node) => this._nodeElement(node.id)?.updateComplete)
        .filter(Boolean);
      if (pending.length) await Promise.all(pending);
      this.fitGraph();
    });
  },

  _nodeElement(nodeId) {
    return this._nodeLayer?.querySelector(`liquid-blueprint-node[data-node-id="${cssEscape(nodeId)}"]`);
  },
};
