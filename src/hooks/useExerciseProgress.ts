import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { listExerciseSetHistory } from '../lib/progress/queries';
import { summarizeExercises } from '../lib/progress/summary';
import { ExerciseSetRow, ExerciseSummary } from '../lib/progress/types';

export const PROGRESS_OFFLINE_MESSAGE = 'Conectate para ver tu progreso';

// Both hooks refetch on focus (not just mount) so returning from a finished session shows it.
export function useProgressSummary(userId: string | undefined) {
  const [summaries, setSummaries] = useState<ExerciseSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);
    try {
      setSummaries(summarizeExercises(await listExerciseSetHistory(supabase, userId)));
    } catch {
      setError(PROGRESS_OFFLINE_MESSAGE);
    } finally {
      setIsLoading(false);
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

  const refetch = useCallback(async () => {
    if (!userId || !exerciseId) return;
    setIsLoading(true);
    setError(null);
    try {
      setRows(await listExerciseSetHistory(supabase, userId, exerciseId));
    } catch {
      setError(PROGRESS_OFFLINE_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, [userId, exerciseId]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { rows, isLoading, error, refetch };
}
