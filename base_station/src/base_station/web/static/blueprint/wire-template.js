import { render, repeat, svg } from '/static/vendor/lit/lit.js';

/** Render the wire SVG independently from all node DOM. */
export function renderWireLayer(layer, state) {
  const visibleLinks = state.links.map((link) => {
    const start = state.pointForPin(link.fromNode, link.fromPin);
    const end = state.pointForPin(link.toNode, link.toPin);
    return start && end ? { link, path: state.wirePath(start, end) } : null;
  }).filter(Boolean);

  render(svg`
    ${repeat(visibleLinks, ({ link }) => link.id, ({ link, path }) => {
      const classes = [
        'blueprint-wire',
        `kind-${link.kind ?? 'data'}`,
        state.selectedLinks.has(link.id) ? 'selected' : '',
        state.previewEdges.has(`${link.fromNode}->${link.toNode}`) ? 'preview-path' : '',
      ].filter(Boolean).join(' ');
      return svg`
        <path d=${path} class="blueprint-wire-shadow"></path>
        <path d=${path} class=${classes}></path>
        <path
          d=${path}
          class="blueprint-wire-hit"
          data-link-id=${link.id}
          role="button"
          tabindex="-1"
        ></path>
      `;
    })}
    ${linkPreview(state)}
  `, layer);
}

function linkPreview(state) {
  const drag = state.linkDrag;
  if (!drag) return svg``;
  const anchor = state.pointForPin(drag.nodeId, drag.pinId) ?? drag.current;
  const start = drag.pin.direction === 'output' ? anchor : drag.current;
  const end = drag.pin.direction === 'output' ? drag.current : anchor;
  return svg`<path d=${state.wirePath(start, end)} class="blueprint-wire-preview"></path>`;
}
