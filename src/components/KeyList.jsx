import React, { useEffect, useState } from 'react';
import * as api from '../api.js';
import { useAsync } from '../useAsync.js';

const PAGE_SIZES = [25, 50, 100, 250];

/**
 * Level 2 — the keys in one schema.
 *
 * Two ways in, and the difference matters enough to show it in the UI:
 *
 *  · BROWSE is a `Page` read. It is bounded (only the window is materialized)
 *    and exact (`total_count` comes from a key count, not from loading bodies),
 *    but it is not key-restricted, so the node classes it as an admin full
 *    scan. On a 12k-row schema the count pass alone costs seconds.
 *
 *  · LOOKUP is the node's real access pattern — HashKey for a partition,
 *    HashRangeKey for a record, HashRangePrefix for a slice of one partition.
 *    O(1) / O(log M), no scan header, fast on schemas where browse is not.
 *
 * Either way the projection is a single field. The key itself rides on the row
 * envelope regardless of projection, and each extra projected field costs its
 * atom metadata on every row — so a wider projection here would buy nothing but
 * bytes for values no one has asked to see yet.
 */
export default function KeyList({ schema, selectedKey, onSelect }) {
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [mode, setMode] = useState('browse'); // 'browse' | 'lookup'
  const [hashInput, setHashInput] = useState('');
  const [rangeInput, setRangeInput] = useState('');
  const [lookup, setLookup] = useState(null); // committed lookup filter
  const [projField, setProjField] = useState(null); // field the listing reads by

  const hashField = schema?.key?.hash_field;
  const rangeField = schema?.key?.range_field;
  const isHashRange = Boolean(rangeField);
  const candidates = api.projectionCandidates(schema);

  // Reset paging, lookup, and the chosen projection when the schema changes.
  useEffect(() => {
    setOffset(0);
    setMode('browse');
    setHashInput('');
    setRangeInput('');
    setLookup(null);
    setProjField(null);
  }, [schema?.name]);

  const result = useAsync(
    !schema || candidates.length === 0
      ? null
      : mode === 'lookup'
        ? lookup
          ? () =>
              api
                .keyLookup(schema.name, [projField || candidates[0]], lookup)
                .then((data) => ({ data, field: projField || candidates[0] }))
          : null
        : projField
          ? // A field is already known to resolve on this schema — page with it
            // directly rather than re-probing on every page turn.
            () => api.keyPage(schema.name, projField, { offset, limit }).then((data) => ({ data, field: projField }))
          : () => api.keyPageProbing(schema, { offset, limit }),
    [schema?.name, mode, offset, limit, JSON.stringify(lookup), projField],
  );

  const { loading, error } = result;
  const data = result.data?.data ?? null;
  const usedField = result.data?.field ?? projField ?? null;

  // Remember whatever the probe settled on, so paging costs one read.
  useEffect(() => {
    if (usedField && usedField !== projField) setProjField(usedField);
  }, [usedField, projField]);

  const rows = data?.results ?? [];
  const total = data?.total_count ?? null;

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
          <>
            <div className="note" style={{ marginTop: 6 }}>
              Paged <code>Page</code> read ·{' '}
              <span className="tag-scan mono">X-LastDB-Allow-Full-Scan</span>
            </div>
            <div
              className="note"
              style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <span>list by</span>
              <select
                value={usedField || ''}
                onChange={(e) => {
                  setProjField(e.target.value);
                  setOffset(0);
                }}
                style={{
                  background: 'var(--bg-raised)',
                  color: 'inherit',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 4,
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  maxWidth: 150,
                }}
              >
                {candidates.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span title="A row is listed only if this field resolves to an atom on it, so the field chosen changes which keys appear.">
                ⓘ
              </span>
            </div>
            {usedField && !api.keyIsAddressable(schema, usedField) && (
              <div className="note" style={{ marginTop: 5, color: 'var(--warn)' }}>
                Listing by a non-key field: the node returns the <em>encoded</em>{' '}
                partition token rather than the real {hashField} value, so these
                keys cannot be read back. Switch to <code>{hashField}</code> for
                addressable keys.
              </div>
            )}
          </>
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
            {mode === 'browse' && total ? (
              <>
                No live rows in this window.
                <br />
                <br />
                The node holds {total.toLocaleString()} keys for{' '}
                <code>{usedField}</code>, but every key in rows{' '}
                {offset + 1}–{offset + limit} is deleted. A page windows over all
                keys and drops tombstoned ones afterwards, so an empty page does
                not mean an empty field — <strong>page forward</strong>, or jump
                straight to a key with <strong>keyed lookup</strong>.
              </>
            ) : (
              'No rows.'
            )}
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
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0 || loading}>
              ←
            </button>
            <button onClick={() => setOffset(offset + limit)} disabled={!data?.has_more || loading}>
              →
            </button>
            <span title="total_count is counted for the projected field, so it moves when you change 'list by'">
              {rows.length ? `${offset + 1}–${offset + rows.length}` : '0'}
              {total != null ? ` of ${total.toLocaleString()}` : ''}
              {usedField ? ` by ${usedField}` : ''}
            </span>
            <span style={{ flex: 1 }} />
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
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
