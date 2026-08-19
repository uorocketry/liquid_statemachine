/** @typedef {import('./model.js').BlueprintGraph} BlueprintGraph */
/** @typedef {import('./model.js').BlueprintNode} BlueprintNode */
/** @typedef {import('./model.js').BlueprintLink} BlueprintLink */
/** @typedef {import('./model.js').BlueprintPin} BlueprintPin */

/** @typedef {{x:number, y:number}} Point */
/** @typedef {{x:number, y:number, width:number, height:number}} Rect */

/**
 * Bezier path used by both committed links and drag previews.
 *
 * @param {Point} a
 * @param {Point} b
 * @returns {string}
 */
export function wirePath(a, b) {
  const dx = b.x - a.x;
  const bend = Math.max(64, Math.min(210, Math.abs(dx) * 0.46));
  if (dx >= 0) {
    return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`;
  }
  const lift = Math.max(54, Math.min(140, Math.abs(b.y - a.y) + 44));
  return `M ${a.x} ${a.y} C ${a.x + 90} ${a.y}, ${a.x + 90} ${a.y - lift}, ${a.x} ${a.y - lift} C ${b.x - 90} ${a.y - lift}, ${b.x - 90} ${b.y}, ${b.x} ${b.y}`;
}

/**
 * Default domain-neutral pin compatibility rule.
 *
 * The connection must run output -> input. `*` and `infer` are treated as
 * wildcards. Inputs may specify one accepted type or an array of accepted types.
 * Applications can replace this policy through `editor.connectionPolicy`.
 *
 * @param {BlueprintPin} source
 * @param {BlueprintPin} target
 * @returns {boolean}
 */
export function pinsCompatible(source, target) {
  if (source.direction !== 'output' || target.direction !== 'input') return false;
  const sourceType = source.type ?? '*';
  const expected = target.expectedType ?? target.type ?? '*';
  const accepted = Array.isArray(expected) ? expected : [expected];
  return sourceType === '*' || sourceType === 'infer'
    || accepted.includes('*') || accepted.includes('infer') || accepted.includes(sourceType);
}

/**
 * Resolve two arbitrary pins into an output/input pair if compatible.
 *
 * @param {BlueprintPin} first
 * @param {BlueprintPin} second
 * @param {(source:BlueprintPin, target:BlueprintPin) => boolean} [policy=pinsCompatible]
 * @returns {{source:BlueprintPin, target:BlueprintPin}|null}
 */
export function compatibleConnection(first, second, policy = pinsCompatible) {
  const source = first.direction === 'output' ? first : second.direction === 'output' ? second : null;
  const target = first.direction === 'input' ? first : second.direction === 'input' ? second : null;
  return source && target && policy(source, target) ? { source, target } : null;
}

/** @param {Rect} a @param {Rect} b @returns {boolean} */
export function intersects(a, b) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x
    && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/** @param {Point} a @param {Point} b @returns {Rect} */
export function rectFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * @param {BlueprintLink[]} links
 * @returns {string}
 */
export function nextLinkId(links) {
  let index = links.length + 1;
  while (links.some((link) => link.id === `l${index}`)) index += 1;
  return `l${index}`;
}

/**
 * Copy only unlocked selected nodes and links fully contained by that selection.
 *
 * @param {BlueprintNode[]} nodes
 * @param {BlueprintLink[]} links
 * @param {ReadonlySet<string>} selected
 * @returns {{nodes:BlueprintNode[], links:BlueprintLink[]}}
 */
export function cloneSelection(nodes, links, selected) {
  const copiedNodes = nodes
    .filter((node) => selected.has(node.id) && !node.locked)
    .map((node) => structuredClone(node));
  const ids = new Set(copiedNodes.map((node) => node.id));
  const copiedLinks = links
    .filter((link) => ids.has(link.fromNode) && ids.has(link.toNode))
    .map((link) => structuredClone(link));
  return { nodes: copiedNodes, links: copiedLinks };
}

/**
 * @param {{nodes:BlueprintNode[], links:BlueprintLink[]}} clipboard
 * @param {BlueprintGraph} graph
 * @param {number} serial
 * @returns {{graph:BlueprintGraph, selected:Set<string>}}
 */
export function pasteSelection(clipboard, graph, serial) {
  const ids = new Map();
  const pasted = clipboard.nodes.map((node, index) => {
    const id = `${node.id}-copy-${serial}-${index + 1}`;
    ids.set(node.id, id);
    return { ...structuredClone(node), id, x: node.x + 48 * serial, y: node.y + 48 * serial };
  });
  const links = [...graph.links];
  for (const link of clipboard.links) {
    links.push({
      ...structuredClone(link),
      id: nextLinkId(links),
      fromNode: ids.get(link.fromNode),
      toNode: ids.get(link.toNode),
    });
  }
  return {
    graph: { ...graph, nodes: [...graph.nodes, ...pasted], links },
    selected: new Set(pasted.map((node) => node.id)),
  };
}

/**
 * Find the shortest directed node path between two nodes using graph links.
 * Returns an empty array when no directed route exists.
 *
 * @param {BlueprintGraph} graph
 * @param {string} fromNodeId
 * @param {string} toNodeId
 * @returns {string[]}
 */
export function directedNodePath(graph, fromNodeId, toNodeId) {
  if (fromNodeId === toNodeId) {
    return graph.nodes.some((node) => node.id === fromNodeId) ? [fromNodeId] : [];
  }
  const outgoing = new Map();
  for (const link of graph.links) {
    if (!outgoing.has(link.fromNode)) outgoing.set(link.fromNode, []);
    outgoing.get(link.fromNode).push(link.toNode);
  }
  const queue = [[fromNodeId]];
  const visited = new Set([fromNodeId]);
  while (queue.length) {
    const path = queue.shift();
    const tail = path.at(-1);
    for (const next of outgoing.get(tail) ?? []) {
      if (visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === toNodeId) return candidate;
      visited.add(next);
      queue.push(candidate);
    }
  }
  return [];
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function additiveSelection(event) {
  return event.metaKey || event.ctrlKey || event.shiftKey;
}
