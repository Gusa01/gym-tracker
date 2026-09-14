import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listDayExercises } from '../lib/routines/queries';
import { RoutineExerciseWithName } from '../lib/routines/types';

export function useDayExercises(dayId: string | undefined) {
  const [exercises, setExercises] = useState<RoutineExerciseWithName[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!dayId) return;
    setIsLoading(true);
    const data = await listDayExercises(supabase, dayId);
    setExercises(data);
    setIsLoading(false);
  }, [dayId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { exercises, isLoading, refetch };
}
