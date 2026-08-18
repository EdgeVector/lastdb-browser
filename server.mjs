#!/usr/bin/env node
// LastDB Browser — HTTP bridge.
//
// Browsers cannot speak to a unix socket, so this process is the only thing
// standing between the React app and the node's data plane. It is deliberately
// thin: it does not interpret payloads, invent queries, or retry. It forwards,
// times, and caches the one call that is genuinely expensive.
//
// Read-only by construction: every route below maps to a GET, or to the
// read-only POST /api/query. Browse uses keys-only GET /api/list. There is no
// path from this bridge to /api/mutation.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOCKET =
  process.env.LASTDB_SOCKET || path.join(os.homedir(), '.lastdb/data/folddb.sock');
const PORT = Number(process.env.PORT || 7666);
const HOST = '127.0.0.1';
const CLIENT_ID = 'lastdb-browser';
const CACHE_FILE = path.join(__dirname, '.cache', 'schemas.json');
const DIST = path.join(__dirname, 'dist');

// ---------------------------------------------------------------------------
// node call
// ---------------------------------------------------------------------------

/**
 * One request to the LastDB node over the unix socket.
 *
 * The bridge never sends X-LastDB-Allow-Full-Scan. Browse has a dedicated
 * keys-only route, and unfiltered queries must keep failing closed.
 */
function callNode({ method = 'GET', target, body = null }) {
  return new Promise((resolve, reject) => {
    const headers = { 'X-LastDB-Client': CLIENT_ID, Accept: 'application/json' };
    let payload = null;
    if (body != null) {
      payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }

    const started = Date.now();
    const req = http.request({ socketPath: SOCKET, path: target, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          raw,
          ms: Date.now() - started,
          contentType: res.headers['content-type'] || '',
        });
      });
    });
    req.on('error', reject);
    // The node sheds under load rather than hanging, but a wedged socket should
    // surface as an error in the UI instead of a spinner that never resolves.
    req.setTimeout(180_000, () => req.destroy(new Error('node request timed out after 180s')));
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// schema catalog cache
// ---------------------------------------------------------------------------
//
// GET /api/schemas?include_counts=true walks every schema's key set to decide
// has_data, and takes ~30s on a real node. That is the one call worth caching:
// it is the app's entry screen, and its answer changes only when schemas gain
// or lose data. Everything downstream is lazy and uncached.

let catalog = null; // { fetched_at, ms, count, schemas: [...] }
let catalogInFlight = null;

async function loadCatalogFromDisk() {
  try {
    const text = await fsp.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.schemas)) return parsed;
  } catch {
    /* no cache yet */
  }
  return null;
}

async function saveCatalogToDisk(value) {
  try {
    await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fsp.writeFile(CACHE_FILE, JSON.stringify(value));
  } catch (err) {
    console.warn(`[bridge] could not persist schema cache: ${err.message}`);
  }
}

async function fetchCatalog() {
  const res = await callNode({ target: '/api/schemas?include_counts=true' });
  if (res.status !== 200) {
    throw new Error(`node returned ${res.status}: ${res.raw.toString('utf8').slice(0, 300)}`);
  }
  const parsed = JSON.parse(res.raw.toString('utf8'));
  const value = {
    fetched_at: new Date().toISOString(),
    ms: res.ms,
    count: parsed.count,
    counts_included: parsed.counts_included === true,
    schemas: parsed.schemas || [],
  };
  await saveCatalogToDisk(value);
  return value;
}

async function getCatalog({ refresh = false } = {}) {
  if (!refresh && catalog) return catalog;
  if (!refresh) {
    const disk = await loadCatalogFromDisk();
    if (disk) {
      catalog = disk;
      return catalog;
    }
  }
  // Collapse concurrent refreshes: three tabs must not each cost 30s of node time.
  if (catalogInFlight) return catalogInFlight;
  catalogInFlight = fetchCatalog()
    .then((value) => {
      catalog = value;
      return value;
    })
    .finally(() => {
      catalogInFlight = null;
    });
  return catalogInFlight;
}

// ---------------------------------------------------------------------------
// source files
// ---------------------------------------------------------------------------
//
// An atom can name the file it came from (`source_file_name`), and plenty of
// schemas keep a path in an ordinary field. Either way the value is DATA read
// out of the database, so it is treated as untrusted for the whole of this
// section: it is never interpolated into a shell, and it is checked against the
// filesystem before the UI is told it is openable.

/** Extensions macOS would EXECUTE rather than display. */
const EXECUTABLE_SUFFIXES = [
  '.app', '.command', '.sh', '.bash', '.zsh', '.scpt', '.scptd', '.applescript',
  '.term', '.workflow', '.action', '.osax', '.pkg', '.mpkg', '.dmg', '.jar',
];

