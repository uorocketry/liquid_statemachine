import { cloneGraph, normalizeGraph } from './model.js';
import { directedNodePath } from './graph.js';
import { NODE_FALLBACK_HEIGHT, NODE_FALLBACK_WIDTH } from './editor-constants.js';
import {
  ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE,
  ENGINEERING_CANVAS_MAX_SCALE,
  cameraForBounds,
  cameraForWorldCenter,
} from '../viewport-camera.js';

/** @typedef {import('./model.js').BlueprintGraph} BlueprintGraph */
/** @typedef {import('./model.js').BlueprintNode} BlueprintNode */
/** @typedef {import('./model.js').BlueprintNodePreview} BlueprintNodePreview */

export const editorApi = {
  /** @param {BlueprintGraph} value */
  set graph(value) {
    this._graph = normalizeGraph(value);
    this._inlineDraft = null;
    this._history.clear();
    this._selectedNodes.clear();
    this._selectedLinks.clear();
    this._renderGraph();
    this._emitSelection();
    this._emitInlineDraftChange();
    this._fitGraphAfterRender();
  },

  /** @returns {BlueprintGraph} */
  get graph() { return cloneGraph(this._graph); },

  get hasPendingInlineEdit() { return Boolean(this._inlineDraft); },

  /** Adopt a server-canonical graph without clearing camera, selection, or undo history. */
  adoptGraph(value) {
    this._graph = normalizeGraph(value);
    this._inlineDraft = null;
    this._pruneSelection();
    this._renderGraph();
    this._emitSelection();
    this._emitInlineDraftChange();
  },

  get selection() {
    return { nodeIds: [...this._selectedNodes], linkIds: [...this._selectedLinks] };
  },

  get camera() { return { ...this._camera }; },
  get interactionTool() { return this._interactionTool; },
  set interactionTool(value) {
    const next = value === 'hand' ? 'hand' : 'select';
    if (next === this._interactionTool) return;
    this._interactionTool = next;
    this.dataset.canvasTool = next;
  },
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
    const scale = Math.min(1, Math.max(ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE, this._camera.scale));
    this._camera = cameraForWorldCenter(
      { x: node.x + width / 2, y: node.y + height / 2 },
      viewport,
      scale,
    );
    this._applyCamera();
  },

  fitGraph(animate = true) {
    if (!this._rendered || !this._graph.nodes.length) return;
    const rect = this._viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const bounds = this._contentBounds();
    if (!bounds) return;
    const camera = cameraForBounds(
      bounds,
      rect,
      { padding: 64, minScale: ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE, maxScale: 1 },
    );
    if (animate) this._animateCameraTo(camera);
    else {
      this._stopCameraAnimation();
      this._camera = camera;
      this._applyCamera();
    }
  },

  frameSelection() {
    if (!this._rendered) return;
    const bounds = this._selectionBounds();
    const rect = this._viewport.getBoundingClientRect();
    if (!bounds || !rect.width || !rect.height) return;
    this._animateCameraTo(cameraForBounds(
      bounds,
      rect,
      {
        padding: 64,
        minScale: ENGINEERING_CANVAS_ABSOLUTE_MIN_SCALE,
        maxScale: ENGINEERING_CANVAS_MAX_SCALE,
      },
    ));
  },
};
