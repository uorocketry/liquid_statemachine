import { html, nothing, repeat } from '/static/vendor/lit/lit.js';

/** Render node-level configuration controls. */
export function controlsTemplate(controls) {
  if (!Array.isArray(controls) || !controls.length) return nothing;
  return html`
    <div class="blueprint-node-controls">
      ${repeat(controls, (control) => control.key, (control) => html`
        <label class="blueprint-node-control">
          <span>${control.label ?? control.key}</span>
          ${inlineControlTemplate(control)}
        </label>
      `)}
    </div>
  `;
}

/**
 * Render a literal-or-link editor. Lit preserves the actual input element while
 * unrelated graph/preview state changes around it.
 */
export function inlineControlTemplate(control) {
  if (!control || control.connected) return nothing;
  const valueType = control.valueType ?? (control.type === 'number' ? 'number' : 'string');
  const suffix = control.unit ? html`<em>${control.unit}</em>` : nothing;
  if (control.type === 'select') {
    return html`
      <span class="blueprint-inline-editor">
        <select
          data-blueprint-config-key=${control.key}
          data-value-type=${valueType}
        >
          ${repeat(control.options ?? [], ([value]) => String(value), ([value, label]) => html`
            <option
              value=${String(value)}
              .selected=${String(value) === String(control.value ?? '')}
            >${label}</option>
          `)}
        </select>
        ${suffix}
      </span>
    `;
  }
  return html`
    <span class="blueprint-inline-editor">
      <input
        type=${control.type === 'number' ? 'number' : 'text'}
        data-blueprint-config-key=${control.key}
        data-value-type=${valueType}
        .value=${String(control.value ?? '')}
        min=${control.min ?? nothing}
        max=${control.max ?? nothing}
        step=${control.type === 'number' ? (control.step ?? 'any') : nothing}
      />
      ${suffix}
    </span>
  `;
}