/** A value that could plausibly be a path worth probing. */
function pathLike(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /[\n\r\0]/.test(trimmed)) return null;
  if (!trimmed.startsWith('/') && !trimmed.startsWith('~/') && !trimmed.startsWith('file://')) {
    return null;
  }
  return trimmed;
}

function resolveSourcePath(raw) {
  const candidate = pathLike(raw);
  if (!candidate) return null;
  let out = candidate;
  if (out.startsWith('file://')) {
    try {
      out = fileURLToPath(out);
    } catch {
      return null;
    }
  }
  if (out.startsWith('~/')) out = path.join(os.homedir(), out.slice(2));
  return path.resolve(out);
}

async function statSourceFile(raw) {
  const resolved = resolveSourcePath(raw);
  if (!resolved) return { ok: true, exists: false, reason: 'not a path' };
  try {
    const st = await fsp.stat(resolved);
    return {
      ok: true,
      exists: true,
      resolved,
      is_file: st.isFile(),
      is_dir: st.isDirectory(),
      size: st.size,
      // Reveal is always offered; open is withheld for things the OS would run.
      openable: st.isFile() && !EXECUTABLE_SUFFIXES.includes(path.extname(resolved).toLowerCase()),
    };
  } catch {
    return { ok: true, exists: false, resolved, reason: 'no such file' };
  }
}

/**
 * Hand a path to the OS: `reveal` selects it in Finder, otherwise it opens in
 * the default application.
 *
 * `execFile` with an argv array — never `exec`, never a template string — so a
 * path containing shell metacharacters is one argument rather than a command.
 * Opening is additionally refused for suffixes macOS would execute, because
 * "open the file this row came from" should never be able to launch something;
 * revealing stays available for those, since it only highlights the file.
 */
async function openSourceFile(raw, reveal) {
  const info = await statSourceFile(raw);
  if (!info.exists) return { ok: false, error: info.reason || 'no such file' };
  if (!reveal && !info.openable) {
    return {
      ok: false,
      error: 'refusing to open an executable bundle — use Reveal instead',
    };
  }
  if (process.platform !== 'darwin') {
    return { ok: false, error: `opening files is macOS-only (platform: ${process.platform})` };
  }
  const args = reveal ? ['-R', info.resolved] : [info.resolved];
  return new Promise((resolve) => {
    execFile('open', args, (err) => {
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true, resolved: info.resolved, revealed: reveal === true });
    });
  });
}

// ---------------------------------------------------------------------------
// http plumbing
// ---------------------------------------------------------------------------

