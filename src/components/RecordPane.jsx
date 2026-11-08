import React, { useEffect } from 'react';
import * as api from '../api.js';
import { useAsync } from '../useAsync.js';
import { short } from '../api.js';

function renderValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

/**
 * Level 3 — one record.
 *
 * Every query returns the full record. This read happens only after a specific
 * key has been clicked. The node stores one record per key, so the record read
 * is the whole read. The record carries one metadata block. The values go to
 * the field pane.
 */
export default function RecordPane({
  schema,
  detail,
  selectedKey,
  selectedField,
  onSelectField,
  onMeta,
}) {
  const fields = schema?.fields ?? [];

  const result = useAsync(
    !schema || !selectedKey
      ? null
      : async () => {
          const row = await api.record(schema.name, selectedKey);
          return { row };
        },
    [schema?.name, selectedKey?.hash, selectedKey?.range],
  );

  const { loading, error } = result;
  const data = result.data?.row ?? null;

  // Hand the values to the field pane. They arrive with the record read, so
  // level 4 needs no node request.
  useEffect(() => {
    onMeta?.(data ? { fields: data.fields ?? {} } : null);
  }, [data, onMeta]);

  if (!schema) {
    return (
      <div className="col col-record">
        <div className="col-head">
          <div className="col-title">3 · Record</div>
        </div>
        <div className="empty">
          <strong>LastDB Browser</strong>
          <br />
          Schemas → keys → record → field. Each level is fetched only when you open it.
        </div>
      </div>
    );
  }

  return (
    <div className="col col-record">
      <div className="col-head">
        <div className="col-title">
          <span>3 · Record</span>
          {loading && <span className="spin" />}
        </div>
        <div style={{ marginTop: 5 }}>
          <div className="row-name" style={{ fontSize: 12, fontWeight: 600 }}>
            {schema.descriptive_name || short(schema.name, 14)}
          </div>
          {selectedKey ? (
            <div className="row-sub" style={{ whiteSpace: 'normal' }}>
              <code>{selectedKey.hash}</code>
              {selectedKey.range != null && (
                <>
                  {' '}
                  ↳ <code>{selectedKey.range}</code>
                </>
              )}
            </div>
          ) : (
            <div className="row-sub">{schema.record_count ?? '—'} records</div>
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
                <dt>type</dt>
                <dd>{schema.schema_type}</dd>
                <dt>key</dt>
                <dd>
                  {schema.key?.hash_field}
                  {schema.key?.range_field ? ` / ${schema.key.range_field}` : ''}
                </dd>
                {schema.owner_app_id && (
                  <>
                    <dt>owner app</dt>
                    <dd>{schema.owner_app_id}</dd>
                  </>
                )}
                <dt>records</dt>
                <dd>{schema.record_count ?? '—'}</dd>
                <dt>source</dt>
                <dd>{schema.source}</dd>
              </dl>
              {schema.purpose_statement && (
                <p className="note" style={{ marginTop: 8 }}>
                  {schema.purpose_statement}
                </p>
              )}
            </div>

            <div className="section">
              <h3>Fields ({fields.length})</h3>
              {fields.map((f) => (
                <div key={f} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="field-head">
                    <span className="field-name">{f}</span>
                    <span className="field-type">
                      {typeName(detail?.field_types?.[f])}
                    </span>
                    {f === schema.key?.hash_field && <span className="badge hr">hash</span>}
                    {f === schema.key?.range_field && <span className="badge hr">range</span>}
                  </div>
                  {detail?.field_descriptions?.[f] && (
                    <div className="field-desc">{detail.field_descriptions[f]}</div>
                  )}
                  {detail?.field_key_ids?.[f] && (
                    <div className="field-desc mono">
                      field key {short(detail.field_key_ids[f], 12)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="empty">Pick a key to hydrate a record.</div>
          </>
        )}

        {selectedKey && !loading && !error && !data && (
          <div className="empty">Nothing resolved at that key.</div>
        )}

        {selectedKey &&
          data &&
          fields.map((f) => {
            const present = f in (data.fields || {});
            return (
              <div
                key={f}
                className={`field${selectedField === f ? ' sel' : ''}`}
                onClick={() => present && onSelectField(f)}
                style={present ? undefined : { cursor: 'default', opacity: 0.55 }}
              >
                <div className="field-head">
                  <span className="field-name">{f}</span>
                  <span className="field-type">{typeName(detail?.field_types?.[f])}</span>
                </div>
                <div className="field-val">
                  {present ? renderValue(data.fields[f]) : <em style={{ opacity: 0.6 }}>no value</em>}
                </div>
                {present && <div className="field-desc mono">field →</div>}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function typeName(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.Array) return `Array<${t.Array}>`;
  return JSON.stringify(t);
}
