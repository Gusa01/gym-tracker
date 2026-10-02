import { SupabaseClient } from '@supabase/supabase-js';
import { ExerciseSetRow } from './types';

// PostgREST caps every response at 1000 rows (hosted default and supabase/config.toml max_rows)
// and truncates silently, so read the view page by page until a short page comes back.
const PAGE_SIZE = 1000;

export async function listExerciseSetHistory(
  supabase: SupabaseClient,
  userId: string,
  exerciseId?: string
): Promise<ExerciseSetRow[]> {
  const rows: ExerciseSetRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from('exercise_set_history').select('*').eq('user_id', userId);
    if (exerciseId) query = query.eq('exercise_id', exerciseId);
    const { data, error } = await query
      .order('session_date')
      .order('logged_set_id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []).map(
      (raw): ExerciseSetRow => ({
        ...raw,
        weight: Number(raw.weight),
        reps: Number(raw.reps),
        set_index: Number(raw.set_index),
      })
    );
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
