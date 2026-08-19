import {
  availableChannels,
  channelLabel,
  channelPairLabel,
  differentialNegative,
  differentialPositiveChannels,
} from './channels.js';
import { NODE_CATALOG } from './catalog.js';

/** Add view-only inline controls, literals and inferred pin units. */
export function decorateNode(node, graph, capabilities) {
  const next = structuredClone(node);
  next.icon = NODE_CATALOG.find((item) => item.type === node.nodeType)?.icon ?? null;
  const connected = connectedInputs(node, graph);
  const config = node.config ?? {};
  const range = rangeControl(config, capabilities);

  if (node.nodeType === 'labjack-channel') {
    const mux = Boolean(graph?.metadata?.mux80Enabled);
    next.badge = config.channel ?? '—';
    setPinLabel(next, 'channel', 'Reference');
    next.controls = [selectControl(
      'channel', 'Channel', config.channel,
      availableChannels(capabilities, mux).map((channel) => [channel, channelLabel(channel)]),
    )];
  } else if (node.nodeType === 'labjack-channel-pair') {
    const mux = Boolean(graph?.metadata?.mux80Enabled);
    const negative = differentialNegative(config.channel ?? 'AIN0');
    next.badge = `${config.channel ?? '—'} / ${negative}`;
    setPinLabel(next, 'pair', 'Reference');
    next.controls = [selectControl(
      'channel', 'Pair', config.channel,
      differentialPositiveChannels(capabilities, mux).map((channel) => [channel, channelPairLabel(channel)]),
    )];
  } else if (node.nodeType === 'labjack-ain') {
    next.controls = [range];
  } else if (node.nodeType === 'labjack-current') {
    next.controls = [range];
    setLiteral(next, connected, 'shunt', numberControl('shuntOhms', config.shuntOhms, 'Ω', { min: 0.001 }));
  } else if (node.nodeType === 'labjack-thermocouple') {
    next.controls = [
      selectControl('thermocoupleType', 'Type', config.thermocoupleType ?? '', [
        ['', '—'], ...(capabilities?.thermocouple?.types ?? []).map((value) => [value, value]),
      ]),
      range,
    ];
  } else if (node.nodeType === 'pressure-calibration') {
    decoratePressure(next, graph, connected);
  } else if (node.nodeType === 'load-cell') {
    decorateLoadCell(next, connected);
  } else if (node.nodeType === 'constant') {
    next.badge = `${format(config.value)} ${config.unit ?? ''}`.trim();
    setPinLabel(next, 'value', 'Out');
    next.controls = [
      numberControl('value', config.value, config.unit ?? '', { label: 'Value' }),
      selectControl('unit', 'Unit', config.unit ?? 'kg', engineeringUnits().map((unit) => [unit, unit])),
    ];
  } else if (node.nodeType === 'subtract') {
    decorateInferredMath(next, graph, ['a', 'b'], 'result');
  } else if (node.nodeType === 'rate-of-change') {
    const unit = incomingUnit(node, graph, 'input');
    const outputUnit = concrete(unit) ? `${unit}/s` : 'infer';
    next.badge = outputUnit;
    setPinType(next, 'input', unit ?? 'infer');
    setPinType(next, 'rate', outputUnit);
    next.controls = [numberControl('windowS', config.windowS ?? 0.5, 's', { min: 0.01, step: 0.05, label: 'Window' })];
  } else if (node.nodeType === 'dashboard-signal') {
    const unit = incomingUnit(node, graph, 'value');
    if (concrete(unit)) setPinType(next, 'value', unit);
    next.controls = [
      textControl('label', 'Label', config.label ?? ''),
      selectControl('group', 'Group', config.group ?? 'Engine', ['Fuel', 'LOX', 'Engine'].map((value) => [value, value])),
      selectControl('display', 'Display', config.display ?? 'both', [['number', 'Number'], ['plot', 'Plot'], ['both', 'Both']]),
      numberControl('precision', config.precision ?? 1, '', { min: 0, max: 6, step: 1, label: 'Decimals' }),
    ];
  }
  return next;
}

function decoratePressure(node, graph, connected) {
  const config = node.config ?? {};
  const unit = incomingUnit(node, graph, 'input');
  const electricalUnit = concrete(unit) ? unit : 'V / A';
  setPinType(node, 'input', electricalUnit);
  for (const pin of ['inputMin', 'inputMax']) {
    setPinType(node, pin, electricalUnit);
    setLiteral(node, connected, pin, numberControl(pin, config[pin], electricalUnit));
  }
  setLiteral(node, connected, 'psiMin', numberControl('psiMin', config.psiMin, 'psi'));
  setLiteral(node, connected, 'psiMax', numberControl('psiMax', config.psiMax, 'psi'));
}

