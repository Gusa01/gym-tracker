import { SupabaseClient } from '@supabase/supabase-js';
import { LoggedSet } from '../sessions/types';
import { HistoryExercise, HistorySessionRow, SessionDetail } from './types';
import { summarizeSession } from './logic';

export const HISTORY_PAGE_SIZE = 30;

export async function listCompletedSessions(
  supabase: SupabaseClient,
  userId: string,
  page: number
): Promise<{ sessions: HistorySessionRow[]; hasMore: boolean }> {
  const from = page * HISTORY_PAGE_SIZE;
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id, session_date, routine_days(name), logged_sets(routine_exercise_id, is_deleted)')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('session_date', { ascending: false })
    .order('id')
    .range(from, from + HISTORY_PAGE_SIZE - 1);
  if (error) throw error;

  const sessions = (data as any[]).map((row): HistorySessionRow => ({
    id: row.id,
    sessionDate: row.session_date,
    dayName: row.routine_days?.name ?? '',
    ...summarizeSession(row.logged_sets ?? []),
  }));
  return { sessions, hasMore: sessions.length === HISTORY_PAGE_SIZE };
}

export async function getSessionDetail(supabase: SupabaseClient, sessionId: string): Promise<SessionDetail> {
  const { data: session, error: sessionError } = await supabase
    .from('workout_sessions')
    .select('id, session_date, routine_days(name)')
    .eq('id', sessionId)
    .single();
  if (sessionError) throw sessionError;

  const { data: sets, error: setsError } = await supabase
    .from('logged_sets')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_deleted', false)
    .order('set_index');
  if (setsError) throw setsError;

  const exerciseIds = [...new Set((sets ?? []).map((s) => s.routine_exercise_id as string))];
  let exercises: HistoryExercise[] = [];
  if (exerciseIds.length > 0) {
    // No is_deleted filter: the history shows exercises later removed from the routine.
    const { data, error } = await supabase
      .from('routine_exercises')
      .select('id, order_index, scheme_type, rep_unit, rir_min, exercises(name)')
      .in('id', exerciseIds);
    if (error) throw error;
    exercises = (data as any[]).map((e) => ({
      id: e.id,
      exercise_name: e.exercises?.name ?? '',
      order_index: e.order_index,
      scheme_type: e.scheme_type,
      rep_unit: e.rep_unit,
      rir_min: e.rir_min,
    }));
  }

  return {
    id: session.id,
    sessionDate: session.session_date,
    dayName: (session as any).routine_days?.name ?? '',
    sets: (sets ?? []).map((s) => ({ ...s, weight: Number(s.weight), reps: Number(s.reps) }) as LoggedSet),
    exercises,
  };
}
