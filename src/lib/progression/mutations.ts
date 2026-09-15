import { SupabaseClient } from '@supabase/supabase-js';

export async function recordDeload(supabase: SupabaseClient, userId: string, routineId: string): Promise<void> {
  const { error } = await supabase
    .from('routine_history')
    .insert({ user_id: userId, routine_id: routineId, event_type: 'deload' });
  if (error) throw error;
}
