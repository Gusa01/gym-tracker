import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listRoutines } from '../lib/routines/queries';
import { Routine } from '../lib/routines/types';

export function useRoutines(userId: string | undefined) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    const data = await listRoutines(supabase, userId);
    setRoutines(data);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { routines, isLoading, refetch };
}
