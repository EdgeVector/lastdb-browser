import React, { useState } from 'react';
import * as api from '../api.js';
import { useAsync } from '../useAsync.js';

const PAGE_SIZES = [25, 50, 100, 250];

/**
 * Level 3 — keys in the selected schema on the selected database.
 *
 *  · BROWSE pages primary keys via `POST /v1/read` (`keys_only: true`).
 *  · KEYED LOOKUP queries one key or range via `POST /v1/read` (`ReadByKey` /
 *    `ReadByRange`), using either the primary key or a named alternate key
 *    (`via`). Every returned record carries its primary `key`, so clicking any
 *    result opens that record in Level 4.
 */
export default function KeyList({ database, schema, selectedKey, onSelect }) {
  const [limit, setLimit] = useState(50);
  const [browsePage, setBrowsePage] = useState({ cursor: null, start: 0 });
  const [browseHistory, setBrowseHistory] = useState([]);
  const [mode, setMode] = useState('browse'); // 'browse' | 'lookup'
  const [via, setVia] = useState(''); // '' = primary, otherwise alternate key name
  const [hashInput, setHashInput] = useState('');
  const [rangeInput, setRangeInput] = useState('');
  const [lookup, setLookup] = useState(null);

  const primaryDef = schema?.record_keys?.primary ?? {
    kind: schema?.schema_type === 'HashRange' ? 'hash_range' : 'hash',
  };
  const alternates = schema?.record_keys?.alternates ?? {};
  const altNames = Object.keys(alternates);
  const activeKeyDef = via && alternates[via] ? alternates[via] : primaryDef;
  const isHashRange = activeKeyDef?.kind === 'hash_range';

  const result = useAsync(
    !database || !schema
      ? null
      : mode === 'lookup'
        ? lookup
          ? () => api.keyLookup(database.id, schema.name, lookup, { limit })
          : null
        : () => api.keyList(database.id, schema.name, { cursor: browsePage.cursor, limit }),
    [database?.id, schema?.name, mode, browsePage.cursor, limit, JSON.stringify(lookup)],
  );

  const { loading, error } = result;
  const data = result.data ?? null;
  const rows =
    mode === 'browse'
      ? (data?.keys ?? []).map((k) => ({ key: k }))
      : (data?.records ?? []);

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
    const viaPart = via ? { via } : {};
    if (isHashRange && range) {
      setLookup({ ...viaPart, key: { hash, range } });
    } else if (isHashRange && !range) {
      setLookup({ ...viaPart, range: { hash } });
    } else {
      setLookup({ ...viaPart, key: { hash } });
    }
  }

  function runPrefix() {
    const hash = hashInput.trim();
    const prefix = rangeInput.trim();
    if (!hash) return;
    const viaPart = via ? { via } : {};
    setLookup({ ...viaPart, range: prefix ? { hash, prefix } : { hash } });
  }

  if (!database || !schema) {
    return (
      <div className="col col-keys">
        <div className="col-head">
          <div className="col-title">3 · Keys</div>
        </div>
        <div className="empty">Pick a schema to list its keys.</div>
      </div>
    );
  }

  return (
    <div className="col col-keys">
      <div className="col-head">
        <div className="col-title">
          <span>3 · Keys</span>
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
            {altNames.length > 0 && (
              <select
                value={via}
                onChange={(e) => {
                  setVia(e.target.value);
                  setLookup(null);
                }}
                style={{
                  background: 'var(--bg)',
                  color: 'inherit',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 5,
                  padding: '4px 8px',
                  font: 'inherit',
                }}
              >
                <option value="">primary key ({primaryDef.kind})</option>
                {altNames.map((name) => (
                  <option key={name} value={name}>
                    via {name} ({alternates[name].kind})
                  </option>
                ))}
              </select>
            )}
            <input
              placeholder="hash coordinate…"
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value)}
            />
            {isHashRange && (
              <input
                placeholder={`range (${activeKeyDef.range_type || 'String'}, or prefix)…`}
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
              />
            )}
            <div className="toolbar" style={{ marginTop: 0 }}>
              <button type="submit">
                {isHashRange && rangeInput.trim()
                  ? 'Exact key'
                  : isHashRange
                    ? 'All under hash'
                    : 'Exact key'}
              </button>
              {isHashRange && (
                <button type="button" onClick={runPrefix}>
                  Range prefix
                </button>
              )}
            </div>
            <div className="note">Keyed read via <code>POST /v1/read</code>.</div>
          </form>
        )}

        {mode === 'browse' && (
          <div className="note" style={{ marginTop: 6 }}>
            Cursor page via <code>POST /v1/read</code> (<code>keys_only</code>)
          </div>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      <div className="col-body">
        {mode === 'lookup' && !lookup && !error && (
          <div className="empty">Enter a hash coordinate to look up keys directly.</div>
        )}
        {!loading && !error && rows.length === 0 && (mode === 'browse' || lookup) && (
          <div className="empty">No keys in this schema.</div>
        )}
        {rows.map((r, i) => {
          const k = r.key || {};
          const isSel =
            selectedKey &&
            selectedKey.hash === k.hash &&
            (selectedKey.range ?? null) === (k.range ?? null);
          return (
            <button
              key={`${k.hash ?? ''}|${k.range ?? ''}|${i}`}
              className={`row${isSel ? ' sel' : ''}`}
              onClick={() => onSelect({ hash: k.hash ?? '', range: k.range ?? null })}
            >
              <div className="row-main">
                <span className="row-name">{k.hash || '(empty)'}</span>
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
            <button onClick={nextBrowsePage} disabled={!data?.has_more || loading}>
              →
            </button>
            <span title="Cursor-paged primary key listing">
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
              style={{
                background: 'var(--bg-raised)',
                color: 'inherit',
                border: '1px solid var(--border-strong)',
                borderRadius: 4,
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}/page
                </option>
              ))}
            </select>
          </>
        ) : (
          <span>
            {rows.length} {rows.length === 1 ? 'record' : 'records'}
          </span>
        )}
      </div>
    </div>
  );
}
