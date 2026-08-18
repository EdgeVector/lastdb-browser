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
 * per-field molecule UUIDs. Fetched only when a schema is opened.
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
 * record identities without resolving field atoms, so browse no longer needs
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
 * Candidate projection fields for keyed LOOKUP, best first.
 *
 * The HASH KEY FIELD leads, and that is not a stylistic choice — the projection
 * decides whether the returned key is usable at all. For one page of rows, only
 * the hash component of the key changes with the projection:
 *
 *   projecting the hash field    -> key.hash is the plaintext value
 *   projecting any other field   -> key.hash is the ENCODED partition token
 *
 * The range component is the same either way. The token cannot be fed back to a
 * HashKey read, so a listing built on one looks perfectly normal and every
 * record opened from it resolves to nothing. The plaintext is recoverable only
 * from the hash field's own value, so no other field can stand in for it.
 *
 * Hence: hash field, then range field, then data fields as a last resort for
 * schemas whose key fields carry no atoms at all.
 */
export function projectionCandidates(schema) {
  const fields = schema?.fields ?? [];
  const hashField = schema?.key?.hash_field;
  const rangeField = schema?.key?.range_field;
  const keyFields = [hashField, rangeField].filter((f) => f && fields.includes(f));
  const nonKey = fields.filter((f) => !keyFields.includes(f));
  return [...keyFields, ...nonKey];
}

/**
 * Level 2c — a keyed read: one partition (HashKey) or one record
 * (HashRangeKey), still projecting only the key fields.
 *
 * This is the node's supported access pattern — O(1) / O(log M) — so it does
 * NOT carry the scan header, and it stays fast on schemas where the paged
 * browse is slow.
 */
export async function keyLookup(schemaName, keyFields, filter) {
  return query(
    { schema_name: schemaName, fields: keyFields, filter },
    { label: `lookup ${short(schemaName)}` },
  );
}

/**
 * Level 3 — one record, hydrated.
 *
 * Now, and only now, do we ask for every field. The response carries per-field
 * metadata (atom_uuid, molecule_uuid, version, conflict flag), which is what
 * makes level 4 a direct fetch rather than a search.
 */
export function keyFilter(key) {
  return key.range == null || key.range === ''
    ? { HashKey: key.hash }
    : { HashRangeKey: { hash: key.hash, range: key.range } };
}

export async function record(schemaName, fields, key) {
  const data = await query(
    { schema_name: schemaName, fields, filter: keyFilter(key) },
    { label: `record ${short(key.hash)}` },
  );
  return data.results?.[0] ?? null;
}

/**
 * Rebuild a record one field at a time.
 *
 * The wide read above returns a row only if EVERY projected field resolves on
 * it, so a single missing field blanks the whole record — and on a schema that
 * has gained fields over time, that is the normal case for older rows rather
 * than an exotic one. Reading each field on its own removes the coupling: a
 * field that has no atom drops itself instead of the record.
 *
 * This is the fallback, not the default: it is N keyed reads instead of one.
 * Keyed reads are the cheap path, and they run concurrently, but the wide read
 * is still strictly better when it works.
 */
export async function recordByField(schemaName, fields, key, maxFields = 48) {
  const filter = keyFilter(key);
  const chosen = fields.slice(0, maxFields);
  const settled = await Promise.all(
    chosen.map(async (f) => {
      try {
        const data = await query(
          { schema_name: schemaName, fields: [f], filter },
          { label: `field ${f}` },
        );
        return [f, data.results?.[0] ?? null];
      } catch {
        return [f, null];
      }
    }),
  );
  const row = { key, fields: {}, metadata: {} };
  let any = false;
  for (const [f, res] of settled) {
    if (!res) continue;
    any = true;
    if (f in (res.fields || {})) row.fields[f] = res.fields[f];
    if (res.metadata?.[f]) row.metadata[f] = res.metadata[f];
  }
  return any ? row : null;
}

/** Level 4 — the atom body itself. */
export async function atom(uuid) {
  const payload = await call(`/db/atom/${encodeURIComponent(uuid)}`, undefined, `atom ${short(uuid)}`);
  return payload.data;
}

/**
 * Level 4 (optional) — prior versions of one field at one key.
 *
 * Scoped by hash/range on purpose: a molecule is per-FIELD and shared by every
 * key in the schema, so an unscoped history read is not this record's history.
 */
export async function history(moleculeUuid, key) {
  const qs = new URLSearchParams();
  if (key?.hash != null) qs.set('hash', key.hash);
  if (key?.range) qs.set('range', key.range);
  const payload = await call(
    `/db/history/${encodeURIComponent(moleculeUuid)}?${qs}`,
    undefined,
    `history ${short(moleculeUuid)}`,
  );
  return payload.data;
}

/** Level 4 (optional) — the protein this field's molecule is bound to, if any. */
export async function proteinOfMolecule(moleculeUuid) {
  const payload = await call(
    `/db/protein/of-molecule/${encodeURIComponent(moleculeUuid)}`,
    undefined,
    `protein ${short(moleculeUuid)}`,
  );
  return payload.data;
}

/**
 * Does this value name a file that exists on disk?
 *
 * Called for an atom's `source_file_name` and, when that is absent, for the
 * atom's own body — plenty of schemas keep a path in an ordinary field, and
 * this node populates `source_file_name` on nothing at all.
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
