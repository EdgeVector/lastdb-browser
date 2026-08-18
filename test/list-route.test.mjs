import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { keyList, keyLookup } from '../src/api.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('keyList follows the opaque cursor through the bridge', async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return {
      async json() {
        return {
          ok: true,
          data: {
            list: {
              keys: [{ hash: 'alpha', range: null }],
              has_more: true,
              next_cursor: 'opaque/+ cursor',
            },
          },
        };
      },
    };
  };

  try {
    const page = await keyList('App/Rows', { limit: 2, cursor: 'prior/+ cursor' });
    assert.deepEqual(page.keys, [{ hash: 'alpha', range: null }]);
    assert.equal(page.next_cursor, 'opaque/+ cursor');
    assert.equal(
      request.url,
      '/db/list?schema=App%2FRows&limit=2&cursor=prior%2F%2B+cursor',
    );
    assert.equal(request.init, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keyed lookup remains a POST query without scan opt-in', async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return {
      async json() {
        return { ok: true, data: { results: [] } };
      },
    };
  };

  try {
    await keyLookup('Rows', ['id'], { HashKey: 'alpha' });
    assert.equal(request.url, '/db/query');
    assert.equal(request.init.method, 'POST');
    assert.deepEqual(JSON.parse(request.init.body), {
      schema_name: 'Rows',
      fields: ['id'],
      filter: { HashKey: 'alpha' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bridge proxies list and never grants full-scan capability', async (t) => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lastdb-browser-list-'));
  const socketPath = path.join(tmp, 'lastdb.sock');
  const nodeRequests = [];

  const fakeNode = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    nodeRequests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });

    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/list?')) {
      res.end(JSON.stringify({
        list: {
          keys: [{ hash: 'alpha', range: null }, { hash: 'gamma', range: null }],
          has_more: true,
          truncated: true,
          next_cursor: 'next/opaque',
        },
      }));
      return;
    }

    const body = JSON.parse(nodeRequests.at(-1).body || '{}');
    if (!body.filter) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'full_schema_scan_not_allowed' }));
      return;
    }
    res.end(JSON.stringify({ results: [{ key: { hash: 'alpha', range: null } }] }));
  });
  await new Promise((resolve, reject) => {
    fakeNode.once('error', reject);
    fakeNode.listen(socketPath, resolve);
  });

  const port = await availablePort();
  const bridge = spawn(process.execPath, ['server.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, LASTDB_SOCKET: socketPath, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    if (bridge.exitCode == null) bridge.kill('SIGTERM');
    await new Promise((resolve) => fakeNode.close(resolve));
  });
  await waitForBridge(bridge);

  const listEnvelope = await fetch(
    `http://127.0.0.1:${port}/db/list?schema=Rows&limit=2&cursor=before%2Fopaque`,
  ).then((res) => res.json());
  assert.deepEqual(listEnvelope.data.list.keys.map((key) => key.hash), ['alpha', 'gamma']);
  assert.equal(listEnvelope.data.list.next_cursor, 'next/opaque');
  assert.equal(nodeRequests[0].method, 'GET');
  assert.equal(
    nodeRequests[0].url,
    '/api/list?schema=Rows&limit=2&cursor=before%2Fopaque',
  );
  assert.equal(nodeRequests[0].headers['x-lastdb-allow-full-scan'], undefined);

  const refused = await fetch(`http://127.0.0.1:${port}/db/query?scan=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema_name: 'Rows', fields: ['id'] }),
  }).then((res) => res.json());
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'full_schema_scan_not_allowed');
  assert.equal(nodeRequests[1].url, '/api/query');
  assert.equal(nodeRequests[1].headers['x-lastdb-allow-full-scan'], undefined);

  const lookup = await fetch(`http://127.0.0.1:${port}/db/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema_name: 'Rows',
      fields: ['id'],
      filter: { HashKey: 'alpha' },
    }),
  }).then((res) => res.json());
  assert.equal(lookup.ok, true);
  assert.equal(lookup.data.results[0].key.hash, 'alpha');
  assert.equal(nodeRequests[2].headers['x-lastdb-allow-full-scan'], undefined);
});

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForBridge(child) {
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`bridge did not start: ${stderr}`)),
      5_000,
    );
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`bridge exited ${code}: ${stderr}`));
    };
    const onData = (chunk) => {
      if (!chunk.toString('utf8').includes('LastDB Browser bridge on')) return;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.stdout.off('data', onData);
      resolve();
    };
    child.once('exit', onExit);
    child.stdout.on('data', onData);
  });
}
