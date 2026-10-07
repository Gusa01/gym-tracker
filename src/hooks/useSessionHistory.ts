import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getDatabase } from '../lib/sqlite/db';
import { syncNow } from '../lib/sync/syncService';
import { getSessionDetail, listCompletedSessions } from '../lib/history/queries';
import { applyCorrection } from '../lib/history/logic';
import { queueSetCorrection } from '../lib/history/submitCorrection';
import { HistorySessionRow, SessionDetail, SetCorrection } from '../lib/history/types';
import { useAuthSession } from './useAuthSession';

export const HISTORY_OFFLINE_MESSAGE = 'Conectate para ver tu historial';

// Refetch on focus; a request counter keeps an older in-flight response from overwriting newer state.
export function useSessionHistory(userId: string | undefined) {
  const [sessions, setSessions] = useState<HistorySessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const latestRequest = useRef(0);
  const nextPage = useRef(0);
  const loadingMoreRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!userId) return;
    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setError(null);
    setLoadMoreError(false);
    try {
      const result = await listCompletedSessions(supabase, userId, 0);
      if (requestId !== latestRequest.current) return;
      setSessions(result.sessions);
      setHasMore(result.hasMore);
      nextPage.current = 1;
    } catch {
      if (requestId === latestRequest.current) setError(HISTORY_OFFLINE_MESSAGE);
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, [userId]);

  const loadMore = useCallback(async () => {
    if (!userId || !hasMore || isLoadingMore || isLoading || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const requestId = latestRequest.current;
    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      const result = await listCompletedSessions(supabase, userId, nextPage.current);
      if (requestId !== latestRequest.current) return;
      setSessions((current) => [...current, ...result.sessions]);
      setHasMore(result.hasMore);
      nextPage.current += 1;
    } catch {
      // Keep the rows already shown; the list offers a retry row at the end (spec §5.2).
      if (requestId === latestRequest.current) setLoadMoreError(true);
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [userId, hasMore, isLoadingMore, isLoading]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { sessions, isLoading, error, hasMore, isLoadingMore, loadMoreError, loadMore, refetch };
}

export function useSessionDetail(sessionId: string | undefined) {
  const { session } = useAuthSession();
  const userId = session?.user.id;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refetch = useCallback(async () => {
    if (!sessionId) return;
    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await getSessionDetail(supabase, sessionId);
      if (requestId === latestRequest.current) setDetail(result);
    } catch {
      if (requestId === latestRequest.current) setError(HISTORY_OFFLINE_MESSAGE);
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  /** Queues the correction, updates the screen immediately, then syncs (rebuilds the records cache). */
  const correctSet = useCallback(
    async (setId: string, change: SetCorrection) => {
      const set = detail?.sets.find((s) => s.id === setId);
      if (!set || !userId) return;
      queueSetCorrection(getDatabase(), set, change);
      setDetail((current) => (current ? { ...current, sets: applyCorrection(current.sets, setId, change) } : current));
      syncNow(getDatabase(), supabase, userId).catch(() => {});
    },
    [detail, userId]
  );

  return { detail, isLoading, error, refetch, correctSet };
}
