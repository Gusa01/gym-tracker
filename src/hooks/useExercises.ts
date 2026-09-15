import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listExercises } from '../lib/routines/queries';
import { Exercise } from '../lib/routines/types';

export function useExercises() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listExercises(supabase);
      setExercises(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los ejercicios.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { exercises, isLoading, error, refetch };
}
