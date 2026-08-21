import { cloneGraph } from './model.js';
import { additiveSelection, nextLinkId } from './graph.js';
import { panCamera } from '../viewport-camera.js';

export const pointerMethods = {
  _onPointerDown(event) {
    if (event.target.closest('.blueprint-inline-editor')) return;
    if (event.target.closest('.blueprint-menu')) return;
    this._viewport.focus({ preventScroll: true });
    this._closeMenus();
    const pin = event.target.closest('.blueprint-pin');
    const nodeElement = event.target.closest('liquid-blueprint-node');
    const wire = event.target.closest('.blueprint-wire-hit');
    if (pin && nodeElement && event.button === 0) {
      const node = this._nodeById(nodeElement.dataset.nodeId);
      const pinModel = node?.pins.find((candidate) => candidate.id === pin.dataset.pin);
      if (!node || !pinModel) return;
      this._linkDrag = {
        nodeId: node.id, pinId: pinModel.id, pin: pinModel,
        current: this._pinPoint(node.id, pinModel.id) ?? this._worldPoint(event.clientX, event.clientY),
      };
      event.preventDefault();
      event.stopPropagation();
      this._renderGraph();
      return;
    }
    if (wire && event.button === 0) {
      const id = wire.dataset.linkId;
      const next = new Set(this._selectedLinks);
      if (additiveSelection(event)) next.has(id) ? next.delete(id) : next.add(id);
      else { next.clear(); next.add(id); this._selectedNodes.clear(); }
      this._selectedLinks = next;
      this._renderGraph();
      this._emitSelection();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (nodeElement && event.button === 0) {
      this._beginNodeDrag(nodeElement, event);
      return;
    }
    if (event.target !== this._viewport && !event.target.closest('.blueprint-grid')) return;
    if (event.button === 1 || event.button === 2) {
      this._pan = {
        x: event.clientX, y: event.clientY,
        originX: this._camera.x, originY: this._camera.y,
        moved: false, openMenuOnClick: event.button === 2,
      };
      if (event.button === 1) event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    const multi = additiveSelection(event);
    const point = this._worldPoint(event.clientX, event.clientY);
    this._marquee = { start: point, current: point, additive: multi, base: new Set(this._selectedNodes) };
    if (!multi) {
      this._selectedNodes.clear();
      this._selectedLinks.clear();
      this._emitSelection();
    }
    this._renderMarquee();
  },

  _beginNodeDrag(nodeElement, event) {
    const node = this._nodeById(nodeElement.dataset.nodeId);
    if (!node) return;
    const multi = additiveSelection(event);
    let next = new Set(this._selectedNodes);
    if (multi) next.has(node.id) ? next.delete(node.id) : next.add(node.id);
    else if (!next.has(node.id)) next = new Set([node.id]);
    this._selectedNodes = next;
    if (!multi) this._selectedLinks.clear();
    this._emitSelection();
    if (event.target.closest('.blueprint-node-header') && next.has(node.id)) {
      const origins = new Map();
      for (const selected of this._graph.nodes.filter((candidate) => next.has(candidate.id))) {
        origins.set(selected.id, { x: selected.x, y: selected.y });
      }
      this._drag = {
        start: this._worldPoint(event.clientX, event.clientY), origins,
        recorded: false, beforeGraph: cloneGraph(this._graph),
      };
      event.preventDefault();
      event.stopPropagation();
    }
    this._renderGraph();
  },

  _onPointerMove(event) {
    if (this._pan) {
      const dx = event.clientX - this._pan.x;
      const dy = event.clientY - this._pan.y;
      if (Math.hypot(dx, dy) > 3) this._pan.moved = true;
      if (this._pan.moved) {
        this._camera = panCamera(
          { ...this._camera, x: this._pan.originX, y: this._pan.originY },
          dx,
          dy,
        );
        this._applyCamera();
      }
    }
    if (this._marquee) {
      this._marquee.current = this._worldPoint(event.clientX, event.clientY);
      this._updateMarqueeSelection();
      this._renderMarquee();
      this._renderNodes();
    }
    if (this._drag) this._moveSelectedNodes(event);
    if (this._linkDrag) this._moveLinkPreview(event);
  },

  _moveSelectedNodes(event) {
    const point = this._worldPoint(event.clientX, event.clientY);
    const dx = point.x - this._drag.start.x;
    const dy = point.y - this._drag.start.y;
    if (!this._drag.recorded && Math.hypot(dx, dy) > 1) this._drag.recorded = true;
    if (!this._drag.recorded) return;
    this._graph.nodes = this._graph.nodes.map((node) => {
      const origin = this._drag.origins.get(node.id);
      return origin ? { ...node, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) } : node;
    });
    this._renderNodes();
    this._scheduleWireRender();
  },

  _moveLinkPreview(event) {
    this._linkDrag.current = this._worldPoint(event.clientX, event.clientY);
    const target = this._oppositePinAt(event.clientX, event.clientY, this._linkDrag.pin);
    const originNode = this._nodeById(this._linkDrag.nodeId);
    const connection = target && originNode && target.node.id !== originNode.id
      ? this._resolveConnection(this._linkDrag.pin, target.pin, originNode, target.node)
      : null;
    this._compatiblePin = target && connection ? `${target.node.id}:${target.pin.id}` : null;
    this._incompatiblePin = target && !connection ? `${target.node.id}:${target.pin.id}` : null;
    this._renderNodes();
    this._scheduleWireRender();
  },

  _onPointerUp(event) {
    if (this._pan) {
      const shouldOpen = !this._pan.moved && this._pan.openMenuOnClick;
      this._pan = null;
      if (shouldOpen) this._openCanvasMenu(event.clientX, event.clientY);
    }
    if (this._marquee) {
      this._marquee = null;
      this._renderMarquee();
      this._emitSelection();
    }
    if (this._drag) {
      const moved = this._drag.recorded;
      const beforeGraph = this._drag.beforeGraph;
      this._drag = null;
      if (moved) {
        this._history.record(beforeGraph);
        this._emitChange('move', false);
      }
    }
    if (this._linkDrag) this._finishLinkDrag(event);
  },

  _finishLinkDrag(event) {
    const drag = this._linkDrag;
    const target = this._oppositePinAt(event.clientX, event.clientY, drag.pin);
    const originNode = this._nodeById(drag.nodeId);
    const connection = target && originNode && target.node.id !== originNode.id
      ? this._resolveConnection(drag.pin, target.pin, originNode, target.node)
      : null;
    if (target && originNode && connection) {
      const sourceIsOrigin = connection.source === drag.pin;
      const fromNode = sourceIsOrigin ? originNode : target.node;
      const toNode = sourceIsOrigin ? target.node : originNode;
      const targetPin = connection.target;
      const next = cloneGraph(this._graph);
      if (!targetPin.allowMultiple) {
        next.links = next.links.filter((link) => !(link.toNode === toNode.id && link.toPin === targetPin.id));
      }
      next.links = next.links.filter((link) => !(
        link.fromNode === fromNode.id && link.fromPin === connection.source.id
        && link.toNode === toNode.id && link.toPin === targetPin.id
      ));
      next.links.push({
        id: nextLinkId(next.links), fromNode: fromNode.id, fromPin: connection.source.id,
        toNode: toNode.id, toPin: targetPin.id, kind: connection.source.kind ?? 'data',
      });
      this._commit(next, 'connect', true);
    }
    this._linkDrag = null;
    this._compatiblePin = null;
    this._incompatiblePin = null;
    this._renderGraph();
  },

  _onPointerCancel() {
    if (this._drag) this._graph = this._drag.beforeGraph;
    this._pan = null;
    this._marquee = null;
    this._drag = null;
    this._linkDrag = null;
    this._compatiblePin = null;
    this._incompatiblePin = null;
    this._closeMenus();
    this._renderGraph();
  },
};
