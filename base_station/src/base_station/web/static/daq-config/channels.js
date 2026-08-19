/** Helpers for T7 and optional MUX80 channel selection. */

/**
 * @param {Object} capabilities
 * @param {boolean} muxEnabled
 * @returns {string[]}
 */
export function availableChannels(capabilities, muxEnabled) {
  const base = capabilities?.analog?.base_channels ?? [];
  if (!muxEnabled) return [...base];
  const direct = base.filter((name) => Number(name.slice(3)) <= 3);
  return [...direct, ...(capabilities?.mux80?.channels ?? [])];
}

/**
 * @param {Object} capabilities
 * @param {boolean} muxEnabled
 * @returns {string[]}
 */
export function differentialPositiveChannels(capabilities, muxEnabled) {
  return availableChannels(capabilities, muxEnabled).filter((channel) => {
    const number = Number(channel.slice(3));
    if (number < 16) return number % 2 === 0;
    const offset = number - 48;
    return offset >= 0 && Math.floor(offset / 8) % 2 === 0;
  });
}

/** @param {string} positive @returns {string} */
export function differentialNegative(positive) {
  const number = Number(positive.slice(3));
  return `AIN${number >= 16 ? number + 8 : number + 1}`;
}

/** @param {string} channel @returns {string} */
export function channelLabel(channel) {
  return channel;
}

/** @param {string} positive @returns {string} */
export function channelPairLabel(positive) {
  const negative = differentialNegative(positive);
  return `${positive} / ${negative}`;
}
