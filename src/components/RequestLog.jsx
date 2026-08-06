import React, { useEffect, useState } from 'react';
import { onRequest } from '../api.js';

/**
 * Every node round-trip the app has made, with its latency and response size.
 *
 * This is here because "hydrate only what I need" is a claim about behaviour,
 * and a claim about behaviour should be checkable rather than promised. Opening
 * a schema should add one line; opening a record should add one more.
 */
export default function RequestLog() {
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(true);

  useEffect(() => onRequest((e) => setEntries((prev) => [e, ...prev].slice(0, 200))), []);

  const totalBytes = entries.reduce((a, e) => a + (e.bytes || 0), 0);

  return (
    <div className="log" style={open ? undefined : { maxHeight: 'none' }}>
      <div className="log-head" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} Node requests</span>
        <span>{entries.length}</span>
        <span>{fmtBytes(totalBytes)} total</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEntries([]);
          }}
        >
          clear
        </button>
      </div>
      {open && (
        <div className="log-body">
          {entries.length === 0 && <div className="log-line">no requests yet</div>}
          {entries.map((e) => (
            <div key={e.id} className={`log-line${e.ok ? '' : ' bad'}`}>
              <span className="lbl">
                {e.fullScan && <span className="tag-scan">[scan] </span>}
                {e.label}
              </span>
              <span className="ms">{e.nodeMs != null ? `${e.nodeMs}ms` : `${e.clientMs}ms`}</span>
              <span className="by">{e.bytes != null ? fmtBytes(e.bytes) : ''}</span>
              <span>{e.error || ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
