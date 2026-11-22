import React, { useMemo, useState } from 'react';

/**
 * Level 2 — schemas on the selected database.
 *
 * Loaded via `POST /v1/x/databases` (`schemas`, `include_full: true`) only
 * after a database has been selected.
 */
export default function SchemaList({
  database,
  catalog,
  loading,
  error,
  selected,
  onSelect,
  onRefresh,
}) {
  const [filter, setFilter] = useState('');

  const all = catalog?.schemas ?? [];

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return all
      .filter((s) => {
        if (!needle) return true;
        return (
          (s.descriptive_name || '').toLowerCase().includes(needle) ||
          (s.name || '').toLowerCase().includes(needle) ||
          (s.owner_app_id || '').toLowerCase().includes(needle) ||
          (s.purpose_statement || '').toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const appCmp = (a.owner_app_id || '').localeCompare(b.owner_app_id || '');
        if (appCmp !== 0) return appCmp;
        return (a.descriptive_name || a.name).localeCompare(b.descriptive_name || b.name);
      });
  }, [all, filter]);

  if (!database) {
    return (
      <div className="col col-schemas">
        <div className="col-head">
          <div className="col-title">2 · Schemas</div>
        </div>
        <div className="empty">Pick a database to list its schemas.</div>
      </div>
    );
  }

  return (
    <div className="col col-schemas">
      <div className="col-head">
        <div className="col-title">
          <span>2 · Schemas</span>
          {loading && <span className="spin" />}
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={onRefresh} disabled={loading} title="Reload schemas for this database">
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
      </div>

      {error && <div className="err">{error}</div>}

      <div className="col-body">
        {loading && all.length === 0 && <div className="empty">Loading schemas…</div>}
        {!loading && !error && rows.length === 0 && (
          <div className="empty">No schemas match.</div>
        )}
        {rows.map((s) => {
          const primary = s.record_keys?.primary;
          const altCount = Object.keys(s.record_keys?.alternates || {}).length;
          const isHR = primary?.kind === 'hash_range' || s.schema_type === 'HashRange';
          return (
            <button
              key={s.name}
              className={`row${selected?.name === s.name ? ' sel' : ''}`}
              onClick={() => onSelect(s)}
            >
              <div className="row-main">
                <span className="row-name">{s.descriptive_name || s.name}</span>
                <span className="count">{(s.fields || []).length}f</span>
              </div>
              <div className="row-sub">
                <span className={`badge${isHR ? ' hr' : ''}`}>
                  {isHR
                    ? `HashRange${primary?.range_type ? ` · ${primary.range_type}` : ''}`
                    : 'Hash'}
                </span>
                {altCount > 0 && ` +${altCount} alt`}
                {s.owner_app_id ? ` · ${s.owner_app_id}` : ` · ${s.name}`}
              </div>
            </button>
          );
        })}
      </div>

      <div className="pager">
        <span>
          {rows.length} of {all.length} {all.length === 1 ? 'schema' : 'schemas'}
        </span>
      </div>
    </div>
  );
}
