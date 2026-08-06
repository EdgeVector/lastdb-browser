import React, { useEffect, useState } from 'react';
import * as api from '../api.js';
import { useAsync } from '../useAsync.js';
import { short } from '../api.js';

/**
 * Pull a `$lastdb_file` descriptor out of an atom body, if that is what it is.
 *
 * The body arrives as a JSON string, so this parses before matching.
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
 * Level 4 — the atom.
 *
 * The atom body is fetched as soon as a field is opened, because that is what
 * the click asked for. History and protein binding are NOT: they are separate
 * node round-trips answering questions the user has not asked yet, so each sits
 * behind its own button.
 *
 * History is scoped by hash/range. A molecule is per-FIELD and shared by every
 * key in the schema, so unscoped history would be the field's history across
 * the whole table, not this record's.
 */
export default function AtomPane({ schemaDetail, selectedKey, field, meta }) {
  const [wantHistory, setWantHistory] = useState(false);
  const [wantProtein, setWantProtein] = useState(false);

  const atomUuid = meta?.atom_uuid ?? null;
  const moleculeUuid = meta?.molecule_uuid ?? schemaDetail?.field_molecule_uuids?.[field] ?? null;

  // A new field is a new question; retract the optional reads.
  useEffect(() => {
    setWantHistory(false);
    setWantProtein(false);
  }, [atomUuid]);

  const atom = useAsync(atomUuid ? () => api.atom(atomUuid) : null, [atomUuid]);

  // The atom's own file, if it has one. `source_file_name` is the field meant
  // for this, but it is unset across every schema on this node, so the atom's
  // body is probed too — schemas that track files tend to keep the path in an
  // ordinary field, which is the same click from the user's side.
  const fileCandidate =
    atom.data?.source_file_name ||
    (typeof atom.data?.content === 'string' ? atom.data.content : null);

  const file = useAsync(
    fileCandidate ? () => api.statFile(fileCandidate) : null,
    [fileCandidate],
  );

  // A LastDB file is not a path. Most files here live IN the database as an
  // encrypted blob described by a `$lastdb_file` envelope — name, media type,
  // size, `blob_ref`, and the DEK. Raw, that JSON is unreadable; named, it is
  // the most useful thing on the pane.
  const blob = lastdbFile(atom.data?.content);

  const history = useAsync(
    wantHistory && moleculeUuid ? () => api.history(moleculeUuid, selectedKey) : null,
    [wantHistory, moleculeUuid, selectedKey?.hash, selectedKey?.range],
  );

  const protein = useAsync(
    wantProtein && moleculeUuid ? () => api.proteinOfMolecule(moleculeUuid) : null,
    [wantProtein, moleculeUuid],
  );

  if (!field) {
    return (
      <div className="col col-atom">
        <div className="col-head">
          <div className="col-title">4 · Atom</div>
        </div>
        <div className="empty">
          Click a field to fetch its atom.
          <br />
          <br />
          Each field of a record resolves to one atom; the record read already
          carries the atom&apos;s address, so this is a direct fetch.
        </div>
      </div>
    );
  }

  return (
    <div className="col col-atom">
      <div className="col-head">
        <div className="col-title">
          <span>4 · Atom</span>
          {atom.loading && <span className="spin" />}
        </div>
        <div className="row-name" style={{ marginTop: 5, fontWeight: 600 }}>
          {field}
        </div>
      </div>

      {atom.error && <div className="err">{atom.error}</div>}

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
          <pre className="atom-body">{atom.loading ? '…' : pretty(atom.data?.content)}</pre>
        </div>

        <div className="section">
          <h3>Addresses</h3>
          <dl className="kv">
            <dt>atom</dt>
            <dd style={{ fontSize: 10.5 }}>{atomUuid}</dd>
            <dt>molecule</dt>
            <dd style={{ fontSize: 10.5 }}>{moleculeUuid}</dd>
            {meta?.molecule_version != null && (
              <>
                <dt>version</dt>
                <dd>{meta.molecule_version}</dd>
              </>
            )}
            {atom.data?.created_at && (
              <>
                <dt>created</dt>
                <dd>{new Date(atom.data.created_at).toLocaleString()}</dd>
              </>
            )}
            {atom.data?.source_file_name && (
              <>
                <dt>source file</dt>
                <dd>{atom.data.source_file_name}</dd>
              </>
            )}
            {file.data?.exists && (
              <>
                <dt>on disk</dt>
                <dd>{formatBytes(file.data.size)}</dd>
              </>
            )}
            {meta?.has_conflicts && (
              <>
                <dt>conflicts</dt>
                <dd style={{ color: 'var(--warn)' }}>yes — sibling tips at this key</dd>
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

        <div className="section">
          <h3>History</h3>
          {!wantHistory ? (
            <>
              <button onClick={() => setWantHistory(true)} disabled={!moleculeUuid}>
                load history
              </button>
              <div className="note" style={{ marginTop: 6 }}>
                Prior versions of this field at this key. Separate read — not fetched
                unless asked.
              </div>
            </>
          ) : history.loading ? (
            <span className="spin" />
          ) : history.error ? (
            <div className="err" style={{ margin: 0 }}>{history.error}</div>
          ) : (history.data?.events?.length ?? 0) === 0 ? (
            <div className="note">No prior versions recorded at this key.</div>
          ) : (
            history.data.events.map((ev, i) => (
              <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="mono" style={{ fontSize: 11 }}>
                  {short(ev.atom_uuid || ev.uuid || '', 12)}
                </div>
                <div className="field-desc">
                  {ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}
                </div>
                <div className="field-val" style={{ maxHeight: 80 }}>
                  {pretty(ev.content)}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="section">
          <h3>Protein</h3>
          {!wantProtein ? (
            <>
              <button onClick={() => setWantProtein(true)} disabled={!moleculeUuid}>
                check binding
              </button>
              <div className="note" style={{ marginTop: 6 }}>
                Whether this field&apos;s molecule is bound into a multi-key protein.
              </div>
            </>
          ) : protein.loading ? (
            <span className="spin" />
          ) : protein.error ? (
            <div className="err" style={{ margin: 0 }}>{protein.error}</div>
          ) : (
            <dl className="kv">
              <dt>protein</dt>
              <dd style={{ fontSize: 10.5 }}>
                {protein.data?.protein_uuid ?? 'not bound'}
              </dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
