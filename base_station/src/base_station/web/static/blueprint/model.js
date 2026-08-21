/**
 * Domain-neutral data contracts for the Liquid blueprint editor.
 *
 * These are JSDoc typedefs rather than runtime classes on purpose. The editor
 * accepts ordinary JSON-compatible objects so FastAPI can persist and return a
 * graph without a frontend serialization layer.
 */

/** @typedef {'input'|'output'} BlueprintPinDirection */
/** @typedef {'data'|'control'|'configuration'|'result'|'type'|string} BlueprintPinKind */

/**
 * A connection point rendered on a blueprint node.
 *
 * @typedef {Object} BlueprintPin
 * @property {string} id Stable pin identifier within its node.
 * @property {string} label Human-readable label.
 * @property {string} [type='*'] Produced type for outputs or displayed type for inputs.
 * @property {string|string[]} [expectedType] Accepted type or types for an input. `*` accepts anything.
 * @property {BlueprintPinDirection} direction
 * @property {BlueprintPinKind} [kind='data'] Visual/semantic category used by the wire and pin.
 * @property {string} [section] Optional section heading rendered above this pin.
 * @property {boolean} [allowMultiple=false] Whether an input may retain more than one incoming link.
 * @property {boolean} [optional=false] Whether an input may be left disconnected.
 * @property {BlueprintInlineControl} [literal] Optional editable fallback used when the input has no wire.
 */

/**
 * Small editor rendered directly inside a node.
 * @typedef {Object} BlueprintInlineControl
 * @property {string} key Node config key updated by the editor.
 * @property {string} [label]
 * @property {'number'|'text'|'select'} type
 * @property {*} [value]
 * @property {string} [unit]
 * @property {Array<[string,string]>} [options]
 * @property {'number'|'string'} [valueType]
 * @property {number|string} [min]
 * @property {number|string} [max]
 * @property {number|string} [step]
 * @property {boolean} [connected=false] Hide a pin fallback when a wire supplies the value.
 */

/**
 * Generic blueprint node. Domain code may add additional JSON-compatible fields;
 * the editor preserves fields it does not understand.
 *
 * @typedef {Object} BlueprintNode
 * @property {string} id Stable graph-wide node identifier.
 * @property {string} title
 * @property {string} [description]
 * @property {number} x World-space X position.
 * @property {number} y World-space Y position.
 * @property {number} [width=236]
 * @property {boolean} [locked=false] Prevents deletion while still allowing selection/movement.
 * @property {string} [tone='default'] Styling hook such as `source`, `transform`, `sensor`, or `result`.
 * @property {string} [icon] CSS icon class supplied by the host application.
 * @property {string} [badge]
 * @property {'valid'|'invalid'|'checking'|'unchecked'|string} [status]
 * @property {{severity:'error'|'warning'|string,message:string}[]} [diagnostics]
 * @property {BlueprintPin[]} pins
 * @property {BlueprintInlineControl[]} [controls] Compact node-local configuration controls.
 */

/**
 * Directed link from one output pin to one input pin.
 *
 * @typedef {Object} BlueprintLink
 * @property {string} id Stable graph-wide link identifier.
 * @property {string} fromNode
 * @property {string} fromPin
 * @property {string} toNode
 * @property {string} toPin
 * @property {BlueprintPinKind} [kind='data']
 */

/**
 * Serializable graph document consumed by `<liquid-blueprint-editor>`.
 *
 * @typedef {Object} BlueprintGraph
 * @property {BlueprintNode[]} nodes
 * @property {BlueprintLink[]} links
 * @property {Object<string, *>} [metadata] Domain-owned metadata preserved by the editor.
 */

/**
 * @typedef {Object} BlueprintSelection
 * @property {string[]} nodeIds
 * @property {string[]} linkIds
 */

/**
 * Ephemeral preview data rendered inside a node. Preview state is deliberately
 * kept outside {@link BlueprintGraph}, so live hardware samples never dirty the
 * saved graph document or create undo-history entries.
 *
 * @typedef {Object} BlueprintNodePreview
 * @property {string} [label] Short label such as `Live`, `Raw`, or `Filtered`.
 * @property {string|number} [value] Current displayed value.
 * @property {string} [unit] Optional engineering unit.
 * @property {number[]} [samples] Recent numeric samples for a compact sparkline.
 * @property {string} [detail] Optional secondary text.
 */

/**
 * Payload emitted with the `blueprint-change` event.
 *
 * @typedef {Object} BlueprintChangeDetail
 * @property {BlueprintGraph} graph Deep-cloned graph snapshot.
 * @property {string} reason Machine-readable reason such as `connect`, `move`, or `delete`.
 * @property {boolean} structural True when nodes/links changed; false for layout-only movement.
 */

/**
 * Payload emitted with `blueprint-create-request` when the user asks the host
 * application to create a node at a graph position.
 *
 * @typedef {Object} BlueprintCreateRequestDetail
 * @property {{x:number, y:number}} point World-space requested insertion position.
 */

/**
 * Create a safe graph clone suitable for event payloads and history snapshots.
 *
 * @param {BlueprintGraph} graph
 * @returns {BlueprintGraph}
 */
export function cloneGraph(graph) {
  return structuredClone({
    ...graph,
    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
    links: Array.isArray(graph?.links) ? graph.links : [],
  });
}

/**
 * Return a normalized graph without mutating the caller's object.
 *
 * @param {BlueprintGraph|undefined|null} graph
 * @returns {BlueprintGraph}
 */
export function normalizeGraph(graph) {
  const copy = cloneGraph(graph ?? { nodes: [], links: [] });
  copy.nodes = copy.nodes.map((node) => ({
    ...node,
    x: Number.isFinite(node.x) ? node.x : 0,
    y: Number.isFinite(node.y) ? node.y : 0,
    pins: Array.isArray(node.pins) ? node.pins : [],
  }));
  return copy;
}

/**
 * Stable semantic signature for persisted graph state.
 * Object key ordering is ignored so canonical server responses and equivalent
 * browser edits compare cleanly after undo/redo.
 */
export function graphSignature(graph) {
  return JSON.stringify(sortJson(normalizeGraph(graph)));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
  );
}
