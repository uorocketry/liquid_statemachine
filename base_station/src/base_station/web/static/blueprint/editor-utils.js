/** @param {number} value @param {number} min @param {number} max @returns {number} */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** @param {*} value @returns {string} */
export function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** @param {string} value @returns {string} */
export function cssEscape(value) {
  return globalThis.CSS?.escape
    ? CSS.escape(value)
    : value.replace(/(["\\#.:[\]()>+~*^$|= ])/g, '\\$1');
}

/** Install method/getter descriptors without invoking object-literal getters. */
export function installMethods(target, methods) {
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(methods));
}
