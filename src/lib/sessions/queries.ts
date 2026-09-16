import { SupabaseClient } from '@supabase/supabase-js';
import { Routine } from '../routines/types';
import { WorkoutSession, LoggedSet } from './types';

export async function getActiveRoutine(supabase: SupabaseClient, userId: string): Promise<Routine | null> {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getSessionForDate(
  supabase: SupabaseClient,
  userId: string,
  dayId: string,
  sessionDate: string
): Promise<WorkoutSession | null> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('routine_day_id', dayId)
    .eq('session_date', sessionDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listSessionSets(supabase: SupabaseClient, sessionId: string): Promise<LoggedSet[]> {
  const { data, error } = await supabase
    .from('logged_sets')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function listRecentCompletedSessions(
  supabase: SupabaseClient,
  userId: string,
  limit = 30
): Promise<{ sessionDate: string; dayName: string }[]> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('session_date, routine_days(name)')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('session_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as any[]).map((row) => ({
    sessionDate: row.session_date,
    dayName: row.routine_days?.name ?? '',
  }));
}
