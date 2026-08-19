import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { withDb } from '../services/database';
import type { ItemsDatabase } from '../services/items';

export interface DbQueryResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Runs a read against the shared connection whenever the screen gains focus.
 *
 * Focus rather than mount: every screen here can be returned to after another
 * screen wrote to the database (adding an item, deleting one, recording a
 * verdict), and a mount-only fetch would leave those screens showing stale
 * rows for as long as they stayed in the navigation stack.
 *
 * `deps` behaves like a useCallback dependency array for `query`.
 */
export function useDbQuery<T>(
  query: (db: ItemsDatabase) => Promise<T>,
  deps: readonly unknown[],
): DbQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Guards against a state update landing after the screen lost focus, which
  // React warns about and which would overwrite whatever the next focus loads.
  const cancelled = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableQuery = useCallback(query, deps);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await withDb(stableQuery);
      if (!cancelled.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      console.error('Database read failed:', e);
      if (!cancelled.current) setError('Could not read from the database.');
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [stableQuery]);

  useFocusEffect(
    useCallback(() => {
      cancelled.current = false;
      void reload();
      return () => {
        cancelled.current = true;
      };
    }, [reload]),
  );

  return { data, error, loading, reload };
}
