import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getRoutine } from '../lib/routines/queries';
import { Routine } from '../lib/routines/types';

export function useRoutine(routineId: string | undefined) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!routineId) return;
    setIsLoading(true);
    const data = await getRoutine(supabase, routineId);
    setRoutine(data);
    setIsLoading(false);
  }, [routineId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { routine, isLoading, refetch };
}
