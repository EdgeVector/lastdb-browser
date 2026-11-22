import React from 'react';
import * as api from '../api.js';
import { useAsync } from '../useAsync.js';

function formatBytes(n) {
  if (typeof n !== 'number') return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function pretty(content) {
  if (content == null) return '—';
  if (typeof content !== 'string') return JSON.stringify(content, null, 2);
  const t = content.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      /* not JSON after all */
    }
  }
  return content;
}

function pathCandidate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /[\n\r\0]/.test(trimmed)) return null;
  if (!trimmed.startsWith('/') && !trimmed.startsWith('~/') && !trimmed.startsWith('file://')) {
    return null;
  }
  return trimmed;
}

/**
 * Level 5 — one field of the open record.
 *
 * Uses the field value and schema metadata already loaded in earlier columns,
 * making zero node requests. Only checks disk when the string looks like an
 * actual local file path (`/…`, `~/…`, or `file://…`).
 */
export default function FieldPane({ schema, field, value, present, onClose }) {
  const fieldHash = schema?.field_hashes?.[field] ?? null;
  const fieldDesc = schema?.field_descriptions?.[field] ?? null;
  const fileCandidate = pathCandidate(value);

  const file = useAsync(
    fileCandidate ? () => api.statFile(fileCandidate) : null,
    [fileCandidate],
  );

  return (
    <div className="col col-field">
      <div className="col-head">
        <div className="col-title">
          <span>5 · Field</span>
          <span className="spacer" style={{ flex: 1 }} />
          {onClose && (
            <button onClick={onClose} title="Close field inspector">
              ×
            </button>
          )}
        </div>
        <div className="row-name" style={{ marginTop: 5, fontWeight: 600 }}>
          {field}
        </div>
        {fieldDesc && <div className="field-desc">{fieldDesc}</div>}
      </div>

      <div className="col-body">
        <div className="section" style={{ borderTop: 'none' }}>
          <h3>Content</h3>
          <pre className="field-content">{present ? pretty(value) : '—'}</pre>
        </div>

        {(fieldHash || file.data?.exists) && (
          <div className="section">
            <h3>Details</h3>
            <dl className="kv">
              {fieldHash && (
                <>
                  <dt>field hash</dt>
                  <dd style={{ fontSize: 10.5 }}>{fieldHash}</dd>
                </>
              )}
              {file.data?.exists && (
                <>
                  <dt>on disk</dt>
                  <dd>{formatBytes(file.data.size)}</dd>
                </>
              )}
            </dl>
          </div>
        )}

        {file.data?.exists && (
          <div className="section">
            <h3>Source file</h3>
            <div className="field-val" style={{ marginBottom: 7 }}>
              {file.data.resolved}
            </div>
            <div className="toolbar" style={{ marginTop: 0 }}>
              <button
                onClick={() => api.openFile(fileCandidate).catch(() => {})}
                disabled={!file.data.openable}
                title={
                  file.data.openable
                    ? 'Open in the default application'
                    : 'Refused: macOS would execute this rather than display it'
                }
              >
                Open
              </button>
              <button onClick={() => api.openFile(fileCandidate, { reveal: true }).catch(() => {})}>
                Reveal in Finder
              </button>
              <button onClick={() => navigator.clipboard?.writeText(file.data.resolved)}>
                Copy path
              </button>
            </div>
            {!file.data.openable && (
              <div className="note" style={{ marginTop: 6, color: 'var(--warn)' }}>
                Executable bundle — Reveal only.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
