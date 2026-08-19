import './liquid-blueprint-node.js';
import { createHistory } from './history.js';
import { pinsCompatible } from './graph.js';
import { editorApi } from './editor-api.js';
import { eventMethods } from './editor-events.js';
import { pointerMethods } from './editor-pointer.js';
import { renderMethods } from './editor-render.js';
import { supportMethods } from './editor-support.js';
import { installMethods } from './editor-utils.js';

/** @typedef {import('./model.js').BlueprintGraph} BlueprintGraph */
/** @typedef {import('./model.js').BlueprintNode} BlueprintNode */
/** @typedef {import('./model.js').BlueprintPin} BlueprintPin */
/** @typedef {import('./model.js').BlueprintNodePreview} BlueprintNodePreview */

/**
 * Dependency-free graph editor web component. Domain code owns sensor semantics;
 * this element owns graph interaction, layout, history, and ephemeral previews.
 */
export class LiquidBlueprintEditor extends HTMLElement {
  constructor() {
    super();
    /** @type {BlueprintGraph} */
    this._graph = { nodes: [], links: [] };
    this._selectedNodes = new Set();
    this._selectedLinks = new Set();
    this._history = createHistory(100);
    this._clipboard = null;
    this._pasteSerial = 0;
    this._camera = { x: 40, y: 40, scale: 1 };
    this._marquee = null;
    this._pan = null;
    this._drag = null;
    this._linkDrag = null;
    this._compatiblePin = null;
    this._incompatiblePin = null;
    /** @type {string[]} */
    this._previewPath = [];
    /** @type {Map<string, BlueprintNodePreview>} */
    this._nodePreviews = new Map();
    this._canvasMenuPoint = { x: 0, y: 0 };
    this._rendered = false;
    this._wireFrame = 0;
    this._previewFrame = 0;
    this._resizeObserver = null;
    /** @type {(source:BlueprintPin,target:BlueprintPin,sourceNode:BlueprintNode,targetNode:BlueprintNode)=>boolean} */
    this.connectionPolicy = (source, target) => pinsCompatible(source, target);
    /**
     * Optional view-only node decorator. Hosts can infer labels, badges, or pin
     * display types from graph context without persisting derived presentation.
     * @type {(node:BlueprintNode, graph:BlueprintGraph) => BlueprintNode}
     */
    this.nodeDecorator = (node) => node;
    /** Domain hook for turning one inline edit into a node patch. */
    this.inlineEditPolicy = (node, key, value) => ({
      config: { ...(node.config ?? {}), [key]: value },
    });
    this._boundPointerMove = (event) => this._onPointerMove(event);
    this._boundPointerUp = (event) => this._onPointerUp(event);
    this._boundPointerCancel = () => this._onPointerCancel();
  }

  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;
    this.classList.add('liquid-blueprint-editor');
    this._renderShell();
    this._bindEvents();
    this._renderGraph();
    this._resizeObserver = new ResizeObserver(() => this._scheduleWireRender());
    this._resizeObserver.observe(this._viewport);
    if (this._graph.nodes.length) requestAnimationFrame(() => this.fitGraph());
  }

  disconnectedCallback() {
    window.removeEventListener('pointermove', this._boundPointerMove);
    window.removeEventListener('pointerup', this._boundPointerUp);
    window.removeEventListener('pointercancel', this._boundPointerCancel);
    this._resizeObserver?.disconnect();
    if (this._wireFrame) cancelAnimationFrame(this._wireFrame);
    if (this._previewFrame) cancelAnimationFrame(this._previewFrame);
    this._wireFrame = 0;
    this._previewFrame = 0;
    this._rendered = false;
  }

}

for (const methods of [editorApi, eventMethods, pointerMethods, renderMethods, supportMethods]) {
  installMethods(LiquidBlueprintEditor.prototype, methods);
}

if (!customElements.get('liquid-blueprint-editor')) {
  customElements.define('liquid-blueprint-editor', LiquidBlueprintEditor);
}
