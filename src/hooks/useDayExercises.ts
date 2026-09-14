import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listDayExercises } from '../lib/routines/queries';
import { RoutineExerciseWithName } from '../lib/routines/types';

export function useDayExercises(dayId: string | undefined) {
  const [exercises, setExercises] = useState<RoutineExerciseWithName[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!dayId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await listDayExercises(supabase, dayId);
      setExercises(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los ejercicios.');
    } finally {
      setIsLoading(false);
    }
  }, [dayId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { exercises, isLoading, error, refetch };
}
