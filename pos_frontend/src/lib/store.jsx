import { useEffect, useState, useCallback } from 'react';
import { StoreContext as Context } from './storeContext';
import { api, setCsrf } from './api';
export function StoreProvider({ children }) {
  const [user, setUser] = useState(null),
    [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(null);
  const notify = useCallback(
    (message, type = 'success') => setToast({ message, type, id: Date.now() }),
    [],
  );
  const refresh = useCallback(async () => {
    const result = await api('/bootstrap');
    setData(result);
    setUser(result.user);
    return result;
  }, []);
  const loadSession = useCallback(async () => {
    try {
      const auth = await api('/auth/me');
      setCsrf(auth.csrf_token);
      await refresh();
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [refresh]);
  const initialize = () => {
    setLoading(true);
    setError('');
    loadSession();
  };
  // Session updates happen after the asynchronous auth request, not during rendering.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    loadSession();
  }, [loadSession]);
  useEffect(() => {
    const expire = () => {
      setUser(null);
      setData(null);
      notify('Your session expired. Please sign in again.', 'error');
    };
    window.addEventListener('suki:expired', expire);
    return () => window.removeEventListener('suki:expired', expire);
  }, [notify]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const login = async (credentials) => {
    const auth = await api('/auth/login', { method: 'POST', body: credentials });
    setCsrf(auth.csrf_token);
    await refresh();
  };
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
      setCsrf('');
      setData(null);
      setUser(null);
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  return (
    <Context.Provider
      value={{ user, data, loading, error, refresh, initialize, login, logout, notify }}
    >
      {children}
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          <span>{toast.type === 'error' ? '!' : '✓'}</span>
          {toast.message}
          <button onClick={() => setToast(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
