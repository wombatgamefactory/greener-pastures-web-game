/**
 * Dotted paths into the data tree.
 *
 * Every tunable number in the game has exactly one address, and one walker
 * produces both the list of addresses and the ability to write to one. That
 * matters: if listing and setting used different rules they would drift, and a
 * knob would quietly do nothing.
 *
 * Segment rules, in order:
 *   - a plain object     -> its keys are segments  (`levelRules.3.vp`)
 *   - an array of objects with an `id` -> that id is the segment  (`cards.W7.threshold`)
 *   - any other array    -> the array IS a leaf, replaced whole  (`workers.draw.wages`)
 *   - anything else      -> a leaf
 *
 * A key named `meta` is skipped everywhere. It holds prose and provenance, never
 * a knob, and flattening it would bury the real paths in note text.
 */

export type Leaf = string | number | boolean | null | readonly (string | number)[];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIdKeyedArray(v: unknown): v is Array<Record<string, unknown> & { id: string }> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((e) => isPlainObject(e) && typeof e['id'] === 'string')
  );
}

function isLeaf(v: unknown): v is Leaf {
  if (v === null) return true;
  if (Array.isArray(v)) return !isIdKeyedArray(v);
  return typeof v !== 'object';
}

/**
 * Every addressable leaf in the tree, keyed by dotted path. Insertion order is
 * tree order, which is what `--list-knobs` prints.
 */
export function flatten(root: unknown): Map<string, Leaf> {
  const out = new Map<string, Leaf>();

  const walk = (node: unknown, prefix: string): void => {
    if (isLeaf(node)) {
      out.set(prefix, node);
      return;
    }
    if (isIdKeyedArray(node)) {
      for (const entry of node) walk(entry, `${prefix}.${entry.id}`);
      return;
    }
    if (isPlainObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'meta') continue;
        walk(value, prefix ? `${prefix}.${key}` : key);
      }
    }
    // An array of objects without ids is unaddressable. There are none in the
    // data; if one appears, it shows up as a missing knob rather than a wrong one.
  };

  walk(root, '');
  return out;
}

/** Split a path and resolve each segment, returning the containing object and final key. */
function descend(
  root: unknown,
  path: string,
): { container: Record<string, unknown>; key: string } | null {
  const segments = path.split('.');
  const last = segments.pop();
  if (last === undefined) return null;

  let node: unknown = root;
  for (const segment of segments) {
    if (isIdKeyedArray(node)) {
      node = node.find((e) => e.id === segment);
    } else if (isPlainObject(node)) {
      node = node[segment];
    } else {
      return null;
    }
    if (node === undefined) return null;
  }

  // A trailing id segment addresses a whole card, which is never a leaf.
  if (isIdKeyedArray(node)) return null;
  if (!isPlainObject(node)) return null;
  if (!(last in node)) return null;
  return { container: node, key: last };
}

export function getPath(root: unknown, path: string): Leaf | undefined {
  const found = descend(root, path);
  if (!found) return undefined;
  const value = found.container[found.key];
  return isLeaf(value) ? value : undefined;
}

/**
 * Write a leaf in place. The caller owns a deep clone by this point; this never
 * clones for you, because cloning per write would be quadratic over a sweep.
 * Returns false if the path does not resolve to an existing leaf.
 */
export function setPath(root: unknown, path: string, value: Leaf): boolean {
  const found = descend(root, path);
  if (!found) return false;
  if (!isLeaf(found.container[found.key])) return false;
  found.container[found.key] = value;
  return true;
}

/** Structural clone, good enough for JSON-shaped data and dependency-free. */
export function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
