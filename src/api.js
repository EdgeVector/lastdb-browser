// Data-plane client.
//
// Every function here is one node round-trip, named for the drill-down step it
// serves:
//   databases -> schemas -> keys -> record
// Nothing fans out and nothing prefetches the next level: the panes call these
// only when a pane is opened.

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
 * Level 1 — databases registered on the node (`POST /v1/x/databases` `list`).
 */
export async function databases() {
  const payload = await call('/db/databases', undefined, 'databases');
  return payload.data?.databases ?? [];
}

/**
 * Level 2 — schemas on one selected database (`POST /v1/x/databases` `schemas`
 * with `include_full: true`, so field types, descriptions, field hashes, and
 * `record_keys` arrive in the same single round-trip).
 */
export async function schemas(databaseId) {
  const qs = databaseId ? `?database=${encodeURIComponent(databaseId)}` : '';
  const payload = await call(
    `/db/schemas${qs}`,
    undefined,
    `schemas ${short(databaseId || 'personal', 10)}`,
  );
  return {
    fetched_at: new Date().toISOString(),
    count: payload.data?.count ?? (payload.data?.schemas?.length ?? 0),
    schemas: payload.data?.schemas ?? [],
  };
}

async function read(item, label) {
  const payload = await call(
    '/db/read',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    },
    label,
  );
  return payload.data;
}

/**
 * Level 3a — a cursor page of primary keys in a schema (`POST /v1/read` with
 * `keys_only: true`).
 */
export async function keyList(databaseId, schemaName, { cursor = null, limit = 100 } = {}) {
  const item = {
    database: databaseId,
    schema: schemaName,
    keys_only: true,
    limit,
  };
  if (cursor != null && cursor !== '') item.cursor = cursor;
  const page = await read(item, `keys ${short(schemaName)}`);
  const next = page.next_cursor ?? null;
  return {
    keys: page.keys ?? [],
    next_cursor: next,
    has_more: next != null && next !== '',
  };
}

/**
 * Level 3b — a keyed or range lookup (`ReadByKey` or `ReadByRange` on
 * `POST /v1/read`, optionally through a named alternate key `via`).
 */
export async function keyLookup(databaseId, schemaName, spec, { limit = 100, cursor = null } = {}) {
  const item = {
    database: databaseId,
    schema: schemaName,
    limit,
    ...spec,
  };
  if (cursor != null && cursor !== '') item.cursor = cursor;
  const page = await read(item, `lookup ${short(schemaName)}`);
  const next = page.next_cursor ?? null;
  return {
    records: page.records ?? [],
    next_cursor: next,
    has_more: next != null && next !== '',
  };
}

/**
 * Level 4 — one record by primary key (`POST /v1/read` `ReadByKey`).
 */
export async function record(databaseId, schemaName, key) {
  const keyInput = { hash: key.hash };
  if (key.range != null) keyInput.range = key.range;
  const page = await read(
    {
      database: databaseId,
      schema: schemaName,
      key: keyInput,
    },
    `record ${short(key.hash)}`,
  );
  return page.records?.[0] ?? null;
}

/** Does this value name a file that exists on disk? */
export async function statFile(candidate) {
  if (!candidate) return { exists: false };
  return call(
    `/db/file?path=${encodeURIComponent(candidate)}`,
    undefined,
    `stat ${short(candidate, 14)}`,
  );
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
