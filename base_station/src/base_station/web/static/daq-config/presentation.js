import {
  availableChannels,
  channelLabel,
  channelPairLabel,
  differentialNegative,
  differentialPositiveChannels,
} from './channels.js';
import { NODE_CATALOG } from './catalog.js';
import {
  decorateSpecNode,
  numberControl,
  selectControl,
  specOutputUnit,
} from './node-specs.js';

/** Add view-only inline controls, literals and inferred pin units. */
export function decorateNode(node, graph, capabilities, labjackSettings = {}) {
  const specNode = decorateSpecNode(node, graph, { incomingUnit });
  if (specNode) return specNode;
  const next = structuredClone(node);
  next.icon = NODE_CATALOG.find((item) => item.type === node.nodeType)?.icon ?? null;
  const connected = connectedInputs(node, graph);
  const config = node.config ?? {};
  const range = rangeControl(config, capabilities);

  if (node.nodeType === 'labjack-channel') {
    const mux = Boolean(labjackSettings?.mux80Enabled);
    next.badge = config.channel ?? '—';
    setPinLabel(next, 'channel', 'Reference');
    next.controls = [selectControl(
      'channel', 'Channel', config.channel,
      availableChannels(capabilities, mux).map((channel) => [channel, channelLabel(channel)]),
    )];
  } else if (node.nodeType === 'labjack-channel-pair') {
    const mux = Boolean(labjackSettings?.mux80Enabled);
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
    setLiteral(next, connected, 'shunt', numberControl('shuntOhms', 'Shunt', config.shuntOhms, 'Ω', { min: 0.001 }));
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
    setLiteral(node, connected, pin, numberControl(pin, pin, config[pin], electricalUnit));
  }
  setLiteral(node, connected, 'psiMin', numberControl('psiMin', 'Pressure min', config.psiMin, 'psi'));
  setLiteral(node, connected, 'psiMax', numberControl('psiMax', 'Pressure max', config.psiMax, 'psi'));
}

function decorateLoadCell(node, connected) {
  const config = node.config ?? {};
  const unit = config.unit ?? 'kg';
  setPinType(node, 'capacity', unit);
  setPinType(node, 'load', unit);
  setLiteral(node, connected, 'excitation', numberControl('excitationV', 'Excitation', config.excitationV, 'V', { min: 0 }));
  setLiteral(node, connected, 'ratedOutputMvV', numberControl('ratedOutputMvV', 'Rated output', config.ratedOutputMvV, 'mV/V', { min: 0 }));
  setLiteral(node, connected, 'zeroV', numberControl('zeroV', 'Zero offset', config.zeroV, 'V'));
  setLiteral(node, connected, 'capacity', numberControl('capacity', 'Capacity', config.capacity, unit, { min: 0 }));
  node.controls = [selectControl('unit', 'Output unit', unit, ['kg', 'N', 'lb'].map((value) => [value, value]))];
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
  if (node.nodeType === 'load-cell') return node.config?.unit ?? null;
  const specUnit = specOutputUnit(
    node,
    pinId,
    (inputPin) => incomingResolvedUnit(node, graph, inputPin, seen),
  );
  if (specUnit !== undefined) return specUnit;
  return null;
}

function incomingResolvedUnit(node, graph, pinId, seen) {
  const link = (graph?.links ?? []).find((candidate) => candidate.toNode === node.id && candidate.toPin === pinId);
  return link ? resolvedOutputUnit(graph, link.fromNode, link.fromPin, seen) : null;
}

function concrete(unit) { return Boolean(unit && unit !== '*' && unit !== 'infer' && unit !== 'V / A'); }
