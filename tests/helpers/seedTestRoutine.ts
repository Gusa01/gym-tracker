import { SupabaseClient } from '@supabase/supabase-js';

export async function seedTestRoutine(supabase: SupabaseClient, userId: string) {
  const suffix = Date.now() + Math.random();

  const { data: exercise, error: exerciseError } = await supabase
    .from('exercises')
    .insert({ name: `Test Exercise ${suffix}`, muscle_group: 'legs' })
    .select()
    .single();
  if (exerciseError) throw exerciseError;

  const { data: routine, error: routineError } = await supabase
    .from('routines')
    .insert({ user_id: userId, name: `Test Routine ${suffix}`, uses_top_set_backoff: false })
    .select()
    .single();
  if (routineError) throw routineError;

  const { data: day, error: dayError } = await supabase
    .from('routine_days')
    .insert({ routine_id: routine.id, name: 'Día Test', order_index: 0 })
    .select()
    .single();
  if (dayError) throw dayError;

  const { data: routineExercise, error: routineExerciseError } = await supabase
    .from('routine_exercises')
    .insert({
      routine_day_id: day.id,
      exercise_id: exercise.id,
      order_index: 0,
      role: 'main',
      scheme_type: 'normal',
      sets: 3,
      rep_min: 8,
      rep_max: 10,
      rir_min: 2,
      rir_max: 3,
    })
    .select()
    .single();
  if (routineExerciseError) throw routineExerciseError;

  return { exercise, routine, day, routineExercise };
}

/**
 * Mirrors seedTestRoutine, but issues every insert via the given (already
 * signed-in) client instead of an admin/service-role client, so that each
 * table's `*_owner_insert` RLS policy is actually exercised by a real
 * authenticated request rather than bypassed.
 */
export async function seedTestRoutineAsUser(supabase: SupabaseClient, userId: string) {
  const suffix = Date.now() + Math.random();

  const { data: exercise, error: exerciseError } = await supabase
    .from('exercises')
    .insert({ name: `Test Exercise (user) ${suffix}`, muscle_group: 'legs' })
    .select()
    .single();
  if (exerciseError) throw exerciseError;

  const { data: routine, error: routineError } = await supabase
    .from('routines')
    .insert({ user_id: userId, name: `Test Routine (user) ${suffix}`, uses_top_set_backoff: false })
    .select()
    .single();
  if (routineError) throw routineError;

  const { data: day, error: dayError } = await supabase
    .from('routine_days')
    .insert({ routine_id: routine.id, name: 'Día Test', order_index: 0 })
    .select()
    .single();
  if (dayError) throw dayError;

  const { data: routineExercise, error: routineExerciseError } = await supabase
    .from('routine_exercises')
    .insert({
      routine_day_id: day.id,
      exercise_id: exercise.id,
      order_index: 0,
      role: 'main',
      scheme_type: 'normal',
      sets: 3,
      rep_min: 8,
      rep_max: 10,
      rir_min: 2,
      rir_max: 3,
    })
    .select()
    .single();
  if (routineExerciseError) throw routineExerciseError;

  return { exercise, routine, day, routineExercise };
}
