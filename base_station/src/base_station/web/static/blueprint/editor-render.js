import { intersects, rectFromPoints, wirePath } from './graph.js';
import { MAX_SCALE, MIN_SCALE } from './editor-constants.js';
import { clamp, cssEscape } from './editor-utils.js';
import { html, render, repeat } from '/static/vendor/lit/lit.js';
import { renderWireLayer } from './wire-template.js';

export const renderMethods = {
  _renderShell() {
    this.innerHTML = `
      <div class="blueprint-toolbar">
        <div class="blueprint-toolbar-actions">
          <button type="button" data-blueprint-action="undo" title="Undo">Undo</button>
          <button type="button" data-blueprint-action="redo" title="Redo">Redo</button>
          <button type="button" data-blueprint-action="fit">Frame graph</button>
        </div>
      </div>
      <section class="blueprint-viewport" tabindex="0" aria-label="Blueprint graph editor">
        <div class="blueprint-grid"></div>
        <div class="blueprint-world">
          <svg class="blueprint-wire-layer" aria-label="Blueprint connections"></svg>
          <div class="blueprint-node-layer"></div>
          <div class="blueprint-selection-marquee" hidden></div>
        </div>
        <div class="blueprint-zoom"><button type="button" data-blueprint-action="zoom-out">−</button><span data-blueprint-zoom>100%</span><button type="button" data-blueprint-action="zoom-in">+</button></div>
        <div class="blueprint-menu blueprint-canvas-menu" hidden>
          <button type="button" data-menu-action="create"><span class="ui-icon icon-add" aria-hidden="true"></span><strong>Add node…</strong></button>
          <button type="button" data-menu-action="paste"><span>⌘V</span><strong>Paste</strong></button>
          <button type="button" data-menu-action="fit"><span class="ui-icon icon-frame" aria-hidden="true"></span><strong>Frame graph</strong></button>
        </div>
        <div class="blueprint-menu blueprint-node-menu" hidden>
          <button type="button" data-menu-action="cut"><span class="ui-icon icon-cut" aria-hidden="true"></span><strong>Cut</strong></button>
          <button type="button" data-menu-action="copy"><span class="ui-icon icon-copy" aria-hidden="true"></span><strong>Copy</strong></button>
          <button type="button" data-menu-action="duplicate"><span class="ui-icon icon-duplicate" aria-hidden="true"></span><strong>Duplicate</strong></button>
          <button type="button" data-menu-action="break"><span class="ui-icon icon-link" aria-hidden="true"></span><strong>Break links</strong></button>
          <button type="button" data-menu-action="delete" class="danger"><span class="ui-icon icon-delete" aria-hidden="true"></span><strong>Delete</strong></button>
        </div>
      </section>`;
    this._viewport = this.querySelector('.blueprint-viewport');
    this._world = this.querySelector('.blueprint-world');
    this._wireLayer = this.querySelector('.blueprint-wire-layer');
    this._nodeLayer = this.querySelector('.blueprint-node-layer');
    this._marqueeElement = this.querySelector('.blueprint-selection-marquee');
    this._canvasMenu = this.querySelector('.blueprint-canvas-menu');
    this._nodeMenu = this.querySelector('.blueprint-node-menu');
    this._zoomElement = this.querySelector('[data-blueprint-zoom]');
    this._applyCamera();
  },

  _renderGraph() {
    if (!this._rendered) return;
    this._renderNodes();
    this._renderMarquee();
    this._applyCamera();
    this._updateMenus();
    this._scheduleWireRender();
  },

  _renderNodes() {
    if (!this._nodeLayer) return;
    const candidatePins = this._candidatePinKeys();
    const blockedPins = this._blockedPinKeys();
    const displayGraph = this.graph;
    const views = this._graph.nodes.map((node) => ({
      model: node,
      display: this.nodeDecorator
        ? this.nodeDecorator(structuredClone(node), displayGraph)
        : node,
    }));
    render(html`${repeat(views, ({ model }) => model.id, ({ model, display }) => html`
      <liquid-blueprint-node
        .node=${display}
        .selected=${this._selectedNodes.has(model.id)}
        .connectionState=${{
          focus: this._connectionFocus(model),
          compatiblePins: candidatePins,
          blockedPins,
          compatiblePin: this._compatiblePin,
          incompatiblePin: this._incompatiblePin,
        }}
        .previewState=${{
          active: this._previewPath.includes(model.id),
          preview: this._nodePreviews.get(model.id) ?? null,
        }}
      ></liquid-blueprint-node>
    `)}`, this._nodeLayer);
  },

  _scheduleWireRender() {
    if (!this._rendered || this._wireFrame) return;
    this._wireFrame = requestAnimationFrame(() => { this._wireFrame = 0; this._renderWires(); });
  },

  _schedulePreviewRender() {
    if (!this._rendered || this._previewFrame) return;
    this._previewFrame = requestAnimationFrame(() => {
      this._previewFrame = 0;
      this._renderNodes();
      this._scheduleWireRender();
    });
  },

  _renderWires() {
    if (!this._wireLayer) return;
    const previewEdges = new Set(this._previewPath.slice(0, -1).map((id, index) => `${id}->${this._previewPath[index + 1]}`));
    renderWireLayer(this._wireLayer, {
      links: this._graph.links,
      selectedLinks: this._selectedLinks,
      previewEdges,
      pointForPin: (nodeId, pinId) => this._pinPoint(nodeId, pinId),
      linkDrag: this._linkDrag,
      wirePath,
    });
  },

  _renderMarquee() {
    if (!this._marqueeElement) return;
    if (!this._marquee) { this._marqueeElement.hidden = true; return; }
    const rect = rectFromPoints(this._marquee.start, this._marquee.current);
    this._marqueeElement.hidden = false;
    Object.assign(this._marqueeElement.style, {
      left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
  },

  _applyCamera() {
    if (!this._world) return;
    this._world.style.transform = `translate(${this._camera.x}px, ${this._camera.y}px) scale(${this._camera.scale})`;
    this._viewport.style.setProperty('--blueprint-major-grid', `${64 * this._camera.scale}px`);
    this._viewport.style.setProperty('--blueprint-minor-grid', `${16 * this._camera.scale}px`);
    this._viewport.style.setProperty('--blueprint-grid-x', `${this._camera.x}px`);
    this._viewport.style.setProperty('--blueprint-grid-y', `${this._camera.y}px`);
    if (this._zoomElement) this._zoomElement.textContent = `${Math.round(this._camera.scale * 100)}%`;
    this._scheduleWireRender();
  },

  _updateMarqueeSelection() {
    const rect = rectFromPoints(this._marquee.start, this._marquee.current);
    const hits = this._graph.nodes.filter((node) => {
      const element = this._nodeElement(node.id);
      return element && intersects(rect, { x: node.x, y: node.y, width: element.offsetWidth, height: element.offsetHeight });
    }).map((node) => node.id);
    this._selectedNodes = new Set([...(this._marquee.additive ? this._marquee.base : []), ...hits]);
    if (!this._marquee.additive) this._selectedLinks.clear();
  },

  _pinPoint(nodeId, pinId) {
    const node = this._nodeElement(nodeId);
    const pin = node?.querySelector(`.blueprint-pin[data-pin="${cssEscape(pinId)}"]`);
    if (!pin || !this._world) return null;
    const pinRect = pin.getBoundingClientRect();
    const worldRect = this._world.getBoundingClientRect();
    return {
      x: (pinRect.left + pinRect.width / 2 - worldRect.left) / this._camera.scale,
      y: (pinRect.top + pinRect.height / 2 - worldRect.top) / this._camera.scale,
    };
  },

  _worldPoint(clientX, clientY) {
    const rect = this._viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this._camera.x) / this._camera.scale,
      y: (clientY - rect.top - this._camera.y) / this._camera.scale,
    };
  },

  _zoomAroundCenter(delta) {
    const rect = this._viewport.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const before = this._worldPoint(clientX, clientY);
    const scale = clamp(this._camera.scale + delta, MIN_SCALE, MAX_SCALE);
    this._camera = {
      scale,
      x: clientX - rect.left - before.x * scale,
      y: clientY - rect.top - before.y * scale,
    };
    this._applyCamera();
  },
};
