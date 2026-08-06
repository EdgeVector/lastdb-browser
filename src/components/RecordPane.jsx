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
 * Level 3 — one record, fully hydrated.
 *
 * This is the first read in the drill-down that asks for every field, and it
 * happens only after a specific key has been clicked. It is a keyed read
 * (HashKey / HashRangeKey), so the width is paid on exactly one row.
 *
 * The response's per-field `metadata` — atom_uuid, molecule_uuid, version,
 * has_conflicts — is what makes level 4 a direct fetch: the atom pane never has
 * to search for the atom behind a field, it already has its address.
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
          // One wide keyed read is the cheap path and the common case.
          const wide = await api.record(schema.name, fields, selectedKey);
          if (wide) return { row: wide, mode: 'wide' };
          // Blank means the projection coupled the fields together, not
          // necessarily that the record is absent — rebuild it field by field.
          const split = await api.recordByField(schema.name, fields, selectedKey);
          return { row: split, mode: split ? 'per-field' : 'none' };
        },
    [schema?.name, selectedKey?.hash, selectedKey?.range, fields.join(',')],
  );

  const { loading, error } = result;
  const data = result.data?.row ?? null;
  const readMode = result.data?.mode ?? null;

  // Hand the per-field atom addresses to the atom pane. They arrive with the
  // record read, so level 4 costs one fetch of the body — never a lookup.
  useEffect(() => {
    onMeta?.(data?.metadata ?? null);
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
          Schemas → keys → record → atoms. Each level is fetched only when you open it.
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
                  {detail?.field_molecule_uuids?.[f] && (
                    <div className="field-desc mono">
                      molecule {short(detail.field_molecule_uuids[f], 12)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="empty">Pick a key to hydrate a record.</div>
          </>
        )}

        {selectedKey && !loading && !error && !data && (
          <div className="empty">
            Nothing resolved at that key.
            <br />
            <br />
            Neither a wide read nor a field-by-field read returned an atom here.
            The most common cause is that the key list was projected on a field
            other than <code>{schema.key?.hash_field}</code>, in which case the
            node reports the encoded partition token instead of the real hash —
            and no keyed read can address that. Set <strong>list by</strong> to{' '}
            <code>{schema.key?.hash_field}</code> and try again.
          </div>
        )}

        {selectedKey && data && readMode === 'per-field' && (
          <div className="note" style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>
            Rebuilt field by field — the combined read returned nothing, so at
            least one field has no atom at this key.
          </div>
        )}

        {selectedKey &&
          data &&
          fields.map((f) => {
            const meta = data.metadata?.[f];
            const present = f in (data.fields || {});
            return (
              <div
                key={f}
                className={`field${selectedField === f ? ' sel' : ''}`}
                onClick={() => meta?.atom_uuid && onSelectField(f)}
                style={meta?.atom_uuid ? undefined : { cursor: 'default', opacity: 0.55 }}
              >
                <div className="field-head">
                  <span className="field-name">{f}</span>
                  <span className="field-type">{typeName(detail?.field_types?.[f])}</span>
                  {meta?.has_conflicts && <span className="badge conflict">conflict</span>}
                  {meta?.molecule_version != null && (
                    <span className="badge">v{meta.molecule_version}</span>
                  )}
                </div>
                <div className="field-val">
                  {present ? renderValue(data.fields[f]) : <em style={{ opacity: 0.6 }}>no atom</em>}
                </div>
                {meta?.atom_uuid && (
                  <div className="field-desc mono">atom {short(meta.atom_uuid, 12)} →</div>
                )}
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
