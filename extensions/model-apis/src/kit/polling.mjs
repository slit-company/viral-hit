// Spaces status checks per task so a busy worker does not hammer provider status endpoints.
export function createPacer(minimum = 2, maximum = 15) {
  const next = new Map();
  return {
    wait(taskId) { return (next.get(taskId)?.until ?? 0) > Date.now(); },
    defer(taskId, seconds) {
      const previous = next.get(taskId)?.delay ?? minimum / 1.5;
      const delay = Math.max(minimum, Math.min(maximum, seconds ?? previous * 1.5));
      if (next.size >= 1024) next.delete(next.keys().next().value);
      next.set(taskId, { delay, until: Date.now() + delay * 1000 });
    },
    done(taskId) { next.delete(taskId); },
  };
}

export const processing = taskId => ({ status: 'processing', taskId });
export const unknownCost = { state: 'unknown', final: false };

/** Joins a provider-local prefix and an upstream ID into a task ID that fits the 200-character ledger field. */
export function taskId(prefix, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._:/-]{1,180}$/.test(id)) throw Error('Provider returned an invalid task ID');
  return prefix + ':' + id;
}
export function parseTaskId(prefix, value) {
  if (typeof value !== 'string' || !value.startsWith(prefix + ':')) throw Error('Unknown task ID for this provider');
  return value.slice(prefix.length + 1);
}

/** Reads a key from the encrypted workspace configuration passed with each request. */
// Vendors change key formats, so only obviously broken values are rejected; pass a pattern only when the format carries meaning.
export function credential(configuration, name, label, pattern = /^\S{16,}$/) {
  const value = configuration?.[name]?.trim();
  if (!value || !pattern.test(value)) throw Error('Connect your ' + label + ' API key in Connections');
  return value;
}
