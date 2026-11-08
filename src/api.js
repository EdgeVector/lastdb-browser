// Data-plane client.
//
// Every function here is one node round-trip, named for the drill-down step it
// serves. Nothing fans out, nothing prefetches the next level: the panes call
// these only when a pane is actually opened. That is the whole hydration policy
// and it is enforced here rather than by discipline in the components.

const listeners = new Set();

/** Subscribe to the request log. Returns an unsubscribe function. */
export function onRequest(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let seq = 0;

async function call(url, init, label) {
  const id = ++seq;
  const started = performance.now();
  let res;
  let payload;
  try {
    res = await fetch(url, init);
    payload = await res.json();
  } catch (err) {
    const entry = {
      id,
      label,
      url,
      ok: false,
      error: err.message,
      clientMs: Math.round(performance.now() - started),
    };
    listeners.forEach((fn) => fn(entry));
    throw new Error(`${label}: ${err.message}`);
  }
  const entry = {
    id,
    label,
    url,
    ok: payload.ok !== false,
    nodeMs: payload.ms ?? null,
    clientMs: Math.round(performance.now() - started),
    bytes: payload.bytes ?? null,
    fullScan: payload.full_scan === true,
    error: payload.ok === false ? payload.error : null,
  };
  listeners.forEach((fn) => fn(entry));

  if (payload.ok === false) throw new Error(payload.error || `${label} failed`);
  return payload;
}

export async function health() {
  return call('/db/health', undefined, 'health');
}

/**
 * Level 1 — the schema catalog.
 *
 * This is the only cached read. `include_counts=true` is what tells us which
 * schemas actually hold data, and it costs a full key-count pass on the node
 * (~30s here), so the bridge caches it and this is the only place that can ask
 * for a refresh.
 */
export async function schemas({ refresh = false } = {}) {
  return call(`/db/schemas${refresh ? '?refresh=1' : ''}`, undefined, 'schemas');
}

/**
 * Level 2a — one schema's shape: field types, descriptions, key layout, and the
 * field key ids. Fetched only when a schema is opened.
 */
export async function schemaDetail(name) {
  const payload = await call(
    `/db/schema/${encodeURIComponent(name)}`,
    undefined,
    `schema ${short(name)}`,
  );
  return payload.data.schema;
}

async function query(body, { label }) {
  const payload = await call(
    '/db/query',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    label,
  );
  return payload.data;
}

/**
 * Level 2b — a cursor page of live KEYS in a schema.
 *
 * `/api/list` is the node's keys-only admin enumeration route. It returns
 * record identities without reading field values, so browse no longer needs
 * a projection, a full-scan capability header, or a misleading total count.
 */
export async function keyList(schemaName, { cursor = null, limit = 100 } = {}) {
  const qs = new URLSearchParams({ schema: schemaName, limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  const payload = await call(
    `/db/list?${qs}`,
    undefined,
    `keys ${short(schemaName)}`,
  );
  return payload.data.list;
}

/**
 * Level 2c — a keyed read: one partition (HashKey), one record
 * (HashRangeKey), or a prefix under one hash (HashRangePrefix).
 *
 * The node returns the full record. This is the supported access pattern —
 * O(1) / O(log M) — so it does not carry the scan header, and it stays fast
 * on schemas where the paged browse is slow.
 */
export async function keyLookup(schemaName, filter) {
  return query(
    { schema_name: schemaName, filter },
    { label: `lookup ${short(schemaName)}` },
  );
}

/**
 * The key filter for one selected identity.
 */
export function keyFilter(key) {
  return key.range == null || key.range === ''
    ? { HashKey: key.hash }
    : { HashRangeKey: { hash: key.hash, range: key.range } };
}

/**
 * Level 3 — one record.
 *
 * A keyed query returns the full record, including its metadata block, so
 * level 4 needs no read of its own.
 */
export async function record(schemaName, key) {
  const data = await query(
    { schema_name: schemaName, filter: keyFilter(key) },
    { label: `record ${short(key.hash)}` },
  );
  return data.results?.[0] ?? null;
}

/**
 * Does this value name a file that exists on disk?
 *
 * Called for a field value — plenty of schemas keep a path in an ordinary
 * field.
 */
export async function statFile(candidate) {
  if (!candidate) return { exists: false };
  const payload = await call(
    `/db/file?path=${encodeURIComponent(candidate)}`,
    undefined,
    `stat ${short(candidate, 14)}`,
  );
  return payload;
}

/** Hand the file to the OS: reveal in Finder, or open in the default app. */
export async function openFile(candidate, { reveal = false } = {}) {
  return call(
    '/db/file/open',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: candidate, reveal }),
    },
    reveal ? 'reveal file' : 'open file',
  );
}

export function short(s, n = 10) {
  if (!s) return '';
  return s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s;
}
