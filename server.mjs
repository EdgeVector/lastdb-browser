#!/usr/bin/env node
// LastDB Browser — HTTP bridge.
//
// Browsers cannot speak to a unix socket, so this process is the thin read-only
// bridge between the React UI and the node's v1 App API (`POST /v1/x/databases`
// and `POST /v1/read`). There is no route to `/v1/write` or any mutation path.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOCKET =
  process.env.LASTDB_SOCKET ||
  process.env.LASTDB_SOCKET_PATH ||
  path.join(os.homedir(), '.lastdb/data/folddb.sock');
const APP_ID = process.env.LASTDB_APP || null;
const PORT = Number(process.env.LASTDB_BROWSER_PORT || process.env.PORT || 7666);
const HOST = '127.0.0.1';
const CLIENT_ID = 'lastdb-browser';
const DIST = path.join(__dirname, 'dist');

// ---------------------------------------------------------------------------
// node call
// ---------------------------------------------------------------------------

/**
 * One request to the LastDB node over the unix socket.
 *
 * Works on both the owner socket (`folddb.sock`) and the app socket
 * (`apps.sock`, where `LASTDB_APP` supplies `X-LastDB-App`).
 */
function callNode({ method = 'POST', target, body = null }) {
  return new Promise((resolve, reject) => {
    const headers = { 'X-LastDB-Client': CLIENT_ID, Accept: 'application/json' };
    if (APP_ID) headers['X-LastDB-App'] = APP_ID;
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
    req.setTimeout(60_000, () => req.destroy(new Error('node request timed out after 60s')));
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// source files
// ---------------------------------------------------------------------------
//
// Field values come out of the database and are treated as untrusted input:
// never interpolated into a shell, and checked against disk before offering
// Open or Reveal.

/** Extensions macOS would EXECUTE rather than display. */
const EXECUTABLE_SUFFIXES = [
  '.app', '.command', '.sh', '.bash', '.zsh', '.scpt', '.scptd', '.applescript',
  '.term', '.workflow', '.action', '.osax', '.pkg', '.mpkg', '.dmg', '.jar',
];

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
      openable: st.isFile() && !EXECUTABLE_SUFFIXES.includes(path.extname(resolved).toLowerCase()),
    };
  } catch {
    return { ok: true, exists: false, resolved, reason: 'no such file' };
  }
}

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

function formatNodeError(errObj, fallback) {
  if (!errObj) return fallback;
  if (typeof errObj === 'string') return errObj;
  if (typeof errObj === 'object') {
    const msg = errObj.message || fallback;
    return errObj.code ? `${msg} (${errObj.code})` : msg;
  }
  return fallback;
}

