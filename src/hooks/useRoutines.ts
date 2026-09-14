import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listRoutines } from '../lib/routines/queries';
import { Routine } from '../lib/routines/types';

export function useRoutines(userId: string | undefined) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await listRoutines(supabase, userId);
      setRoutines(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las rutinas.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { routines, isLoading, error, refetch };
}
