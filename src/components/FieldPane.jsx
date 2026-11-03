import React from 'react';
import * as api from '../api.js';
import { useAsync } from '../useAsync.js';

/**
 * Pull a `$lastdb_file` descriptor out of a field value, if that is what it is.
 *
 * The value can arrive as a JSON string, so this parses before matching.
 */
function lastdbFile(content) {
  if (!content) return null;
  let value = content;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t.startsWith('{') || !t.includes('$lastdb_file')) return null;
    try {
      value = JSON.parse(t);
    } catch {
      return null;
    }
  }
  const descriptor = value?.$lastdb_file;
  return descriptor && typeof descriptor === 'object' ? descriptor : null;
}

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

  // A LastDB file is not a path. Most files here live IN the database as an
  // encrypted blob described by a `$lastdb_file` envelope — name, media type,
  // size, `blob_ref`, and the DEK. Raw, that JSON is unreadable; named, it is
  // the most useful thing on the pane.
  const blob = lastdbFile(value);

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
        {blob && (
          <div className="section" style={{ borderTop: 'none' }}>
            <h3>File</h3>
            <div className="field-name" style={{ fontSize: 12, wordBreak: 'break-word' }}>
              {blob.name || '(unnamed)'}
            </div>
            <dl className="kv" style={{ marginTop: 6 }}>
              <dt>type</dt>
              <dd>{blob.media_type || 'unknown'}</dd>
              <dt>size</dt>
              <dd>{formatBytes(blob.encrypted_size_bytes)} encrypted</dd>
              <dt>blob</dt>
              <dd style={{ fontSize: 10.5 }}>{blob.blob_ref}</dd>
            </dl>
            <div className="note" style={{ marginTop: 7 }}>
              Stored in the database as an encrypted blob, not on disk. The node
              exposes no read route for decrypted bytes, so there is nothing to
              open yet — the descriptor is shown instead of pretending otherwise.
            </div>
          </div>
        )}

        <div className="section" style={blob ? undefined : { borderTop: 'none' }}>
          <h3>{blob ? 'Raw content' : 'Content'}</h3>
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
