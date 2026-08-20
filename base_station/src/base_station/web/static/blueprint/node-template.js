import { html, nothing, repeat } from '/static/vendor/lit/lit.js';
import { controlsTemplate, inlineControlTemplate } from './node-controls-template.js';
import { previewTemplate } from './node-preview-template.js';

/** @typedef {import('./model.js').BlueprintNode} BlueprintNode */
/** @typedef {import('./model.js').BlueprintPin} BlueprintPin */

/** Render a complete blueprint node body. */
export function renderNodeTemplate({ node, connectionState, preview }) {
  return html`
    <div class="blueprint-node-header">
      ${node.icon ? html`<span class=${`blueprint-node-icon ui-icon ${node.icon}`} aria-hidden="true"></span>` : nothing}
      <strong>${node.title}</strong>
      ${node.badge ? html`<span class="blueprint-node-badge">${node.badge}</span>` : nothing}
      ${node.locked ? html`<span class="blueprint-node-lock" title="Structural node">◆</span>` : nothing}
    </div>
    ${node.description ? html`<div class="blueprint-node-description">${node.description}</div>` : nothing}
    ${previewTemplate(preview)}
    ${controlsTemplate(node.controls, node.id)}
    ${pinsTemplate(node, connectionState)}
    ${diagnosticsTemplate(node.diagnostics)}
  `;
}

function diagnosticsTemplate(diagnostics) {
  if (!diagnostics?.length) return nothing;
  return html`
    <div class="blueprint-node-diagnostics" aria-label="Node diagnostics">
      ${diagnostics.map((diagnostic) => html`
        <div class="blueprint-node-diagnostic ${diagnostic.severity ?? 'warning'}">
          <span aria-hidden="true"></span>
          <strong>${diagnostic.message}</strong>
        </div>
      `)}
    </div>
  `;
}

function pinsTemplate(node, state) {
  const pins = node.pins ?? [];
  let previousSection = null;
  return repeat(pins, (pin) => pin.id, (pin) => {
    const section = pin.section && pin.section !== previousSection
      ? html`${previousSection === null ? nothing : html`<div class="blueprint-node-divider"></div>`}
          <div class="blueprint-node-section">${pin.section}</div>`
      : nothing;
    previousSection = pin.section ?? previousSection;
    return html`${section}${pinRowTemplate(node, pin, state)}`;
  });
}

function pinRowTemplate(node, pin, state) {
  const key = `${node.id}:${pin.id}`;
  const candidate = state?.compatiblePins?.has(key) ?? false;
  const blocked = state?.blockedPins?.has(key) ?? false;
  return html`
    <div
      class="blueprint-pin-row ${pin.direction === 'output' ? 'output-only' : ''} ${candidate ? 'connection-candidate' : ''} ${blocked ? 'connection-blocked' : ''}"
      data-pin-row=${pin.id}
    >
      ${pin.direction === 'input' ? pinButton(pin, key, state) : nothing}
      <span class="blueprint-pin-label-main">${pin.label}</span>
      <span class="blueprint-pin-side">
        ${pin.direction === 'input' ? inlineControlTemplate(pin.literal, `${node.id}-${pin.id}`) : nothing}
        ${pinTypeTemplate(pin)}
      </span>
      ${pin.direction === 'output' ? pinButton(pin, key, state) : nothing}
    </div>
  `;
}

function pinTypeTemplate(pin) {
  const literal = pin.direction === 'input' ? pin.literal : null;
  const literalShowsSameUnit = Boolean(
    literal && !literal.connected && literal.unit && literal.unit === pin.type,
  );
  return literalShowsSameUnit
    ? nothing
    : html`<span class="blueprint-pin-type">${pin.type ?? '*'}</span>`;
}

/** @param {BlueprintPin} pin */
function pinButton(pin, key, state) {
  const classes = [
    'blueprint-pin',
    pin.direction,
    `kind-${pin.kind ?? 'data'}`,
    state?.compatiblePin === key ? 'compatible' : '',
    state?.incompatiblePin === key ? 'incompatible' : '',
    state?.compatiblePins?.has(key) ? 'connection-candidate' : '',
    state?.blockedPins?.has(key) ? 'connection-blocked' : '',
  ].filter(Boolean).join(' ');
  return html`
    <button
      type="button"
      class=${classes}
      data-pin=${pin.id}
      data-direction=${pin.direction}
      aria-label=${`${pin.label} ${pin.direction}, ${pin.type ?? '*'}`}
    ></button>
  `;
}
