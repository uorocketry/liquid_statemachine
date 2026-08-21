import { GAUGE_TYPES } from './node-spec-controls.js';

export function finite(value) {
  return value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));
}

export function positive(value) {
  return finite(value) && Number(value) > 0;
}

export function validateSine(config) {
  const issues = [];
  for (const [key, label] of [
    ['amplitude', 'amplitude'], ['periodS', 'period'], ['offset', 'offset'],
    ['phaseRad', 'phase'], ['randomness', 'randomness'],
  ]) {
    if (!finite(config[key])) issues.push(`Sine-wave ${label} must be finite`);
  }
  if (finite(config.periodS) && Number(config.periodS) < 0) issues.push('Sine-wave period cannot be negative');
  if (finite(config.randomness) && (Number(config.randomness) < 0 || Number(config.randomness) > 1)) {
    issues.push('Sine-wave randomness must be between 0 and 1');
  }
  if (!String(config.unit ?? '').trim()) issues.push('Sine-wave unit is required');
  return issues;
}

export function validateDashboardIdentity(config) {
  return String(config.label ?? '').trim() ? [] : ['Dashboard widget requires a label'];
}

export function validatePrecision(value) {
  const precision = Number(value);
  return Number.isInteger(precision) && precision >= 0 && precision <= 6
    ? [] : ['Dashboard decimal places must be 0 through 6'];
}

export function validateGauge(config) {
  const issues = [...validateDashboardIdentity(config), ...validatePrecision(config.precision)];
  if (!GAUGE_TYPES.some(([value]) => value === config.type)) issues.push('Select a supported dashboard gauge type');
  for (const key of ['showValue', 'showUnits', 'showRange']) {
    if (typeof config[key] !== 'boolean') issues.push(`Gauge ${key} must be on or off`);
  }
  if (!finite(config.min) || !finite(config.max) || Number(config.max) <= Number(config.min)) {
    issues.push('Gauge maximum must be greater than minimum');
    return issues;
  }
  if (config.low !== null && config.low !== '' && (!finite(config.low) || Number(config.low) < Number(config.min) || Number(config.low) >= Number(config.max))) {
    issues.push('Gauge low limit must be within the display range');
  }
  if (config.high !== null && config.high !== '' && (!finite(config.high) || Number(config.high) <= Number(config.min) || Number(config.high) > Number(config.max))) {
    issues.push('Gauge high limit must be within the display range');
  }
  if (finite(config.low) && finite(config.high) && Number(config.low) > Number(config.high)) {
    issues.push('Gauge low limit cannot exceed the high limit');
  }
  return issues;
}

export function validateTimePlot(config) {
  const issues = [...validateDashboardIdentity(config)];
  if (!['shared', 'auto', 'window', 'fixed'].includes(config.xRangeMode)) {
    issues.push('Time-plot X range must use Dashboard view, Auto data extent, Trailing window, or Fixed bounds');
  }
  if (config.xRangeMode === 'window' && !positive(config.xWindowS)) issues.push('Time-plot X window must be positive');
  if (config.xRangeMode === 'fixed' && (!finite(config.xMinS) || !finite(config.xMaxS) || Number(config.xMaxS) <= Number(config.xMinS))) {
    issues.push('Time-plot X maximum must be greater than X minimum');
  }
  if (!['auto', 'manual'].includes(config.xTickMode)) issues.push('Time-plot X ticks must be Auto or Manual');
  if (config.xTickMode === 'manual' && !positive(config.xMajorStepS)) issues.push('Time-plot X major step must be positive');
  if (!['linear', 'log10'].includes(config.yAxisScale)) issues.push('Time-plot Y scale must be Linear or Log 10');
  if (!['auto', 'soft', 'fixed'].includes(config.yRangeMode)) issues.push('Time-plot Y range must be Auto, Soft bounds, or Fixed bounds');
  if (config.yRangeMode === 'fixed' && (!finite(config.yMin) || !finite(config.yMax) || Number(config.yMax) <= Number(config.yMin))) {
    issues.push('Time-plot Y maximum must be greater than Y minimum');
  }
  if (config.yAxisScale === 'log10' && config.yRangeMode === 'fixed' && finite(config.yMin) && Number(config.yMin) <= 0) {
    issues.push('Time-plot logarithmic Y minimum must be greater than zero');
  }
  if (config.yRangeMode === 'soft') validateSoftBounds(config, issues);
  if (!['auto', 'manual'].includes(config.yTickMode)) issues.push('Time-plot Y ticks must be Auto or Manual');
  if (config.yAxisScale === 'linear' && config.yTickMode === 'manual' && !positive(config.yMajorStep)) {
    issues.push('Time-plot Y major step must be positive');
  }
  if (typeof config.showGrid !== 'boolean') issues.push('Time-plot major grid must be on or off');
  if (typeof config.showMinorGrid !== 'boolean') issues.push('Time-plot minor grid must be on or off');
  return issues;
}

function validateSoftBounds(config, issues) {
  for (const [key, label] of [['ySoftMin', 'soft minimum'], ['ySoftMax', 'soft maximum']]) {
    if (config[key] !== null && config[key] !== '' && !finite(config[key])) issues.push(`Time-plot Y ${label} must be finite`);
    if (config.yAxisScale === 'log10' && finite(config[key]) && Number(config[key]) <= 0) {
      issues.push(`Time-plot logarithmic Y ${label} must be greater than zero`);
    }
  }
  if (finite(config.ySoftMin) && finite(config.ySoftMax) && Number(config.ySoftMax) <= Number(config.ySoftMin)) {
    issues.push('Time-plot Y soft maximum must be greater than soft minimum');
  }
}
