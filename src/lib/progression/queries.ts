import { SupabaseClient } from '@supabase/supabase-js';
import { LoggedSet } from '../sessions/types';

// Re-exported so callers (and the Task 4 test suite) can import both query and
// mutation functions from a single module path; the canonical implementation
// lives in ./mutations.ts per the task brief's file structure.
export { recordDeload } from './mutations';

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