function decorateLoadCell(node, connected) {
  const config = node.config ?? {};
  const unit = config.unit ?? 'kg';
  setPinType(node, 'capacity', unit);
  setPinType(node, 'load', unit);
  setLiteral(node, connected, 'excitation', numberControl('excitationV', config.excitationV, 'V', { min: 0 }));
  setLiteral(node, connected, 'ratedOutputMvV', numberControl('ratedOutputMvV', config.ratedOutputMvV, 'mV/V', { min: 0 }));
  setLiteral(node, connected, 'zeroV', numberControl('zeroV', config.zeroV, 'V'));
  setLiteral(node, connected, 'capacity', numberControl('capacity', config.capacity, unit, { min: 0 }));
  node.controls = [selectControl('unit', 'Output unit', unit, ['kg', 'N', 'lb'].map((value) => [value, value]))];
}

function decorateInferredMath(node, graph, inputPins, outputPin) {
  const unit = inputPins.map((pin) => incomingUnit(node, graph, pin)).find(concrete) ?? 'infer';
  for (const pin of inputPins) setPinType(node, pin, unit);
  setPinType(node, outputPin, unit);
  node.badge = unit;
}

function rangeControl(config, capabilities) {
  const ranges = capabilities?.analog?.ranges_v ?? [10, 1, 0.1, 0.01];
  return selectControl(
    'rangeV', 'Range', config.rangeV ?? 0.1,
    ranges.map((value) => [String(value), `±${value} V`]), 'number',
  );
}

function connectedInputs(node, graph) {
  return new Set((graph?.links ?? []).filter((link) => link.toNode === node.id).map((link) => link.toPin));
}

function setLiteral(node, connected, pinId, control) {
  const pin = node.pins?.find((candidate) => candidate.id === pinId);
  if (pin) pin.literal = { ...control, connected: connected.has(pinId), label: undefined };
}

function setPinType(node, pinId, unit) {
  const pin = node.pins?.find((candidate) => candidate.id === pinId);
  if (pin) pin.type = unit;
}

function setPinLabel(node, pinId, label) {
  const pin = node.pins?.find((candidate) => candidate.id === pinId);
  if (pin) pin.label = label;
}

export function incomingUnit(node, graph, pinId) {
  const link = (graph?.links ?? []).find((candidate) => candidate.toNode === node.id && candidate.toPin === pinId);
  return link ? resolvedOutputUnit(graph, link.fromNode, link.fromPin) : null;
}

export function resolvedOutputUnit(graph, nodeId, pinId, seen = new Set()) {
  const key = `${nodeId}:${pinId}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const node = (graph?.nodes ?? []).find((candidate) => candidate.id === nodeId);
  const pin = node?.pins?.find((candidate) => candidate.id === pinId);
  if (!node || !pin) return null;
  if (concrete(pin.type)) return pin.type;
  if (node.nodeType === 'constant') return node.config?.unit ?? null;
  if (node.nodeType === 'load-cell') return node.config?.unit ?? null;
  if (node.nodeType === 'subtract') {
    return incomingResolvedUnit(node, graph, 'a', seen) ?? incomingResolvedUnit(node, graph, 'b', seen);
  }
  if (node.nodeType === 'rate-of-change') {
    const input = incomingResolvedUnit(node, graph, 'input', seen);
    return concrete(input) ? `${input}/s` : null;
  }
  return null;
}

function incomingResolvedUnit(node, graph, pinId, seen) {
  const link = (graph?.links ?? []).find((candidate) => candidate.toNode === node.id && candidate.toPin === pinId);
  return link ? resolvedOutputUnit(graph, link.fromNode, link.fromPin, seen) : null;
}

function numberControl(key, value, unit = '', options = {}) {
  return { key, label: options.label ?? key, type: 'number', value, unit, valueType: 'number', step: options.step ?? 'any', min: options.min, max: options.max };
}
function textControl(key, label, value) { return { key, label, type: 'text', value }; }
function selectControl(key, label, value, options, valueType = 'string') { return { key, label, type: 'select', value, options, valueType }; }
function engineeringUnits() { return ['psi', 'kg', 'kg/s', 'N', 'lb', 'K', 'V', 'A', 'Ω', 'mV/V']; }
function concrete(unit) { return Boolean(unit && unit !== '*' && unit !== 'infer' && unit !== 'V / A'); }
function format(value) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 5 }) : '—'; }
