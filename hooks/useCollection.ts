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
      (error) => setState({ data: [], loading: false, error })
    );

    return unsub;
  }, [query]);

  return state;
}
