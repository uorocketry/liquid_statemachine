/** Domain-specific consequences of editing controls directly inside nodes. */

import { patchSpecPins } from './node-specs.js';

export function patchInlineNode(node, key, value) {
  const config = { ...(node.config ?? {}), [key]: value };
  const patch = { config };
  const specPins = patchSpecPins(node, key, value);
  if (specPins) patch.pins = specPins;
  if (key !== 'unit' || specPins) return patch;

  if (node.nodeType === 'load-cell') {
    patch.pins = node.pins.map((pin) => {
      if (pin.id === 'load') return { ...pin, type: String(value) };
      if (pin.id === 'capacity') return { ...pin, type: String(value), expectedType: String(value) };
      return pin;
    });
  }
  return patch;
}
