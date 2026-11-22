# LastDB Browser

An interactive read-only browser for a local LastDB node. Five columns, five levels:

```
databases ──▶ schemas ──▶ keys ──▶ record ──▶ field
```

1. Select a database on the node to load its schemas.
2. Select a schema to inspect its definition and list its keys.
3. Select a key (via cursor-paged browse or keyed lookup, including named alternate keys) to read its record.
4. Inspect the record's metadata (`revision`, `created_by`, `updated_by`, `file`) and field values.
5. Click any field to view its pretty-printed content, field hash, and local file actions without another node request.

The footer logs every node request with its latency and response size.

## Run

```bash
npm install && npm start
```

Then open http://127.0.0.1:7666. `npm start` builds the UI and runs the bridge;
`npm run dev` runs Vite on :7667 against the bridge on :7666 for UI work.

| Variable | Default | Meaning |
|---|---|---|
| `LASTDB_SOCKET` | `$LASTDB_SOCKET_PATH` or `~/.lastdb/data/folddb.sock` | Node unix socket |
| `LASTDB_APP` | unset | App ID sent as `X-LastDB-App` on the app socket |
| `LASTDB_BROWSER_PORT` / `PORT` | `7666` | Bridge port |

## Node API calls

Every read uses the LastDB v1 App API (`POST /v1/x/databases` and `POST /v1/read`), with no path to `/v1/write`:

| Level | Node call | Notes |
|---|---|---|
| 1 · Databases | `POST /v1/x/databases` `{ action: "list" }` | Personal, owned, and received shared databases on the node. |
| 2 · Schemas | `POST /v1/x/databases` `{ action: "schemas", database, include_full: true }` | All schemas on the selected database, including `record_keys`, field types, descriptions, and field hashes. |
| 3 · Keys (browse) | `POST /v1/read` `{ database, schema, keys_only: true, limit, cursor }` | Cursor-paged primary key identities; reads no field values. |
| 3 · Keys (lookup) | `POST /v1/read` `{ database, schema, key \| range, via? }` | Direct primary or alternate-key lookup (`ReadByKey` / `ReadByRange`). |
| 4 · Record | `POST /v1/read` `{ database, schema, key }` | Full record (`record`, `revision`, `created_by`, `updated_by`, `file`) for one primary key. |
| 5 · Field | none | Reuses the field value and schema metadata already loaded. |

## Files

A field value that resolves to an existing local path offers *Open*, *Reveal in Finder*, and *Copy path*. Paths come out of the database and are treated as untrusted input: the bridge uses `execFile` with an argument array rather than a shell, and refuses to open executable bundles (Reveal only).

## Layout

```
server.mjs         read-only HTTP-to-socket bridge (/v1/x/databases + /v1/read + safe file stat/open)
src/api.js         one function per drill-down step; the hydration policy lives here
src/useAsync.js    load-on-open with a stale-response guard
src/components/    DatabaseList · SchemaList · KeyList · RecordPane · FieldPane · RequestLog
```

The tests are deleted (Tom, 2026-10-09). The gate (`.lastgit/ci.sh`) runs `npm ci`, the build, syntax checks, and source checks.
