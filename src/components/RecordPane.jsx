import React, { useMemo } from 'react';
import { short } from '../api.js';

function renderValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '(empty string)' : v;
  return JSON.stringify(v, null, 2);
}

function formatBytes(n) {
  if (typeof n !== 'number') return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Level 4 — one record in the selected schema on the selected database.
 *
 * Hydrated via `POST /v1/read` (`ReadByKey`) only after a key is clicked.
 */
export default function RecordPane({
  database,
  schema,
  selectedKey,
  recordData,
  loading,
  error,
  selectedField,
  onSelectField,
}) {
  const data = recordData;
  const fieldValues = data?.record ?? {};

  const orderedFields = useMemo(() => {
    const declared = schema?.fields ?? [];
    const seen = new Set(declared);
    const extra = Object.keys(fieldValues).filter((k) => !seen.has(k));
    return [...declared, ...extra];
  }, [schema?.fields, fieldValues]);

  if (!database || !schema) {
    return (
      <div className="col col-record">
        <div className="col-head">
          <div className="col-title">4 · Record</div>
        </div>
        <div className="empty">
          <strong>LastDB Browser</strong>
          <br />
          Databases → schemas → keys → record. Each level is fetched only when opened.
        </div>
      </div>
    );
  }

  const primary = schema.record_keys?.primary;
  const alternates = schema.record_keys?.alternates ?? {};
  const altEntries = Object.entries(alternates);

  return (
    <div className="col col-record">
      <div className="col-head">
        <div className="col-title">
          <span>4 · Record</span>
          {loading && <span className="spin" />}
        </div>
        <div style={{ marginTop: 5 }}>
          <div className="row-name" style={{ fontSize: 12, fontWeight: 600 }}>
            {schema.descriptive_name || schema.name}
          </div>
          {selectedKey ? (
            <div className="row-sub" style={{ whiteSpace: 'normal' }}>
              <code>{selectedKey.hash || '(empty)'}</code>
              {selectedKey.range != null && (
                <>
                  {' '}
                  ↳ <code>{selectedKey.range}</code>
                </>
              )}
            </div>
          ) : (
            <div className="row-sub">{schema.name}</div>
          )}
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      <div className="col-body">
        {!selectedKey && (
          <>
            <div className="section" style={{ borderTop: 'none' }}>
              <h3>Schema</h3>
              <dl className="kv">
                <dt>identity</dt>
                <dd>{schema.name}</dd>
                <dt>database</dt>
                <dd>{database.name || database.id}</dd>
                <dt>type</dt>
                <dd>{schema.schema_type}</dd>
                <dt>primary key</dt>
                <dd>
                  {primary?.kind === 'hash_range'
                    ? `hash + range (${primary.range_type || 'String'})`
                    : 'hash'}
                </dd>
                {altEntries.length > 0 && (
                  <>
                    <dt>alternates</dt>
                    <dd>
                      {altEntries
                        .map(([name, def]) =>
                          def.kind === 'hash_range'
                            ? `${name} (hash + ${def.range_type || 'String'})`
                            : `${name} (hash)`,
                        )
                        .join(', ')}
                    </dd>
                  </>
                )}
                {schema.owner_app_id && (
                  <>
                    <dt>owner app</dt>
                    <dd>{schema.owner_app_id}</dd>
                  </>
                )}
                {schema.identity_hash && (
                  <>
                    <dt>definition</dt>
                    <dd>{short(schema.identity_hash, 12)}</dd>
                  </>
                )}
              </dl>
              {schema.purpose_statement && (
                <p className="note" style={{ marginTop: 8 }}>
                  {schema.purpose_statement}
                </p>
              )}
            </div>

            <div className="section">
              <h3>Fields ({(schema.fields || []).length})</h3>
              {(schema.fields || []).map((f) => (
                <div key={f} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="field-head">
                    <span className="field-name">{f}</span>
                    <span className="field-type">{typeName(schema.field_types?.[f])}</span>
                  </div>
                  {schema.field_descriptions?.[f] && (
                    <div className="field-desc">{schema.field_descriptions[f]}</div>
                  )}
                  {schema.field_hashes?.[f] && (
                    <div className="field-desc mono">
                      field hash {short(schema.field_hashes[f], 12)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="empty">Pick a key to view its record.</div>
          </>
        )}

        {selectedKey && !loading && !error && !data && (
          <div className="empty">Nothing resolved at that key.</div>
        )}

        {selectedKey && data && (
          <>
            <div className="section" style={{ borderTop: 'none' }}>
              <h3>Metadata</h3>
              <dl className="kv">
                <dt>revision</dt>
                <dd>{short(data.revision, 12)}</dd>
                {data.created_by && (
                  <>
                    <dt>created by</dt>
                    <dd>{short(data.created_by, 12)}</dd>
                  </>
                )}
                {data.updated_by && (
                  <>
                    <dt>updated by</dt>
                    <dd>{short(data.updated_by, 12)}</dd>
                  </>
                )}
                {data.file && (
                  <>
                    <dt>file</dt>
                    <dd>
                      {formatBytes(data.file.size)}
                      {data.file.media_type ? ` · ${data.file.media_type}` : ''}
                      {data.file.name ? ` · ${data.file.name}` : ''}
                    </dd>
                  </>
                )}
              </dl>
            </div>

            {orderedFields.map((f) => {
              const present = f in fieldValues;
              return (
                <div
                  key={f}
                  className={`field${selectedField === f ? ' sel' : ''}`}
                  onClick={() => present && onSelectField(f)}
                  style={present ? undefined : { cursor: 'default', opacity: 0.55 }}
                >
                  <div className="field-head">
                    <span className="field-name">{f}</span>
                    <span className="field-type">{typeName(schema.field_types?.[f])}</span>
                  </div>
                  <div className="field-val">
                    {present ? (
                      renderValue(fieldValues[f])
                    ) : (
                      <em style={{ opacity: 0.6 }}>no value</em>
                    )}
                  </div>
                  {present && <div className="field-desc mono">inspect field →</div>}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function typeName(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.Array) return `Array<${typeName(t.Array)}>`;
  return JSON.stringify(t);
}
