import { cloneGraph } from './model.js';
import { cloneSelection, pasteSelection } from './graph.js';

/** Clipboard, destructive edit, and history commands for the Blueprint editor. */
export const commandMethods = {
  get canUndo() { return this._history.canUndo; },
  get canRedo() { return this._history.canRedo; },

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
};
