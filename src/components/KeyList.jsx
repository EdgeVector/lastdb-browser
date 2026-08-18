import React, { useEffect, useState } from 'react';
import * as api from '../api.js';
import { useAsync } from '../useAsync.js';

const PAGE_SIZES = [25, 50, 100, 250];

/**
 * Level 2 — the keys in one schema.
 *
 * Two ways in, and the difference matters enough to show it in the UI:
 *
 *  · BROWSE is a cursor page from the node's keys-only `/api/list` route. It
 *    does not hydrate field atoms, compute a census, or carry a scan header.
 *
 *  · LOOKUP is the node's real access pattern — HashKey for a partition,
 *    HashRangeKey for a record, HashRangePrefix for a slice of one partition.
 *    O(1) / O(log M), no scan header, fast on schemas where browse is not.
 *
 * LOOKUP projects one field so the node can return a keyed row envelope. Browse
 * needs no field projection because `/api/list` returns identities directly.
 */
export default function KeyList({ schema, selectedKey, onSelect }) {
  const [limit, setLimit] = useState(50);
  const [browsePage, setBrowsePage] = useState({ cursor: null, start: 0 });
  const [browseHistory, setBrowseHistory] = useState([]);
  const [mode, setMode] = useState('browse'); // 'browse' | 'lookup'
  const [hashInput, setHashInput] = useState('');
  const [rangeInput, setRangeInput] = useState('');
  const [lookup, setLookup] = useState(null); // committed lookup filter

  const hashField = schema?.key?.hash_field;
  const rangeField = schema?.key?.range_field;
  const isHashRange = Boolean(rangeField);
  const candidates = api.projectionCandidates(schema);

  // Reset paging, lookup, and the chosen projection when the schema changes.
  useEffect(() => {
    setBrowsePage({ cursor: null, start: 0 });
    setBrowseHistory([]);
    setMode('browse');
    setHashInput('');
    setRangeInput('');
    setLookup(null);
  }, [schema?.name]);

  const result = useAsync(
    !schema
      ? null
      : mode === 'lookup'
        ? candidates.length === 0
          ? null
          : lookup
          ? () =>
              api.keyLookup(schema.name, [candidates[0]], lookup).then((data) => ({ data }))
          : null
        : () => api.keyList(schema.name, { cursor: browsePage.cursor, limit }).then((data) => ({ data })),
    [schema?.name, mode, browsePage.cursor, limit, JSON.stringify(lookup)],
  );

  const { loading, error } = result;
  const data = result.data?.data ?? null;
  const rows = mode === 'browse' ? (data?.keys ?? []) : (data?.results ?? []);

  function previousBrowsePage() {
    if (browseHistory.length === 0) return;
    setBrowsePage(browseHistory[browseHistory.length - 1]);
    setBrowseHistory((history) => history.slice(0, -1));
  }

  function nextBrowsePage() {
    if (!data?.next_cursor) return;
    setBrowseHistory((history) => [...history, browsePage]);
    setBrowsePage({ cursor: data.next_cursor, start: browsePage.start + rows.length });
  }

  function runLookup(e) {
    e.preventDefault();
    const hash = hashInput.trim();
    if (!hash) return;
    const range = rangeInput.trim();
    if (isHashRange && range) {
      setLookup({ HashRangeKey: { hash, range } });
    } else if (isHashRange && !range) {
      setLookup({ HashKey: hash });
    } else {
      setLookup({ HashKey: hash });
    }
  }

  function runPrefix() {
    const hash = hashInput.trim();
    const prefix = rangeInput.trim();
    if (!hash) return;
    setLookup({ HashRangePrefix: { hash, prefix } });
  }

  if (!schema) {
    return (
      <div className="col col-keys">
        <div className="col-head">
          <div className="col-title">2 · Keys</div>
        </div>
        <div className="empty">Pick a schema to list its keys.</div>
      </div>
    );
  }

  return (
    <div className="col col-keys">
      <div className="col-head">
        <div className="col-title">
          <span>2 · Keys</span>
          {loading && <span className="spin" />}
        </div>
        <div className="toolbar">
          <button
            onClick={() => setMode('browse')}
            style={mode === 'browse' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            browse
          </button>
          <button
            onClick={() => setMode('lookup')}
            style={mode === 'lookup' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            keyed lookup
          </button>
        </div>

        {mode === 'lookup' && (
          <form onSubmit={runLookup} style={{ marginTop: 6, display: 'grid', gap: 5 }}>
            <input
              placeholder={`${hashField} (hash)…`}
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value)}
            />
            {isHashRange && (
              <input
                placeholder={`${rangeField} (range, or prefix)…`}
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
              />
            )}
            <div className="toolbar" style={{ marginTop: 0 }}>
              <button type="submit">
                {isHashRange && rangeInput.trim() ? 'HashRangeKey' : 'HashKey'}
              </button>
              {isHashRange && (
                <button type="button" onClick={runPrefix}>
                  HashRangePrefix
                </button>
              )}
            </div>
            <div className="note">Keyed read — no scan, O(1) / O(log M).</div>
          </form>
        )}

        {mode === 'browse' && (
          <div className="note" style={{ marginTop: 6 }}>
            Cursor page via <code>GET /api/list</code> · keys only · no scan
          </div>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      <div className="col-body">
        {mode === 'lookup' && !lookup && !error && (
          <div className="empty">
            Enter a {hashField} value to read one partition directly.
          </div>
        )}
        {!loading && !error && rows.length === 0 && (mode === 'browse' || lookup) && (
          <div className="empty">
            No rows.
          </div>
        )}
        {rows.map((r, i) => {
          const k = r.key || {};
          const isSel =
            selectedKey && selectedKey.hash === k.hash && (selectedKey.range ?? null) === (k.range ?? null);
          return (
            <button
              key={`${k.hash}|${k.range ?? ''}|${i}`}
              className={`row${isSel ? ' sel' : ''}`}
              onClick={() => onSelect({ hash: k.hash, range: k.range ?? null })}
            >
              <div className="row-main">
                <span className="row-name">{k.hash}</span>
              </div>
              {k.range != null && <div className="row-sub">↳ {k.range}</div>}
            </button>
          );
        })}
      </div>

      <div className="pager">
        {mode === 'browse' ? (
          <>
            <button onClick={previousBrowsePage} disabled={browseHistory.length === 0 || loading}>
              ←
            </button>
            <button onClick={nextBrowsePage} disabled={!data?.has_more || !data?.next_cursor || loading}>
              →
            </button>
            <span title="The list route is cursor-paged and deliberately does not compute a total census">
              {rows.length ? `${browsePage.start + 1}–${browsePage.start + rows.length}` : '0'}
            </span>
            <span style={{ flex: 1 }} />
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setBrowsePage({ cursor: null, start: 0 });
                setBrowseHistory([]);
              }}
              style={{ background: 'var(--bg-raised)', color: 'inherit', border: '1px solid var(--border-strong)', borderRadius: 4 }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}/page
                </option>
              ))}
            </select>
          </>
        ) : (
          <span>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        )}
      </div>
    </div>
  );
}
