import { SupabaseClient } from '@supabase/supabase-js';
import { Routine, RoutineDay, RoutineExerciseWithName, Exercise } from './types';

export async function listRoutines(supabase: SupabaseClient, userId: string): Promise<Routine[]> {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function getRoutine(
  supabase: SupabaseClient,
  routineId: string
): Promise<Routine | null> {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('id', routineId)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listRoutineDays(
  supabase: SupabaseClient,
  routineId: string
): Promise<RoutineDay[]> {
  const { data, error } = await supabase
    .from('routine_days')
    .select('*')
    .eq('routine_id', routineId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  return data;
}

export async function getRoutineDay(
  supabase: SupabaseClient,
  dayId: string
): Promise<RoutineDay | null> {
  const { data, error } = await supabase
    .from('routine_days')
    .select('*')
    .eq('id', dayId)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDayExercises(
  supabase: SupabaseClient,
  dayId: string
): Promise<RoutineExerciseWithName[]> {
  const { data, error } = await supabase
    .from('routine_exercises')
    .select('*, exercises(name, muscle_group)')
    .eq('routine_day_id', dayId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  return (data as any[]).map((row) => ({
    ...row,
    exercise_name: row.exercises.name,
    muscle_group: row.exercises.muscle_group,
  }));
}

export async function listExercises(supabase: SupabaseClient): Promise<Exercise[]> {
  const { data, error } = await supabase.from('exercises').select('*').order('name');
  if (error) throw error;
  return data;
}
