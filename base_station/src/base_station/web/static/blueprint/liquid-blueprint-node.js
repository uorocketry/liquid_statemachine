import { LitElement, nothing } from '/static/vendor/lit/lit.js';
import { renderNodeTemplate } from './node-template.js';

/** @typedef {import('./model.js').BlueprintNode} BlueprintNode */
/** @typedef {import('./model.js').BlueprintNodePreview} BlueprintNodePreview */

/**
 * One blueprint node rendered with Lit into light DOM.
 *
 * Light DOM keeps the existing global blueprint stylesheet and editor-level
 * event delegation while Lit preserves input/select identity across updates.
 */
export class LiquidBlueprintNode extends LitElement {
  static properties = {
    node: { attribute: false },
    selected: { attribute: false },
    connectionState: { attribute: false },
    previewState: { attribute: false },
  };

  constructor() {
    super();
    /** @type {BlueprintNode|null} */
    this.node = null;
    this.selected = false;
    this.connectionState = emptyConnectionState();
    this.previewState = { active: false, preview: null };
  }

  createRenderRoot() { return this; }

  /** @param {Object} state */
  setConnectionState(state) { this.connectionState = state; }

  /** @param {{active:boolean, preview:BlueprintNodePreview|null}} state */
  setPreviewState(state) { this.previewState = state; }

  willUpdate() {
    const node = this.node;
    if (!node) return;
    this.dataset.nodeId = node.id;
    this.dataset.tone = node.tone ?? 'default';
    this.style.left = `${node.x}px`;
    this.style.top = `${node.y}px`;
    this.style.width = `${node.width ?? 236}px`;
    this.classList.add('blueprint-node');
    this.classList.toggle('selected', Boolean(this.selected));
    this.classList.toggle('preview-path', Boolean(this.previewState?.active));
    for (const name of ['origin', 'compatible', 'muted']) {
      this.classList.toggle(
        `connection-${name}`,
        this.connectionState?.focus === name,
      );
    }
  }

  render() {
    if (!this.node) return nothing;
    return renderNodeTemplate({
      node: this.node,
      connectionState: this.connectionState,
      preview: this.previewState?.preview ?? null,
    });
  }
}

function emptyConnectionState() {
  return {
    focus: null,
    compatiblePins: new Set(),
    blockedPins: new Set(),
    compatiblePin: null,
    incompatiblePin: null,
  };
}

if (!customElements.get('liquid-blueprint-node')) {
  customElements.define('liquid-blueprint-node', LiquidBlueprintNode);
}
