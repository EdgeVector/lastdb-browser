import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async loader when `deps` change, discarding results that arrive after
 * the selection has moved on.
 *
 * The stale-result guard is load-bearing here rather than defensive: a paged
 * key read on a large schema takes seconds, so without it a click into a second
 * schema can be overwritten by the first schema's late response.
 *
 * `loader` is null when there is nothing to load — the pane is closed — which
 * is how "hydrate only what's open" is expressed at the component level.
 */
export function useAsync(loader, deps) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const runId = useRef(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!loader) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    const id = ++runId.current;
    setState({ loading: true, data: null, error: null });
    loader()
      .then((data) => {
        if (runId.current === id) setState({ loading: false, data, error: null });
      })
      .catch((err) => {
        if (runId.current === id) setState({ loading: false, data: null, error: err.message });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
