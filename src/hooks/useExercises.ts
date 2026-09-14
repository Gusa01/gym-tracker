import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listExercises } from '../lib/routines/queries';
import { Exercise } from '../lib/routines/types';

export function useExercises() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const data = await listExercises(supabase);
    setExercises(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { exercises, isLoading, refetch };
}
