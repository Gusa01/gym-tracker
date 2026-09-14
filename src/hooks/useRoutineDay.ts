import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getRoutineDay } from '../lib/routines/queries';
import { RoutineDay } from '../lib/routines/types';

export function useRoutineDay(dayId: string | undefined) {
  const [day, setDay] = useState<RoutineDay | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!dayId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getRoutineDay(supabase, dayId);
      setDay(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el día.');
    } finally {
      setIsLoading(false);
    }
  }, [dayId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { day, isLoading, error, refetch };
}
