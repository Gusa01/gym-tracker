import { SupabaseClient } from '@supabase/supabase-js';
import { LoggedSet } from '../sessions/types';

export async function getLatestDeloadEvent(supabase: SupabaseClient, routineId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('routine_history')
    .select('occurred_at')
    .eq('routine_id', routineId)
    .eq('event_type', 'deload')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.occurred_at ?? null;
}

export async function listRecentTopSets(
  supabase: SupabaseClient,
  routineExerciseId: string,
  limit = 2
): Promise<LoggedSet[]> {
  const { data, error } = await supabase
    .from('logged_sets')
    .select('*, workout_sessions!inner(status)')
    .eq('routine_exercise_id', routineExerciseId)
    .eq('set_type', 'top_set')
    .eq('workout_sessions.status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as any[]).map(({ workout_sessions, ...rest }) => rest as LoggedSet);
}