function relay(res, nodeRes, meta = {}) {
  const text = nodeRes.raw.toString('utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain-text answer */
  }
  const envelope = {
    ok: nodeRes.status >= 200 && nodeRes.status < 300 && parsed?.ok !== false && !parsed?.error,
    status: nodeRes.status,
    ms: nodeRes.ms,
    bytes: nodeRes.raw.length,
    ...meta,
  };
  if (parsed !== null) envelope.data = parsed;
  else envelope.error = text.trim() || `node returned ${nodeRes.status}`;
  if (!envelope.ok && parsed !== null) {
    envelope.error = formatNodeError(parsed.error, parsed.message || text.trim());
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

const ALLOWED_READ_KEYS = new Set([
  'database',
  'schema',
  'keys_only',
  'limit',
  'cursor',
  'key',
  'range',
  'via',
]);

function sanitizeReadItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('read body must be a JSON object');
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_READ_KEYS.has(k)) {
      throw new Error(`unsupported read field: ${k}`);
    }
    if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  if (typeof out.schema !== 'string' || !out.schema.trim()) {
    throw new Error('schema is required');
  }
  return out;
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
    // --- bridge & node health ----------------------------------------------
    if (p === '/db/health') {
      const socketExists = fs.existsSync(SOCKET);
      let nodeOk = false;
      let nodeMs = null;
      if (socketExists) {
        try {
          const probe = await callNode({
            method: 'POST',
            target: '/v1/x/databases',
            body: { action: 'list' },
          });
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
      });
      return;
    }

    // --- Level 1: databases on the node ------------------------------------
    if (p === '/db/databases' && req.method === 'GET') {
      const nodeRes = await callNode({
        method: 'POST',
        target: '/v1/x/databases',
        body: { action: 'list' },
      });
      relay(res, nodeRes);
      return;
    }

    // --- Level 2: schemas on one database ----------------------------------
    if (p === '/db/schemas' && req.method === 'GET') {
      const database = url.searchParams.get('database');
      const db = database && database.trim() ? database.trim() : null;
      const body = { action: 'schemas', include_full: true };
      if (db) body.database = db;
      const nodeRes = await callNode({
        method: 'POST',
        target: '/v1/x/databases',
        body,
      });
      if (nodeRes.status < 200 || nodeRes.status >= 300) {
        relay(res, nodeRes, { database: db });
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(nodeRes.raw.toString('utf8'));
      } catch {
        relay(res, nodeRes, { database: db });
        return;
      }
      if (!parsed || parsed.ok === false || parsed.error || !Array.isArray(parsed.schemas)) {
        relay(res, nodeRes, { database: db });
        return;
      }

      // Probe 1 key per schema in batches of 64 (`reads_per_request` cap) so the
      // UI can hide registered schemas that currently hold zero keys in O(1) per
      // schema (~10-15ms total) without counting records.
      const BATCH_SIZE = 64;
      const schemas = parsed.schemas.map((s) => ({ ...s }));
      let totalMs = nodeRes.ms;
      let totalBytes = nodeRes.raw.length;
      for (let i = 0; i < schemas.length; i += BATCH_SIZE) {
        const slice = schemas.slice(i, i + BATCH_SIZE);
        const probeRes = await callNode({
          method: 'POST',
          target: '/v1/read',
          body: {
            reads: slice.map((s) => ({
              ...(db ? { database: db } : {}),
              schema: s.name,
              keys_only: true,
              limit: 1,
            })),
          },
        });
        totalMs += probeRes.ms;
        totalBytes += probeRes.raw.length;
        if (probeRes.status >= 200 && probeRes.status < 300) {
          try {
            const probeJson = JSON.parse(probeRes.raw.toString('utf8'));
            const results = probeJson?.results ?? [];
            slice.forEach((s, idx) => {
              const item = results[idx];
              if (item && Array.isArray(item.keys)) {
                s.has_data = item.keys.length > 0;
              }
            });
          } catch {
            /* keep has_data as null if probe JSON cannot be parsed */
          }
        }
      }

      sendJson(res, 200, {
        ok: true,
        status: nodeRes.status,
        ms: totalMs,
        bytes: totalBytes,
        database: db,
        data: {
          ...parsed,
          schemas,
        },
      });
      return;
    }

    // --- Levels 3 & 4: keys and records via POST /v1/read ------------------
    if (p === '/db/read' && req.method === 'POST') {
      const rawBody = await readBody(req);
      let parsedBody;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        sendJson(res, 200, { ok: false, status: 400, error: 'invalid JSON body' });
        return;
      }
      let item;
      try {
        item = sanitizeReadItem(parsedBody);
      } catch (err) {
        sendJson(res, 200, { ok: false, status: 400, error: err.message });
        return;
      }
      const nodeRes = await callNode({
        method: 'POST',
        target: '/v1/read',
        body: { reads: [item] },
      });
      const text = nodeRes.raw.toString('utf8');
      let nodeJson = null;
      try {
        nodeJson = JSON.parse(text);
      } catch {
        /* plain-text refusal */
      }
      if (nodeRes.status < 200 || nodeRes.status >= 300 || !nodeJson) {
        relay(res, nodeRes);
        return;
      }
      const first = nodeJson.results?.[0];
      if (!first) {
        sendJson(res, 200, {
          ok: false,
          status: 500,
          ms: nodeRes.ms,
          bytes: nodeRes.raw.length,
          error: 'node /v1/read reply had no result item',
        });
        return;
      }
      if (first.error) {
        sendJson(res, 200, {
          ok: false,
          status: 400,
          ms: nodeRes.ms,
          bytes: nodeRes.raw.length,
          error: formatNodeError(first.error, 'read failed'),
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        status: nodeRes.status,
        ms: nodeRes.ms,
        bytes: nodeRes.raw.length,
        data: first,
      });
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
