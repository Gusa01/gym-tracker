import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listRoutineDays } from '../lib/routines/queries';
import { RoutineDay } from '../lib/routines/types';

export function useRoutineDays(routineId: string | undefined) {
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!routineId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await listRoutineDays(supabase, routineId);
      setDays(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los días.');
    } finally {
      setIsLoading(false);
    }
  }, [routineId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { days, isLoading, error, refetch };
}
