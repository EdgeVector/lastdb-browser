import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import { useAsync } from './useAsync.js';
import DatabaseList from './components/DatabaseList.jsx';
import SchemaList from './components/SchemaList.jsx';
import KeyList from './components/KeyList.jsx';
import RecordPane from './components/RecordPane.jsx';
import FieldPane from './components/FieldPane.jsx';
import RequestLog from './components/RequestLog.jsx';

/**
 * Drill-down flow:
 *
 *   databases ──▶ schemas ──▶ keys ──▶ record (──▶ field inspector on click)
 *
 * Selecting at level N clears N+1 downward, so nothing below the open pane is
 * stale, and nothing below it is fetched until opened.
 */
export default function App() {
  const [databases, setDatabases] = useState([]);
  const [dbState, setDbState] = useState({ loading: true, error: null });
  const [database, setDatabase] = useState(null);

  const [catalog, setCatalog] = useState(null);
  const [catalogState, setCatalogState] = useState({ loading: false, error: null });
  const [schema, setSchema] = useState(null);

  const [key, setKey] = useState(null);
  const [field, setField] = useState(null);
  const [status, setStatus] = useState(null);
  const columnsRef = useRef(null);

  const loadDatabases = useCallback(async () => {
    setDbState({ loading: true, error: null });
    try {
      const list = await api.databases();
      setDatabases(list);
      setDbState({ loading: false, error: null });
    } catch (err) {
      setDbState({ loading: false, error: err.message });
    }
  }, []);

  const loadSchemas = useCallback(async (dbId) => {
    if (!dbId) {
      setCatalog(null);
      setCatalogState({ loading: false, error: null });
      return;
    }
    setCatalogState({ loading: true, error: null });
    try {
      const data = await api.schemas(dbId);
      setCatalog(data);
      setCatalogState({ loading: false, error: null });
    } catch (err) {
      setCatalog(null);
      setCatalogState({ loading: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    api.health().then(setStatus).catch(() => setStatus({ ok: false }));
    loadDatabases();
  }, [loadDatabases]);

  useEffect(() => {
    if (database?.id) {
      loadSchemas(database.id);
    } else {
      setCatalog(null);
      setCatalogState({ loading: false, error: null });
    }
  }, [database?.id, loadSchemas]);

  // Single source of truth for the open record, shared by RecordPane and FieldPane.
  const recordResult = useAsync(
    !database || !schema || !key
      ? null
      : () => api.record(database.id, schema.name, key),
    [database?.id, schema?.name, key?.hash, key?.range],
  );

  function selectDatabase(db) {
    setDatabase(db);
    setSchema(null);
    setKey(null);
    setField(null);
  }

  function selectSchema(s) {
    setSchema(s);
    setKey(null);
    setField(null);
  }

  function selectKey(k) {
    const same =
      key != null && key.hash === k.hash && (key.range ?? null) === (k.range ?? null);
    setKey(k);
    if (!same) setField(null);
  }

  function selectField(f) {
    setField(f);
    requestAnimationFrame(() => {
      if (columnsRef.current) {
        columnsRef.current.scrollTo({
          left: columnsRef.current.scrollWidth,
          behavior: 'smooth',
        });
      }
    });
  }

  const recordData = recordResult.data ?? null;
  const fieldValues = recordData?.record ?? {};

  return (
    <div className="app">
      <div className="topbar">
        <h1>LastDB Browser</h1>
        <span className="note" style={{ whiteSpace: 'nowrap' }}>
          <span className={`dot ${status == null ? 'unknown' : status.ok ? 'up' : 'down'}`} />
          {status == null ? 'connecting…' : status.ok ? 'node up' : 'node unreachable'}
        </span>
        {status?.socket && (
          <span
            className="note mono"
            style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {status.socket}
          </span>
        )}
        <span className="shortcut-legend" aria-label="Keyboard shortcuts">
          <span>Keyboard</span>
          <kbd>Tab</kbd><span>focus</span>
          <kbd>Enter</kbd><span>select</span>
        </span>
        <span className="spacer" />
        <span className="note" style={{ whiteSpace: 'nowrap' }}>
          databases → schemas → keys → record
        </span>
      </div>

      <div className="columns" ref={columnsRef}>
        <DatabaseList
          databases={databases}
          loading={dbState.loading}
          error={dbState.error}
          selected={database}
          onSelect={selectDatabase}
          onRefresh={loadDatabases}
        />
        <SchemaList
          key={database?.id ?? 'no-db'}
          database={database}
          catalog={catalog}
          loading={catalogState.loading}
          error={catalogState.error}
          selected={schema}
          onSelect={selectSchema}
          onRefresh={() => database && loadSchemas(database.id)}
        />
        <KeyList
          key={`${database?.id ?? 'no-db'}:${schema?.name ?? 'no-schema'}`}
          database={database}
          schema={schema}
          selectedKey={key}
          onSelect={selectKey}
        />
        <RecordPane
          database={database}
          schema={schema}
          selectedKey={key}
          recordData={recordData}
          loading={recordResult.loading}
          error={recordResult.error}
          selectedField={field}
          onSelectField={selectField}
        />
        {field != null && (
          <FieldPane
            schema={schema}
            field={field}
            value={fieldValues[field]}
            present={recordData != null && field in fieldValues}
            onClose={() => setField(null)}
          />
        )}
      </div>

      <RequestLog />
    </div>
  );
}
