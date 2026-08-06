import React, { useCallback, useEffect, useState } from 'react';
import * as api from './api.js';
import { useAsync } from './useAsync.js';
import SchemaList from './components/SchemaList.jsx';
import KeyList from './components/KeyList.jsx';
import RecordPane from './components/RecordPane.jsx';
import AtomPane from './components/AtomPane.jsx';
import RequestLog from './components/RequestLog.jsx';

/**
 * Four columns, four levels, one node read per level:
 *
 *   schemas ──▶ keys ──▶ record ──▶ atom
 *
 * Selecting at level N clears N+1 downward, so nothing below the open pane is
 * ever in memory, and nothing below it was ever fetched.
 */
export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [catalogState, setCatalogState] = useState({ loading: true, error: null });
  const [schema, setSchema] = useState(null);
  const [key, setKey] = useState(null);
  const [field, setField] = useState(null);
  const [recordMeta, setRecordMeta] = useState(null);
  const [status, setStatus] = useState(null);

  const loadCatalog = useCallback(async (refresh = false) => {
    setCatalogState({ loading: true, error: null });
    try {
      const data = await api.schemas({ refresh });
      setCatalog(data);
      setCatalogState({ loading: false, error: null });
    } catch (err) {
      setCatalogState({ loading: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    api.health().then(setStatus).catch(() => setStatus({ ok: false }));
    loadCatalog(false);
  }, [loadCatalog]);

  // The schema's shape — field types, descriptions, per-field molecule UUIDs.
  // One small read, fetched when a schema is opened and not before.
  const detail = useAsync(
    schema ? () => api.schemaDetail(schema.name) : null,
    [schema?.name],
  );

  function selectSchema(s) {
    setSchema(s);
    setKey(null);
    setField(null);
    setRecordMeta(null);
  }

  function selectKey(k) {
    setKey(k);
    setField(null);
    setRecordMeta(null);
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>LastDB Browser</h1>
        <span className="note">
          <span className={`dot ${status == null ? 'unknown' : status.ok ? 'up' : 'down'}`} />
          {status == null ? 'connecting…' : status.ok ? 'node up' : 'node unreachable'}
        </span>
        {status?.socket && (
          <span className="note mono" style={{ fontSize: 10.5 }}>
            {status.socket}
          </span>
        )}
        <span className="spacer" />
        <span className="note">
          schemas → keys → record → atom · each level fetched on open
        </span>
      </div>

      <div className="columns">
        <SchemaList
          catalog={catalog}
          loading={catalogState.loading}
          error={catalogState.error}
          selected={schema}
          onSelect={selectSchema}
          onRefresh={() => loadCatalog(true)}
        />
        <KeyList schema={schema} selectedKey={key} onSelect={selectKey} />
        <RecordPane
          schema={schema}
          detail={detail.data}
          selectedKey={key}
          selectedField={field}
          onSelectField={setField}
          onMeta={setRecordMeta}
        />
        <AtomPane
          schemaDetail={detail.data}
          selectedKey={key}
          field={field}
          meta={recordMeta?.[field]}
        />
      </div>

      <RequestLog />
    </div>
  );
}
