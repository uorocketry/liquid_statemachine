/** Declarative definitions for hardware-independent DAQ graph nodes. */

import {
  ENGINEERING_UNITS, booleanControl, dashboardIdentityControls, gaugeControls, numberControl,
  option, selectControl, timePlotControls,
} from './node-spec-controls.js';
import {
  finite, positive, validateDashboardIdentity, validateGauge, validatePrecision,
  validateSine, validateTimePlot,
} from './node-spec-validation.js';

export { numberControl, selectControl } from './node-spec-controls.js';


const SPECS = {
  'sine-wave': {
    category: 'Simulation',
    title: 'Sine wave',
    icon: 'icon-node-sine',
    tone: 'source',
    description: 'Generate a configurable test signal without DAQ hardware.',
    previewSource: true,
    pins: (config) => [output('signal', 'Signal', config.unit)],
    controls: (config) => [
      numberControl('amplitude', 'Amplitude', config.amplitude, config.unit),
      numberControl('periodS', 'Period', config.periodS, 's', { min: 0, step: 0.1 }),
      numberControl('offset', 'Offset', config.offset, config.unit),
      numberControl('phaseRad', 'Phase', config.phaseRad, 'rad', { step: 0.1 }),
      numberControl('randomness', 'Randomness', config.randomness, '', { min: 0, max: 1, step: 0.05 }),
      selectControl('unit', 'Unit', config.unit, ENGINEERING_UNITS.map(option)),
    ],
    badge: (config) => `${format(config.periodS)} s`,
    outputUnit: (node, pinId) => pinId === 'signal' ? node.config?.unit ?? 'V' : undefined,
    unitOutputPins: ['signal'],
    validate: validateSine,
  },
  constant: {
    category: 'Math',
    title: 'Constant',
    icon: 'icon-node-constant',
    tone: 'transform',
    description: 'Named engineering constant such as tank dry mass.',
    pins: (config) => [output('value', 'Value', config.unit)],
    controls: (config) => [
      numberControl('value', 'Value', config.value, config.unit),
      selectControl('unit', 'Unit', config.unit, ENGINEERING_UNITS.map(option)),
    ],
    badge: (config) => `${format(config.value)} ${config.unit ?? ''}`.trim(),
    outputUnit: (node, pinId) => pinId === 'value' ? node.config?.unit ?? null : undefined,
    unitOutputPins: ['value'],
    validate: (config) => finite(config.value) ? [] : ['Constant value must be finite'],
  },
  add: inferredMathSpec('Add', 'icon-node-add', 'Add two engineering signals with matching units.', 'A + B'),
  subtract: inferredMathSpec('Subtract', 'icon-node-subtract', 'Subtract one engineering signal from another.', 'A − B'),
  gain: {
    ...inferredUnarySpec('Gain', 'icon-node-gain', 'Scale an engineering signal by a dimensionless gain.', 'Scaled'),
    controls: (config) => [numberControl('gain', 'Gain', config.gain)],
    validate: (config) => finite(config.gain) ? [] : ['Gain must be finite'],
  },
  'moving-average': {
    ...inferredUnarySpec('Moving average', 'icon-node-average', 'Smooth a signal over a configurable time window.', 'Average'),
    controls: (config) => [numberControl('windowS', 'Window', config.windowS, 's', { min: 0.001, step: 0.05 })],
    validate: (config) => positive(config.windowS) ? [] : ['Moving-average window must be positive'],
  },
  'rate-of-change': {
    category: 'Math',
    title: 'Rate of change',
    icon: 'icon-node-rate',
    tone: 'transform',
    description: 'Time derivative for mass-flow and similar derived signals.',
    pins: () => [input('input', 'Signal', 'infer', '*'), output('rate', 'Rate', 'infer')],
    controls: (config) => [numberControl('windowS', 'Window', config.windowS, 's', { min: 0.01, step: 0.05 })],
    decorate(next, graph, helpers) {
      const unit = helpers.incomingUnit(next, graph, 'input');
      const outputUnit = concrete(unit) ? `${unit}/s` : 'infer';
      setPinType(next, 'input', unit ?? 'infer');
      setPinType(next, 'rate', outputUnit);
      next.badge = outputUnit;
    },
    outputUnit: (_node, pinId, resolveInput) => {
      if (pinId !== 'rate') return undefined;
      const unit = resolveInput('input');
      return concrete(unit) ? `${unit}/s` : null;
    },
    validate: (config) => positive(config.windowS) ? [] : ['Rate-of-change window must be positive'],
  },
  number: {
    category: 'Dashboard',
    title: 'Number',
    icon: 'icon-node-number',
    tone: 'result',
    description: 'Show one live engineering value on the operator dashboard.',
    pins: dashboardPins,
    controls: (config) => [
      ...dashboardIdentityControls(config),
      numberControl('precision', 'Decimals', config.precision, '', { min: 0, max: 6, step: 1 }),
      booleanControl('showUnits', 'Show units', config.showUnits),
    ],
    decorate: decorateDashboardInput,
    validate: (config) => [
      ...validateDashboardIdentity(config),
      ...validatePrecision(config.precision),
      ...(typeof config.showUnits === 'boolean' ? [] : ['Number showUnits must be on or off']),
    ],
  },
  gauge: {
    category: 'Dashboard',
    title: 'Gauge',
    icon: 'icon-node-gauge',
    tone: 'result',
    description: 'Show one live value against configured engineering limits.',
    pins: dashboardPins,
    controls: gaugeControls,
    decorate: decorateDashboardInput,
    validate: validateGauge,
  },
  'time-plot': {
    category: 'Dashboard',
    title: 'Time plot',
    icon: 'icon-node-time-plot',
    tone: 'result',
    description: 'Plot one engineering value with configurable time and value axes.',
    pins: dashboardPins,
    controls: timePlotControls,
    decorate: decorateDashboardInput,
    validate: validateTimePlot,
  },
};

