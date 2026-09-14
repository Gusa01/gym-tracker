import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listRoutineDays } from '../lib/routines/queries';
import { RoutineDay } from '../lib/routines/types';

export function useRoutineDays(routineId: string | undefined) {
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!routineId) return;
    setIsLoading(true);
    const data = await listRoutineDays(supabase, routineId);
    setDays(data);
    setIsLoading(false);
  }, [routineId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { days, isLoading, refetch };
}
