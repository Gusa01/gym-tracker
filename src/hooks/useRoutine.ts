import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getRoutine } from '../lib/routines/queries';
import { Routine } from '../lib/routines/types';

export function useRoutine(routineId: string | undefined) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!routineId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getRoutine(supabase, routineId);
      setRoutine(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la rutina.');
    } finally {
      setIsLoading(false);
    }
  }, [routineId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { routine, isLoading, error, refetch };
}
