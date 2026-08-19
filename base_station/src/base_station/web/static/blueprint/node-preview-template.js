import { html, nothing } from '/static/vendor/lit/lit.js';

/** @typedef {import('./model.js').BlueprintNodePreview} BlueprintNodePreview */

/** @param {BlueprintNodePreview|null} preview */
export function previewTemplate(preview) {
  if (!preview) return nothing;
  const samples = Array.isArray(preview.samples)
    ? preview.samples.filter(Number.isFinite).slice(-48)
    : [];
  return html`
    <div class="blueprint-node-preview">
      <div class="blueprint-node-preview-heading">
        <span>${preview.label ?? 'Preview'}</span>
        ${preview.value === undefined ? nothing : html`
          <strong>${preview.value}${preview.unit ? html` <span>${preview.unit}</span>` : nothing}</strong>
        `}
      </div>
      ${samples.length > 1 ? sparklineTemplate(samples) : nothing}
      ${preview.detail ? html`<small>${preview.detail}</small>` : nothing}
    </div>
  `;
}

function sparklineTemplate(samples) {
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = Math.max(1e-12, max - min);
  const points = samples.map((value, index) => {
    const x = (index / Math.max(1, samples.length - 1)) * 100;
    const y = 30 - ((value - min) / span) * 26 - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return html`
    <svg class="blueprint-node-sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points=${points}></polyline>
    </svg>
  `;
}
