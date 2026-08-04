import { useEffect, useState } from 'react';
import { onSnapshot, type DocumentData, type Query } from 'firebase/firestore';

import { withId } from '@/lib/firestore';

type CollectionState<T> = {
  data: T[];
  loading: boolean;
  error: Error | null;
};

/**
 * Live listener for any query. Pass a memoized query (useMemo) — a fresh Query object
 * on every render would tear down and re-subscribe the listener each time.
 *
 * On error the data is left empty *and* `error` is set. Callers must render the error case:
 * a rules rejection and a genuinely empty collection both produce zero rows, and showing the
 * empty state for both is how "permission denied" ends up looking like "you have no members".
 * The console.error is deliberate — a missing composite index reports itself here with a
 * ready-made console link to create it, and swallowing that turns a 30-second fix into a hunt.
 */
export function useCollection<T>(query: Query<DocumentData> | null): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));

    const unsub = onSnapshot(
      query,
      (snap) => {
        setState({
          data: snap.docs.map((d) => withId<T>(d)),
          loading: false,
          error: null,
        });
      },
      (error) => {
        console.error('[firestore] listener failed', error);
        setState({ data: [], loading: false, error });
      }
    );

    return unsub;
  }, [query]);

  return state;
}
