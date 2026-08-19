import { pinsCompatible } from '../blueprint/graph.js';
import { incomingUnit, resolvedOutputUnit } from './presentation.js';

const REFERENCE_TYPES = new Set(['channel-ref', 'channel-pair-ref']);

/** Domain-aware compatibility layered over the generic typed-pin policy. */
export function daqConnectionAllowed(source, target, sourceNode, targetNode, graph) {
  if (!pinsCompatible(source, target)) return false;
  const sourceUnit = resolvedOutputUnit(graph, sourceNode.id, source.id) ?? source.type;
  const expected = Array.isArray(target.expectedType)
    ? target.expectedType
    : [target.expectedType ?? target.type ?? '*'];

  // Physical hardware references are configuration objects, not telemetry
  // values. Wildcard data inputs must not accidentally accept them.
  if (REFERENCE_TYPES.has(sourceUnit) && !expected.includes(sourceUnit)) return false;

  if (targetNode.nodeType === 'pressure-calibration') {
    if (target.id === 'inputMin' || target.id === 'inputMax') {
      const sensorUnit = incomingUnit(targetNode, graph, 'input');
      if (concrete(sensorUnit) && concrete(sourceUnit) && sensorUnit !== sourceUnit) return false;
    }
    if (target.id === 'input') {
      for (const pin of ['inputMin', 'inputMax']) {
        const calibrationUnit = incomingUnit(targetNode, graph, pin);
        if (concrete(calibrationUnit) && concrete(sourceUnit) && calibrationUnit !== sourceUnit) return false;
      }
    }
  }

  if (targetNode.nodeType === 'subtract' && (target.id === 'a' || target.id === 'b')) {
    const other = incomingUnit(targetNode, graph, target.id === 'a' ? 'b' : 'a');
    if (concrete(other) && concrete(sourceUnit) && other !== sourceUnit) return false;
  }
  return true;
}

function concrete(unit) {
  return Boolean(unit && unit !== '*' && unit !== 'infer' && unit !== 'V / A');
}
