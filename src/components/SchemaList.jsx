import React, { useMemo, useState } from 'react';

/**
 * Level 1 — the schema catalog.
 *
 * Defaults to schemas that hold data. A fresh node ships ~1000 starter-seed
 * schema definitions with nothing behind them; listing those first would bury
 * the ~138 that are actually yours. The toggle keeps the empty ones reachable
 * without making them the default view.
 *
 * Nothing below this level is touched here — no shape, no molecules, no rows.
 */
export default function SchemaList({ catalog, loading, error, selected, onSelect, onRefresh }) {
  const [filter, setFilter] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);

  const all = catalog?.schemas ?? [];

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return all
      .filter((s) => (showEmpty ? true : s.has_data === true))
      .filter((s) => {
        if (!needle) return true;
        return (
          (s.descriptive_name || '').toLowerCase().includes(needle) ||
          (s.name || '').toLowerCase().includes(needle) ||
          (s.owner_app_id || '').toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const ca = a.record_count ?? -1;
        const cb = b.record_count ?? -1;
        if (cb !== ca) return cb - ca;
        return (a.descriptive_name || a.name).localeCompare(b.descriptive_name || b.name);
      });
  }, [all, filter, showEmpty]);

  const withData = all.filter((s) => s.has_data === true).length;

  return (
    <div className="col col-schemas">
      <div className="col-head">
        <div className="col-title">
          <span>1 · Schemas</span>
          {loading && <span className="spin" />}
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={onRefresh} disabled={loading} title="Re-count every schema on the node (~30s)">
            ↻
          </button>
        </div>
        <div style={{ marginTop: 6 }}>
          <input
            placeholder="filter schemas…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <label className="note" style={{ display: 'flex', gap: 6, marginTop: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
          />
          <span>
            include empty ({all.length - withData} of {all.length})
          </span>
        </label>
      </div>

      {error && <div className="err">{error}</div>}

      <div className="col-body">
        {loading && all.length === 0 && (
          <div className="empty">
            Counting keys on every schema…
            <br />
            <br />
            This is the one expensive read: it is what distinguishes a schema
            holding data from one of the ~1000 seeded definitions that hold
            none. It takes about a minute on a full node, then it is cached —
            reopen is instant, and ↻ recounts.
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="empty">No schemas match.</div>
        )}
        {rows.map((s) => (
          <button
            key={s.name}
            className={`row${selected?.name === s.name ? ' sel' : ''}`}
            onClick={() => onSelect(s)}
          >
            <div className="row-main">
              <span className="row-name">{s.descriptive_name || s.name}</span>
              <span className="count">{s.record_count ?? '—'}</span>
            </div>
            <div className="row-sub">
              <span className={`badge${s.schema_type === 'HashRange' ? ' hr' : ''}`}>
                {s.schema_type}
              </span>{' '}
              {s.key?.hash_field}
              {s.key?.range_field ? ` / ${s.key.range_field}` : ''}
              {s.owner_app_id ? ` · ${s.owner_app_id}` : ''}
            </div>
          </button>
        ))}
      </div>

      {catalog && (
        <div className="pager">
          <span>
            {withData} with data · counted {new Date(catalog.fetched_at).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}
