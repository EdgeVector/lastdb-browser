# LastDB Browser

An interactive browser for a local LastDB node. Four columns, four levels:

```
schemas ──▶ keys ──▶ record ──▶ field
```

Select a schema to read its definition. Select a key to read the record's field values and metadata.
Select a field to show its value, its file, and its molecule address. This step sends no node request.
The footer shows each request, its latency, and its response size.

Each schema owns its record values. Canonical field reuse supplies definitions only.
Named alternate keys find the same records through fields declared in that schema.

## Run

```bash
npm install && npm start
```

Then open http://127.0.0.1:7666. `npm start` builds the UI and runs the bridge;
`npm run dev` runs Vite on :7667 against the bridge on :7666 for UI work.

| Variable | Default | Meaning |
|---|---|---|
| `LASTDB_SOCKET` | `~/.lastdb/data/folddb.sock` | Node's unix socket |
| `PORT` | `7666` | Bridge port |

## The four levels

**1 · Schemas.** Lists schemas that hold data, with their record counts, key
layout, and owning app. A node carries around a thousand seeded schema
definitions with nothing behind them, so empty ones are behind a toggle.
A node can return a null `record_count` (and a null `has_data`) when it cannot
count a schema. The list shows that schema with the count `?`; it does not hide it.

**2 · Keys.** Either *browse* — a cursor page from the node's keys-only list
route — or *keyed lookup*, a direct `HashKey` / `HashRangeKey` /
`HashRangePrefix` read. Browse resolves no field atoms and does not compute a
total census; lookup remains the node's O(1) / O(log M) access pattern.

**3 · Record.** One record, every field, with each field's value, type,
description, molecule address, and conflict flag.

**4 · Field.** The value of one field from the record read, its molecule address,
its version, and its conflict flag. The pane also shows files, as described below.
A format 7 node stores one record per key. A field reply has an empty `atom_uuid`,
and the node has no atom route and no atom history route (removed at API 15).
So this level reads nothing more from the node.

## Files

A field value can point at a file two ways, and the pane handles both.

A **filesystem path** gets *Open*, *Reveal in Finder*, and *Copy path*. The path
is checked against disk first, and the buttons appear only if it resolves. Paths
come out of the database, so they are treated as untrusted input: the bridge
uses `execFile` with an argument array rather than a shell, and refuses to
*open* anything the OS would execute — those are Reveal-only.

A **LastDB file blob** — a `$lastdb_file` envelope — is rendered as a file card
with its name, media type, and size. These live encrypted inside the database
rather than on disk, and the node currently exposes no read route for decrypted
bytes, so there is nothing to open yet; the descriptor is shown rather than a
button that would not work.

## Why there is a bridge

Browsers cannot open a unix socket, so `server.mjs` forwards to the node. It is
deliberately thin — it forwards, times, and caches exactly one call — and it is
read-only: every route maps to a `GET` or to the read-only `POST /api/query`,
with no path to `/api/mutation`.

## What each level costs

| Level | Node call | Notes |
|---|---|---|
| Schemas | `GET /api/schemas?include_counts=true` | Slow (it counts every schema); cached to disk. The only cached read. |
| Schema shape | `GET /api/schema/{name}` | Field types, descriptions, per-field molecule UUIDs. |
| Keys — browse | `GET /api/list?schema=…&limit=…&cursor=…` | Keys only, cursor-paged, no bodies or scan header. |
| Keys — lookup | `POST /api/query`, key-restricted | O(1) / O(log M). No scan header. |
| Record | `POST /api/query`, keyed, all fields | The first read that asks for full width, on one row. |
| Field | none | The value and metadata come from the record read. |

## Browse pagination

Browse follows the opaque `next_cursor` returned by `/api/list`; it never turns
that cursor into an offset and never asks the node for a complete count. The UI
keeps the cursors it has already visited so Back is local, while Forward sends
the exact cursor issued by the node. Deleting a record removes its identity from
the next refreshed list page. Clicking any listed key still performs the normal
point/range query to hydrate that record.

## Layout

```
server.mjs         bridge: socket forwarding, schema-catalog cache, file access, static serving
src/api.js         one function per drill-down step; the hydration policy lives here
src/useAsync.js    load-on-open with a stale-response guard
src/components/    SchemaList · KeyList · RecordPane · AtomPane · RequestLog
```

The tests are deleted (Tom, 2026-10-09). The gate (`.lastgit/ci.sh`) runs `npm ci`, the build, syntax checks and source checks.
