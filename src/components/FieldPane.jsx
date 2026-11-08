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

/**
 * Level 4 — one field of the open record.
 *
 * The node stores one record per key. A field has no metadata of its own: the
 * record has one metadata block. So this pane makes no node request for the
 * value: it shows the value that the record read already returned and the
 * field key from the schema. A file stat of the value is the one optional read.
 */
export default function FieldPane({ schemaDetail, field, value, present }) {
  const fieldKeyId = schemaDetail?.field_key_ids?.[field] ?? null;

  // Schemas that track files tend to keep the path in an ordinary field.
  const fileCandidate = typeof value === 'string' ? value : null;

  const file = useAsync(
    fileCandidate ? () => api.statFile(fileCandidate) : null,
    [fileCandidate],
  );

  if (!field) {
    return (
      <div className="col col-field">
        <div className="col-head">
          <div className="col-title">4 · Field</div>
        </div>
        <div className="empty">
          Click a field to show its value.
          <br />
          <br />
          The record read already carries every field value and the record
          metadata, so this pane makes no node request.
        </div>
      </div>
    );
  }

  return (
    <div className="col col-field">
      <div className="col-head">
        <div className="col-title">
          <span>4 · Field</span>
        </div>
        <div className="row-name" style={{ marginTop: 5, fontWeight: 600 }}>
          {field}
        </div>
      </div>

      <div className="col-body">
        <div className="section" style={{ borderTop: 'none' }}>
          <h3>Content</h3>
          <pre className="field-content">{present ? pretty(value) : '—'}</pre>
        </div>

        <div className="section">
          <h3>Addresses</h3>
          <dl className="kv">
            <dt>field key</dt>
            <dd style={{ fontSize: 10.5 }}>{fieldKeyId}</dd>
            {file.data?.exists && (
              <>
                <dt>on disk</dt>
                <dd>{formatBytes(file.data.size)}</dd>
              </>
            )}
          </dl>
        </div>

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