let defaultsConfigured = false;

/** Configure declarative-node defaults from the authoritative server contract. */
export function configureSpecDefaults(defaults) {
  if (!defaults || typeof defaults !== 'object') throw new TypeError('DAQ node defaults are required');
  for (const [nodeType, spec] of Object.entries(SPECS)) {
    const nodeDefaults = defaults[nodeType];
    if (!nodeDefaults || typeof nodeDefaults !== 'object' || Array.isArray(nodeDefaults)) {
      throw new Error(`Missing DAQ defaults for ${nodeType}`);
    }
    spec.defaults = structuredClone(nodeDefaults);
  }
  const extras = Object.keys(defaults).filter((nodeType) => !SPECS[nodeType]);
  if (extras.length) throw new Error(`Unknown DAQ defaults: ${extras.join(', ')}`);
  defaultsConfigured = true;
}

export const SPEC_NODE_CATALOG = Object.entries(SPECS).map(([type, spec]) => ({
  type,
  category: spec.category,
  title: spec.title,
  icon: spec.icon,
  description: spec.description,
}));

export function isSpecNodeType(nodeType) {
  return Boolean(SPECS[nodeType]);
}

export function isPreviewSourceNode(node) {
  return Boolean(SPECS[node?.nodeType]?.previewSource);
}

export function createSpecNode(nodeType, common) {
  const spec = SPECS[nodeType];
  if (!spec) return null;
  const config = structuredClone(defaultsFor(nodeType, spec));
  return { ...common, tone: spec.tone, config, pins: spec.pins(config) };
}

export function decorateSpecNode(node, graph, helpers) {
  const spec = SPECS[node.nodeType];
  if (!spec) return null;
  const next = structuredClone(node);
  const config = currentConfig(defaultsFor(node.nodeType, spec), next.config ?? {});
  next.config = config;
  next.icon = spec.icon;
  next.controls = spec.controls?.(config) ?? [];
  if (spec.infer) decorateInferred(next, graph, helpers.incomingUnit, spec.infer);
  spec.decorate?.(next, graph, helpers);
  if (spec.badge) next.badge = spec.badge(config);
  return next;
}

export function validateSpecNode(node) {
  const spec = SPECS[node?.nodeType];
  return spec
    ? (spec.validate?.(currentConfig(defaultsFor(node.nodeType, spec), node.config ?? {})) ?? [])
    : null;
}

export function specOutputUnit(node, pinId, resolveInput) {
  const spec = SPECS[node?.nodeType];
  return spec?.outputUnit ? spec.outputUnit(node, pinId, resolveInput) : undefined;
}

export function patchSpecPins(node, key, value) {
  const spec = SPECS[node?.nodeType];
  if (!spec || key !== 'unit' || !spec.unitOutputPins?.length) return null;
  const targets = new Set(spec.unitOutputPins);
  return node.pins.map((pin) => targets.has(pin.id) ? { ...pin, type: String(value) } : pin);
}

function inferredMathSpec(title, icon, description, outputLabel) {
  return {
    category: 'Math', title, icon, tone: 'transform', description,
    pins: () => [input('a', 'A', 'infer', '*'), input('b', 'B', 'infer', '*'), output('result', outputLabel, 'infer')],
    infer: { inputs: ['a', 'b'], output: 'result' },
    outputUnit: (_node, pinId, resolveInput) => pinId === 'result'
      ? resolveInput('a') ?? resolveInput('b')
      : undefined,
  };
}

function inferredUnarySpec(title, icon, description, outputLabel) {
  return {
    category: 'Math', title, icon, tone: 'transform', description,
    pins: () => [input('input', 'Signal', 'infer', '*'), output('result', outputLabel, 'infer')],
    infer: { inputs: ['input'], output: 'result' },
    outputUnit: (_node, pinId, resolveInput) => pinId === 'result' ? resolveInput('input') : undefined,
  };
}

function dashboardPins() {
  return [input('value', 'Value', '*', '*')];
}

function decorateDashboardInput(next, graph, helpers) {
  const unit = helpers.incomingUnit(next, graph, 'value');
  if (concrete(unit)) setPinType(next, 'value', unit);
}

function decorateInferred(node, graph, incomingUnit, infer) {
  const unit = infer.inputs.map((pin) => incomingUnit(node, graph, pin)).find(concrete) ?? 'infer';
  for (const pin of infer.inputs) setPinType(node, pin, unit);
  setPinType(node, infer.output, unit);
  node.badge = unit;
}

function defaultsFor(nodeType, spec) {
  if (!defaultsConfigured || !spec?.defaults) {
    throw new Error(`DAQ defaults not configured before using ${nodeType}`);
  }
  return spec.defaults;
}

function currentConfig(defaults, config) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
    key,
    structuredClone(Object.hasOwn(config ?? {}, key) ? config[key] : fallback),
  ]));
}

function input(id, label, type, expectedType = type, options = {}) {
  return { id, label, type, expectedType, direction: 'input', kind: 'data', ...options };
}
function output(id, label, type) {
  return { id, label, type, direction: 'output', kind: 'result' };
}
function setPinType(node, pinId, unit) {
  const pin = node.pins?.find((candidate) => candidate.id === pinId);
  if (pin) pin.type = unit;
}
function concrete(unit) { return Boolean(unit && unit !== '*' && unit !== 'infer' && unit !== 'V / A'); }
function format(value) { return finite(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 5 }) : '—'; }
