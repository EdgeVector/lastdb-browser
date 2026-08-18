# LastDB Browser

An interactive browser for a local LastDB node. Four columns, four levels:

```
schemas ──▶ keys ──▶ record ──▶ atom
```

Each level is a single node read, issued when you open that level and not
before. Opening a schema does not touch its rows; opening a row does not fetch
its atoms; an atom's history and protein binding sit behind their own buttons.
A footer logs every node request with its latency and response size, so the
hydration behaviour is something you can check rather than take on trust.

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

**2 · Keys.** Either *browse* — a cursor page from the node's keys-only list
route — or *keyed lookup*, a direct `HashKey` / `HashRangeKey` /
`HashRangePrefix` read. Browse resolves no field atoms and does not compute a
total census; lookup remains the node's O(1) / O(log M) access pattern.

**3 · Record.** One row, every field, with each field's value, type,
description, atom address, molecule address, and conflict flag.

**4 · Atom.** The atom body, its addresses, and its timestamps. History and
protein binding load on request. Files are surfaced here too — see below.

## Files

An atom can point at a file two ways, and the pane handles both.

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
| Atom | `GET /api/atom/{uuid}` | The address comes from the record's field metadata, so this is a fetch, not a search. |

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
