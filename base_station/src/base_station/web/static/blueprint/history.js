/**
 * @template T
 * @typedef {Object} HistoryController
 * @property {boolean} canUndo
 * @property {boolean} canRedo
 * @property {(value:T) => void} record
 * @property {(current:T) => T|null} undo
 * @property {(current:T) => T|null} redo
 * @property {() => void} clear
 */

/**
 * Small structured-clone history stack ported from the Mica blueprint editor.
 *
 * @template T
 * @param {number} [limit=100]
 * @returns {HistoryController<T>}
 */
export function createHistory(limit = 100) {
  /** @type {T[]} */
  const past = [];
  /** @type {T[]} */
  const future = [];

  return {
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    record(value) {
      past.push(structuredClone(value));
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(current) {
      const previous = past.pop();
      if (!previous) return null;
      future.push(structuredClone(current));
      return structuredClone(previous);
    },
    redo(current) {
      const next = future.pop();
      if (!next) return null;
      past.push(structuredClone(current));
      return structuredClone(next);
    },
    clear() {
      past.length = 0;
      future.length = 0;
    },
  };
}
