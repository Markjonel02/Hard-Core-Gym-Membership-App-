import { useCallback, useEffect, useMemo, useState } from 'react';

/** Rows per page. Five is the threshold the desk asked for: six rows means a pager appears. */
export const PAGE_SIZE = 5;

export type Pagination<T> = {
  /** The rows to render for the current page. */
  pageRows: T[];
  /** Zero-based, already clamped to a page that exists. */
  page: number;
  pageCount: number;
  total: number;
  /** 1-based inclusive bounds for the "6–10 of 23" label. Both 0 when the list is empty. */
  from: number;
  to: number;
  next: () => void;
  prev: () => void;
  /** False when everything fits on one page — the pager hides itself entirely. */
  hasPages: boolean;
};

/**
 * Windows an in-memory array into pages.
 *
 * Deliberately not a Firestore cursor. Every list in this app already holds its whole collection
 * in memory over `onSnapshot` (see the note in lib/firestore.ts about why the queries carry no
 * `orderBy`/`limit`), so a page flip is a slice — zero extra reads, and a row edited elsewhere
 * updates on whatever page you are standing on. A `startAfter` cursor would mean adding `orderBy`
 * to those queries, which is the exact footgun that comment exists to prevent.
 *
 * `resetKey` is whatever the caller filters by (a search string, a filter chip). Changing it
 * returns to page 1 — without that you search for one name and land on an empty page 3.
 */
export function usePagination<T>(
  rows: T[],
  pageSize: number = PAGE_SIZE,
  resetKey?: unknown
): Pagination<T> {
  const [page, setPage] = useState(0);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  // These lists are live: rows arrive and disappear while you are looking at them (a membership
  // is archived, a listener re-delivers a narrowed set). Clamping during render rather than only
  // in the effect below means the shrink never paints one blank frame first.
  const safePage = Math.min(page, pageCount - 1);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const start = safePage * pageSize;
  const pageRows = useMemo(() => rows.slice(start, start + pageSize), [rows, start, pageSize]);

  const next = useCallback(() => {
    setPage((current) => Math.min(current + 1, pageCount - 1));
  }, [pageCount]);

  const prev = useCallback(() => {
    setPage((current) => Math.max(current - 1, 0));
  }, []);

  return {
    pageRows,
    page: safePage,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + pageRows.length,
    next,
    prev,
    hasPages: total > pageSize,
  };
}
