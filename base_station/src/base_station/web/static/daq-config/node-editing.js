/** Domain-specific consequences of editing controls directly inside nodes. */

export function patchInlineNode(node, key, value) {
  const config = { ...(node.config ?? {}), [key]: value };
  const patch = { config };
  if (key !== 'unit') return patch;

  if (node.nodeType === 'constant' || node.nodeType === 'sine-wave') {
    patch.pins = node.pins.map((pin) => pin.direction === 'output' ? { ...pin, type: String(value) } : pin);
  } else if (node.nodeType === 'load-cell') {
    patch.pins = node.pins.map((pin) => {
      if (pin.id === 'load') return { ...pin, type: String(value) };
      if (pin.id === 'capacity') return { ...pin, type: String(value), expectedType: String(value) };
      return pin;
    });
  }
  return patch;
}
