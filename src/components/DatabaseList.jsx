import React from 'react';
import { short } from '../api.js';

/**
 * Level 1 — databases registered on the node.
 *
 * Lists the personal database, any additional owned databases, and any
 * received shared databases returned by `POST /v1/x/databases` (`list`).
 */
export default function DatabaseList({ databases, loading, error, selected, onSelect, onRefresh }) {
  const list = databases ?? [];

  return (
    <div className="col col-databases">
      <div className="col-head">
        <div className="col-title">
          <span>1 · Databases</span>
          {loading && <span className="spin" />}
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={onRefresh} disabled={loading} title="Refresh database list">
            ↻
          </button>
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      <div className="col-body">
        {loading && list.length === 0 && <div className="empty">Loading databases…</div>}
        {!loading && !error && list.length === 0 && (
          <div className="empty">No databases registered on this node.</div>
        )}
        {list.map((db) => {
          const isSel = selected?.id === db.id;
          return (
            <button
              key={db.id}
              className={`row${isSel ? ' sel' : ''}`}
              onClick={() => onSelect(db)}
            >
              <div className="row-main">
                <span className="row-name">{db.name || short(db.id, 8)}</span>
                {db.access && <span className="badge">{db.access}</span>}
              </div>
              <div className="row-sub">
                {db.kind && <span className="badge hr">{db.kind}</span>}{' '}
                {db.state && <span>{db.state}</span>}
                {db.id ? ` · ${short(db.id, 6)}` : ''}
              </div>
            </button>
          );
        })}
      </div>

      <div className="pager">
        <span>
          {list.length} {list.length === 1 ? 'database' : 'databases'}
        </span>
      </div>
    </div>
  );
}
