import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { listExerciseSetHistory } from '../lib/progress/queries';
import { summarizeExercises } from '../lib/progress/summary';
import { ExerciseSetRow, ExerciseSummary } from '../lib/progress/types';

export const PROGRESS_OFFLINE_MESSAGE = 'Conectate para ver tu progreso';

// Both hooks refetch on focus (not just mount) so returning from a finished session shows it.
// A request counter ensures an older in-flight fetch never overwrites newer state.
export function useProgressSummary(userId: string | undefined) {
  const [summaries, setSummaries] = useState<ExerciseSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refetch = useCallback(async () => {
    if (!userId) return;
    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = summarizeExercises(await listExerciseSetHistory(supabase, userId));
      if (requestId === latestRequest.current) setSummaries(result);
    } catch {
      if (requestId === latestRequest.current) setError(PROGRESS_OFFLINE_MESSAGE);
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { summaries, isLoading, error, refetch };
}

export function useExerciseProgress(userId: string | undefined, exerciseId: string | undefined) {
  const [rows, setRows] = useState<ExerciseSetRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refetch = useCallback(async () => {
    if (!userId || !exerciseId) return;
    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await listExerciseSetHistory(supabase, userId, exerciseId);
      if (requestId === latestRequest.current) setRows(result);
    } catch {
      if (requestId === latestRequest.current) setError(PROGRESS_OFFLINE_MESSAGE);
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, [userId, exerciseId]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { rows, isLoading, error, refetch };
}
