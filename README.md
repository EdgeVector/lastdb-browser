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

**2 · Keys.** Either *browse* — a bounded page of keys — or *keyed lookup*, a
direct `HashKey` / `HashRangeKey` / `HashRangePrefix` read. Lookup is the
node's supported access pattern and is typically an order of magnitude faster
than the paged scan.

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
| Keys — browse | `POST /api/query` with a `Page` filter | Bounded window plus a count. Sends the admin full-scan header. |
| Keys — lookup | `POST /api/query`, key-restricted | O(1) / O(log M). No scan header. |
| Record | `POST /api/query`, keyed, all fields | The first read that asks for full width, on one row. |
| Atom | `GET /api/atom/{uuid}` | The address comes from the record's field metadata, so this is a fetch, not a search. |

## The "list by" picker

Browsing a schema means listing its keys, and on LastDB that requires choosing a
field to project. The choice is not cosmetic:

- **A row is listed only if the projected field resolves to an atom on it.** A
  field that is empty across the schema lists nothing, and the widest possible
  projection is therefore the one most likely to come back empty.
- **Only the hash key field yields addressable keys.** Project anything else and
  the node returns the encoded partition token instead of the plaintext hash.
  Those keys cannot be read back, so records opened from such a listing resolve
  to nothing.
- **The reported count follows the projection**, so it is a count for the field
  in use rather than a census of the table.

So the browser projects the hash key field first, falls back only when that
field has no keys at all, warns when it has had to fall back, and labels the
count with the field it counted by. The picker lets you override it.

Two consequences worth knowing while browsing: an empty page does not mean an
empty field — a page windows over all keys and drops deleted ones afterwards,
so a window can land entirely on deleted rows while live rows sit further in —
and a record that will not open is usually a key from a non-hash-field listing
rather than missing data.

## Layout

```
server.mjs         bridge: socket forwarding, schema-catalog cache, file access, static serving
src/api.js         one function per drill-down step; the hydration policy lives here
src/useAsync.js    load-on-open with a stale-response guard
src/components/    SchemaList · KeyList · RecordPane · AtomPane · RequestLog
```
