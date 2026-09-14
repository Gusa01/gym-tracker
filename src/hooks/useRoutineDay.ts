import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getRoutineDay } from '../lib/routines/queries';
import { RoutineDay } from '../lib/routines/types';

export function useRoutineDay(dayId: string | undefined) {
  const [day, setDay] = useState<RoutineDay | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!dayId) return;
    setIsLoading(true);
    const data = await getRoutineDay(supabase, dayId);
    setDay(data);
    setIsLoading(false);
  }, [dayId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { day, isLoading, refetch };
}
