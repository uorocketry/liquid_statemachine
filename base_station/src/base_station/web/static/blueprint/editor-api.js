import { cloneGraph, normalizeGraph } from './model.js';
import { cloneSelection, directedNodePath, pasteSelection } from './graph.js';
import { MIN_SCALE, NODE_FALLBACK_HEIGHT, NODE_FALLBACK_WIDTH } from './editor-constants.js';
import { clamp } from './editor-utils.js';

/** @typedef {import('./model.js').BlueprintGraph} BlueprintGraph */
/** @typedef {import('./model.js').BlueprintNode} BlueprintNode */
/** @typedef {import('./model.js').BlueprintNodePreview} BlueprintNodePreview */

export const editorApi = {
  /** @param {BlueprintGraph} value */
  set graph(value) {
    this._graph = normalizeGraph(value);
    this._history.clear();
    this._selectedNodes.clear();
    this._selectedLinks.clear();
    this._renderGraph();
    this._emitSelection();
    this._fitGraphAfterRender();
  },

  /** @returns {BlueprintGraph} */
  get graph() { return cloneGraph(this._graph); },

  get selection() {
    return { nodeIds: [...this._selectedNodes], linkIds: [...this._selectedLinks] };
  },

  get camera() { return { ...this._camera }; },
  get previewPath() { return [...this._previewPath]; },

  /** @param {string[]} nodeIds */
  setPreviewPath(nodeIds) {
    const existing = new Set(this._graph.nodes.map((node) => node.id));
    this._previewPath = [...new Set(nodeIds)].filter((id) => existing.has(id));
    this._renderGraph();
  },

  /** @param {string} fromNodeId @param {string} toNodeId @returns {string[]} */
  previewPathBetween(fromNodeId, toNodeId) {
    const path = directedNodePath(this._graph, fromNodeId, toNodeId);
    this.setPreviewPath(path);
    return path;
  },

  clearPreviewPath() {
    this._previewPath = [];
    this._renderGraph();
  },

  /** @param {string} nodeId @param {BlueprintNodePreview|null} preview */
  updateNodePreview(nodeId, preview) {
    if (!this._graph.nodes.some((node) => node.id === nodeId)) return;
    if (preview === null) this._nodePreviews.delete(nodeId);
    else this._nodePreviews.set(nodeId, structuredClone(preview));
    this._schedulePreviewRender();
  },

  /** @param {Map<string, BlueprintNodePreview>|Object<string, BlueprintNodePreview>} previews */
  updateNodePreviews(previews) {
    const entries = previews instanceof Map ? previews.entries() : Object.entries(previews ?? {});
    const nodeIds = new Set(this._graph.nodes.map((node) => node.id));
    for (const [nodeId, preview] of entries) {
      if (nodeIds.has(nodeId)) this._nodePreviews.set(nodeId, structuredClone(preview));
    }
    this._schedulePreviewRender();
  },

  /** @param {string} [nodeId] */
  clearNodePreview(nodeId) {
    if (nodeId) this._nodePreviews.delete(nodeId);
    else this._nodePreviews.clear();
    this._schedulePreviewRender();
  },

  /** @param {BlueprintNode} node @param {{select?:boolean}} [options] */
  addNode(node, options = {}) {
    if (!node?.id) throw new TypeError('Blueprint nodes require an id');
    if (this._graph.nodes.some((candidate) => candidate.id === node.id)) {
      throw new Error(`Blueprint node already exists: ${node.id}`);
    }
    const next = cloneGraph(this._graph);
    next.nodes.push({ ...structuredClone(node), pins: structuredClone(node.pins ?? []) });
    this._commit(next, 'add-node', true);
    if (options.select !== false) this.selectNode(node.id);
  },

  /** @param {string} nodeId @param {Partial<BlueprintNode>} patch */
  updateNode(nodeId, patch) {
    const index = this._graph.nodes.findIndex((node) => node.id === nodeId);
    if (index < 0) return;
    const next = cloneGraph(this._graph);
    next.nodes[index] = { ...next.nodes[index], ...structuredClone(patch), id: nodeId };
    this._commit(next, 'update-node', true);
  },

  /** @param {Record<string, *>} patch */
  updateMetadata(patch) {
    const next = cloneGraph(this._graph);
    next.metadata = { ...(next.metadata ?? {}), ...structuredClone(patch) };
    this._commit(next, 'update-metadata', true);
  },

  /** @param {string} nodeId */
  selectNode(nodeId) {
    if (!this._graph.nodes.some((node) => node.id === nodeId)) return;
    this._selectedNodes = new Set([nodeId]);
    this._selectedLinks.clear();
    this._renderGraph();
    this._emitSelection();
  },

  clearSelection() {
    if (!this._selectedNodes.size && !this._selectedLinks.size) return;
    this._selectedNodes.clear();
    this._selectedLinks.clear();
    this._renderGraph();
    this._emitSelection();
  },

  /** Re-render view-only node decoration without changing graph/history. */
  refreshPresentation() {
    this._renderGraph();
  },

  /** @param {string} nodeId */
  frameNode(nodeId) {
    const node = this._graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !this._rendered) return;
    const viewport = this._viewport.getBoundingClientRect();
    if (!viewport.width || !viewport.height) return;
    const element = this._nodeElement(nodeId);
    const width = element?.offsetWidth ?? node.width ?? NODE_FALLBACK_WIDTH;
    const height = element?.offsetHeight ?? NODE_FALLBACK_HEIGHT;
    const scale = Math.min(1, Math.max(MIN_SCALE, this._camera.scale));
    this._camera = {
      scale,
      x: viewport.width / 2 - (node.x + width / 2) * scale,
      y: viewport.height / 2 - (node.y + height / 2) * scale,
    };
    this._applyCamera();
  },

  copySelection() {
    this._clipboard = cloneSelection(this._graph.nodes, this._graph.links, this._selectedNodes);
    this._updateMenus();
  },

  cutSelection() {
    this.copySelection();
    this.deleteSelection();
  },

  pasteSelection() {
    if (!this._clipboard?.nodes?.length) return;
    this._pasteSerial += 1;
    const before = cloneGraph(this._graph);
    const result = pasteSelection(this._clipboard, this._graph, this._pasteSerial);
    this._history.record(before);
    this._graph = result.graph;
    this._selectedNodes = result.selected;
    this._selectedLinks.clear();
    this._renderGraph();
    this._emitChange('paste', true);
    this._emitSelection();
  },

  duplicateSelection() {
    const copied = cloneSelection(this._graph.nodes, this._graph.links, this._selectedNodes);
    if (!copied.nodes.length) return;
    this._clipboard = copied;
    this.pasteSelection();
  },

  deleteSelection() {
    const removable = new Set(this._graph.nodes
      .filter((node) => this._selectedNodes.has(node.id) && !node.locked)
      .map((node) => node.id));
    const deletingLink = this._graph.links.some((link) => this._selectedLinks.has(link.id));
    if (!removable.size && !deletingLink) return;
    const next = cloneGraph(this._graph);
    next.nodes = next.nodes.filter((node) => !removable.has(node.id));
    next.links = next.links.filter((link) => !this._selectedLinks.has(link.id)
      && !removable.has(link.fromNode) && !removable.has(link.toNode));
    this._selectedNodes = new Set([...this._selectedNodes].filter((id) => !removable.has(id)));
    this._selectedLinks.clear();
    this._commit(next, 'delete', true);
    this._emitSelection();
  },

  breakSelectionLinks() {
    const next = cloneGraph(this._graph);
    const links = next.links.filter((link) => (
      !this._selectedLinks.has(link.id)
      && !this._selectedNodes.has(link.fromNode)
      && !this._selectedNodes.has(link.toNode)
    ));
    if (links.length === next.links.length) return;
    next.links = links;
    this._selectedLinks.clear();
    this._commit(next, 'break-links', true);
  },

  undo() {
    const previous = this._history.undo(this._graph);
    if (!previous) return;
    this._graph = previous;
    this._pruneSelection();
    this._renderGraph();
    this._emitChange('undo', true);
    this._emitSelection();
  },

  redo() {
    const next = this._history.redo(this._graph);
    if (!next) return;
    this._graph = next;
    this._pruneSelection();
    this._renderGraph();
    this._emitChange('redo', true);
    this._emitSelection();
  },

  fitGraph() {
    if (!this._rendered || !this._graph.nodes.length) return;
    const rect = this._viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const boxes = this._graph.nodes.map((node) => {
      const element = this._nodeElement(node.id);
      return {
        x: node.x, y: node.y,
        width: element?.offsetWidth || node.width || NODE_FALLBACK_WIDTH,
        height: element?.offsetHeight || NODE_FALLBACK_HEIGHT,
      };
    });
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    const padding = 64;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = clamp(Math.min(1, (rect.width - padding * 2) / width, (rect.height - padding * 2) / height), MIN_SCALE, 1);
    this._camera = {
      scale,
      x: (rect.width - width * scale) / 2 - minX * scale,
      y: (rect.height - height * scale) / 2 - minY * scale,
    };
    this._applyCamera();
  },
};