function sendJson(res, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

/**
 * Pass a node response through untouched, but always as JSON the UI can render.
 * The node answers some failures in plain text ("Not Found",
 * "full_schema_scan_not_allowed: ..."), so a blind JSON.parse in the client
 * would turn a useful message into a parse error.
 */
function relay(res, nodeRes, meta = {}) {
  const text = nodeRes.raw.toString('utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain-text answer */
  }
  const envelope = {
    ok: nodeRes.status >= 200 && nodeRes.status < 300 && parsed?.ok !== false,
    status: nodeRes.status,
    ms: nodeRes.ms,
    bytes: nodeRes.raw.length,
    ...meta,
  };
  if (parsed !== null) envelope.data = parsed;
  else envelope.error = text.trim() || `node returned ${nodeRes.status}`;
  if (envelope.status >= 400 && parsed !== null) {
    envelope.error = parsed.error || parsed.message || text.trim();
  }
  sendJson(res, 200, envelope);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    sendJson(res, 503, {
      ok: false,
      error: 'UI not built. Run `npm run build`, or use `npm run dev` for the Vite dev server.',
    });
    return;
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.join(DIST, rel);
  // Contain path traversal, then fall back to the SPA entry for client routes.
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  const body = await fsp.readFile(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': body.length,
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    // --- bridge status -----------------------------------------------------
    if (p === '/db/health') {
      const socketExists = fs.existsSync(SOCKET);
      let nodeOk = false;
      let nodeMs = null;
      if (socketExists) {
        try {
          // A single cheap schema read doubles as a liveness probe. Deliberately
          // not /api/db/inventory, which walks storage and can hang for minutes.
          const probe = await callNode({ target: '/api/schemas' });
          nodeOk = probe.status === 200;
          nodeMs = probe.ms;
        } catch {
          nodeOk = false;
        }
      }
      sendJson(res, 200, {
        ok: nodeOk,
        socket: SOCKET,
        socket_exists: socketExists,
        node_ms: nodeMs,
        catalog_cached: Boolean(catalog),
        catalog_fetched_at: catalog?.fetched_at ?? null,
      });
      return;
    }

    // --- schema catalog (cached) -------------------------------------------
    if (p === '/db/schemas') {
      const refresh = url.searchParams.get('refresh') === '1';
      const wasCached = Boolean(catalog) && !refresh;
      const started = Date.now();
      const value = await getCatalog({ refresh });
      const payload = {
        ...value,
        ok: true,
        // What this request cost, not what the original node count cost —
        // spreading `value` last would report the cached 60s on every hit.
        ms: Date.now() - started,
        node_ms: value.ms,
        served_from: wasCached ? 'cache' : 'node',
      };
      payload.bytes = Buffer.byteLength(JSON.stringify(payload));
      sendJson(res, 200, payload);
      return;
    }

    // --- one schema's shape (fields, types, per-field molecule uuids) -------
    if (p.startsWith('/db/schema/')) {
      const name = decodeURIComponent(p.slice('/db/schema/'.length));
      // The node matches the schema name as a single path segment, so a name
      // containing '/' (app-namespaced schemas) must stay percent-encoded.
      const nodeRes = await callNode({
        target: `/api/schema/${encodeURIComponent(name)}`,
      });
      relay(res, nodeRes, { schema: name });
      return;
    }

    // --- keys-only cursor page --------------------------------------------
    if (p === '/db/list') {
      const qs = new URLSearchParams();
      for (const name of ['schema', 'limit', 'cursor']) {
        const value = url.searchParams.get(name);
        if (value != null && value !== '') qs.set(name, value);
      }
      const nodeRes = await callNode({ target: `/api/list?${qs}` });
      relay(res, nodeRes);
      return;
    }

    // --- keyed query -------------------------------------------------------
    if (p === '/db/query' && req.method === 'POST') {
      const body = await readBody(req);
      const nodeRes = await callNode({
        method: 'POST',
        target: '/api/query',
        body,
      });
      relay(res, nodeRes);
      return;
    }

    // --- atom content ------------------------------------------------------
    if (p.startsWith('/db/atom/')) {
      const uuid = decodeURIComponent(p.slice('/db/atom/'.length));
      const nodeRes = await callNode({ target: `/api/atom/${encodeURIComponent(uuid)}` });
      relay(res, nodeRes, { atom_uuid: uuid });
      return;
    }

    // --- molecule history, scoped to one key -------------------------------
    if (p.startsWith('/db/history/')) {
      const uuid = decodeURIComponent(p.slice('/db/history/'.length));
      const qs = new URLSearchParams();
      // A molecule is per-FIELD and shared by every key in the schema, so an
      // unscoped history read is meaningless here; hash/range narrow it to the
      // record the user is actually looking at.
      const hash = url.searchParams.get('hash');
      const range = url.searchParams.get('range');
      if (hash != null) qs.set('hash', hash);
      if (range != null && range !== '') qs.set('range', range);
      const suffix = qs.toString() ? `?${qs}` : '';
      const nodeRes = await callNode({
        target: `/api/history/${encodeURIComponent(uuid)}${suffix}`,
      });
      relay(res, nodeRes, { molecule_uuid: uuid });
      return;
    }

    // --- protein binding for a molecule ------------------------------------
    if (p.startsWith('/db/protein/of-molecule/')) {
      const uuid = decodeURIComponent(p.slice('/db/protein/of-molecule/'.length));
      const nodeRes = await callNode({
        target: `/api/protein/of-molecule/${encodeURIComponent(uuid)}`,
      });
      relay(res, nodeRes, { molecule_uuid: uuid });
      return;
    }

    // --- source file: does this path exist on disk? ------------------------
    if (p === '/db/file') {
      sendJson(res, 200, await statSourceFile(url.searchParams.get('path')));
      return;
    }

    // --- source file: hand it to the OS ------------------------------------
    if (p === '/db/file/open' && req.method === 'POST') {
      const body = await readBody(req);
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        sendJson(res, 200, { ok: false, error: 'invalid body' });
        return;
      }
      sendJson(res, 200, await openSourceFile(parsed.path, parsed.reveal === true));
      return;
    }

    if (p.startsWith('/db/')) {
      sendJson(res, 404, { ok: false, error: `no bridge route for ${p}` });
      return;
    }

    await serveStatic(req, res, p);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] LastDB Browser bridge on http://${HOST}:${PORT}`);
  console.log(`[bridge] socket: ${SOCKET}`);
  if (!fs.existsSync(SOCKET)) {
    console.warn('[bridge] WARNING: socket not found — is the LastDB node running?');
  }
});
