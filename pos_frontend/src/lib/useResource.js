import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
export function useResource(path) {
  const [result, setResult] = useState({ key: null, data: null, error: '' }),
    [version, setVersion] = useState(0);
  const key = `${path}|${version}`,
    reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api(path, { signal: controller.signal })
      .then((data) => setResult({ key, data, error: '' }))
      .catch((e) => {
        if (e.name !== 'AbortError') setResult({ key, data: null, error: e.message });
      });
    return () => controller.abort();
  }, [path, key]);
  const loading = result.key !== key;
  return {
    data: loading ? null : result.data,
    error: loading ? '' : result.error,
    loading,
    reload,
  };
}
