import { SupabaseClient } from '@supabase/supabase-js';
import {
  Routine,
  RoutineDay,
  RoutineExercise,
  Exercise,
  RoutineExerciseRole,
  RoutineExerciseSchemeType,
  RoutineExerciseRepUnit,
} from './types';

export interface CreateRoutineInput {
  name: string;
  usesTopSetBackoff: boolean;
  suggestedDurationWeeks: number | null;
  nextRoutineId: string | null;
}

export async function createRoutine(
  supabase: SupabaseClient,
  userId: string,
  input: CreateRoutineInput
): Promise<Routine> {
  const { data, error } = await supabase
    .from('routines')
    .insert({
      user_id: userId,
      name: input.name,
      uses_top_set_backoff: input.usesTopSetBackoff,
      suggested_duration_weeks: input.suggestedDurationWeeks,
      next_routine_id: input.nextRoutineId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoutine(
  supabase: SupabaseClient,
  routineId: string,
  patch: Partial<CreateRoutineInput>
): Promise<Routine> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.usesTopSetBackoff !== undefined) update.uses_top_set_backoff = patch.usesTopSetBackoff;
  if (patch.suggestedDurationWeeks !== undefined)
    update.suggested_duration_weeks = patch.suggestedDurationWeeks;
  if (patch.nextRoutineId !== undefined) update.next_routine_id = patch.nextRoutineId;

  const { data, error } = await supabase
    .from('routines')
    .update(update)
    .eq('id', routineId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteRoutine(supabase: SupabaseClient, routineId: string): Promise<void> {
  const { data: days, error: daysFetchError } = await supabase
    .from('routine_days')
    .select('id')
    .eq('routine_id', routineId);
  if (daysFetchError) throw daysFetchError;

  const dayIds = (days ?? []).map((d: { id: string }) => d.id);
  if (dayIds.length > 0) {
    const { error: exercisesError } = await supabase
      .from('routine_exercises')
      .update({ is_deleted: true })
      .in('routine_day_id', dayIds);
    if (exercisesError) throw exercisesError;
  }

  const { error: daysError } = await supabase
    .from('routine_days')
    .update({ is_deleted: true })
    .eq('routine_id', routineId);
  if (daysError) throw daysError;

  const { error: routineError } = await supabase
    .from('routines')
    .update({ is_deleted: true, is_active: false })
    .eq('id', routineId);
  if (routineError) throw routineError;
}

export async function activateRoutine(
  supabase: SupabaseClient,
  userId: string,
  routineId: string
): Promise<void> {
  const { error: deactivateError } = await supabase
    .from('routines')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);
  if (deactivateError) throw deactivateError;

  const { error: activateError } = await supabase
    .from('routines')
    .update({ is_active: true, started_at: new Date().toISOString() })
    .eq('id', routineId);
  if (activateError) throw activateError;

  const { error: historyError } = await supabase
    .from('routine_history')
    .insert({ user_id: userId, routine_id: routineId, event_type: 'started' });
  if (historyError) throw historyError;
}

export interface CreateDayInput {
  name: string;
  isRestDay: boolean;
}

export async function createDay(
  supabase: SupabaseClient,
  routineId: string,
  input: CreateDayInput
): Promise<RoutineDay> {
  const { data: existing, error: fetchError } = await supabase
    .from('routine_days')
    .select('order_index')
    .eq('routine_id', routineId)
    .eq('is_deleted', false)
    .order('order_index', { ascending: false })
    .limit(1);
  if (fetchError) throw fetchError;
  const nextOrderIndex = existing && existing.length > 0 ? existing[0].order_index + 1 : 0;

  const { data, error } = await supabase
    .from('routine_days')
    .insert({
      routine_id: routineId,
      name: input.name,
      is_rest_day: input.isRestDay,
      order_index: nextOrderIndex,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDay(
  supabase: SupabaseClient,
  dayId: string,
  patch: Partial<CreateDayInput>
): Promise<RoutineDay> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.isRestDay !== undefined) update.is_rest_day = patch.isRestDay;

  const { data, error } = await supabase
    .from('routine_days')
    .update(update)
    .eq('id', dayId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteDay(supabase: SupabaseClient, dayId: string): Promise<void> {
  const { error: exercisesError } = await supabase
    .from('routine_exercises')
    .update({ is_deleted: true })
    .eq('routine_day_id', dayId);
  if (exercisesError) throw exercisesError;

  const { error: dayError } = await supabase
    .from('routine_days')
    .update({ is_deleted: true })
    .eq('id', dayId);
  if (dayError) throw dayError;
}

export async function moveDay(
  supabase: SupabaseClient,
  routineId: string,
  dayId: string,
  direction: 'up' | 'down'
): Promise<void> {
  const { data, error } = await supabase
    .from('routine_days')
    .select('id, order_index')
    .eq('routine_id', routineId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  const days = data ?? [];

  const index = days.findIndex((d: { id: string }) => d.id === dayId);
  const swapWithIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || swapWithIndex < 0 || swapWithIndex >= days.length) return;

  const current = days[index];
  const swapWith = days[swapWithIndex];

  const { error: error1 } = await supabase
    .from('routine_days')
    .update({ order_index: swapWith.order_index })
    .eq('id', current.id);
  if (error1) throw error1;

  const { error: error2 } = await supabase
    .from('routine_days')
    .update({ order_index: current.order_index })
    .eq('id', swapWith.id);
  if (error2) throw error2;
}

export interface CreateRoutineExerciseInput {
  exerciseId: string;
  role: RoutineExerciseRole;
  schemeType: RoutineExerciseSchemeType;
  repUnit: RoutineExerciseRepUnit;
  sets: number | null;
  repMin: number | null;
  repMax: number | null;
  rirMin: number | null;
  rirMax: number | null;
  topSetReps: number | null;
  backoffSets: number | null;
  backoffRepMin: number | null;
  backoffRepMax: number | null;
}

export async function createRoutineExercise(
  supabase: SupabaseClient,
  dayId: string,
  input: CreateRoutineExerciseInput
): Promise<RoutineExercise> {
  const { data: existing, error: fetchError } = await supabase
    .from('routine_exercises')
    .select('order_index')
    .eq('routine_day_id', dayId)
    .eq('is_deleted', false)
    .order('order_index', { ascending: false })
    .limit(1);
  if (fetchError) throw fetchError;
  const nextOrderIndex = existing && existing.length > 0 ? existing[0].order_index + 1 : 0;

  const { data, error } = await supabase
    .from('routine_exercises')
    .insert({
      routine_day_id: dayId,
      exercise_id: input.exerciseId,
      order_index: nextOrderIndex,
      role: input.role,
      scheme_type: input.schemeType,
      rep_unit: input.repUnit,
      sets: input.sets,
      rep_min: input.repMin,
      rep_max: input.repMax,
      rir_min: input.rirMin,
      rir_max: input.rirMax,
      top_set_reps: input.topSetReps,
      backoff_sets: input.backoffSets,
      backoff_rep_min: input.backoffRepMin,
      backoff_rep_max: input.backoffRepMax,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoutineExercise(
  supabase: SupabaseClient,
  routineExerciseId: string,
  patch: Partial<CreateRoutineExerciseInput>
): Promise<RoutineExercise> {
  const update: Record<string, unknown> = {};
  if (patch.exerciseId !== undefined) update.exercise_id = patch.exerciseId;
  if (patch.role !== undefined) update.role = patch.role;
  if (patch.schemeType !== undefined) update.scheme_type = patch.schemeType;
  if (patch.repUnit !== undefined) update.rep_unit = patch.repUnit;
  if (patch.sets !== undefined) update.sets = patch.sets;
  if (patch.repMin !== undefined) update.rep_min = patch.repMin;
  if (patch.repMax !== undefined) update.rep_max = patch.repMax;
  if (patch.rirMin !== undefined) update.rir_min = patch.rirMin;
  if (patch.rirMax !== undefined) update.rir_max = patch.rirMax;
  if (patch.topSetReps !== undefined) update.top_set_reps = patch.topSetReps;
  if (patch.backoffSets !== undefined) update.backoff_sets = patch.backoffSets;
  if (patch.backoffRepMin !== undefined) update.backoff_rep_min = patch.backoffRepMin;
  if (patch.backoffRepMax !== undefined) update.backoff_rep_max = patch.backoffRepMax;

  const { data, error } = await supabase
    .from('routine_exercises')
    .update(update)
    .eq('id', routineExerciseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteRoutineExercise(
  supabase: SupabaseClient,
  routineExerciseId: string
): Promise<void> {
  const { error } = await supabase
    .from('routine_exercises')
    .update({ is_deleted: true })
    .eq('id', routineExerciseId);
  if (error) throw error;
}

export async function moveRoutineExercise(
  supabase: SupabaseClient,
  dayId: string,
  routineExerciseId: string,
  direction: 'up' | 'down'
): Promise<void> {
  const { data, error } = await supabase
    .from('routine_exercises')
    .select('id, order_index')
    .eq('routine_day_id', dayId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  const items = data ?? [];

  const index = items.findIndex((e: { id: string }) => e.id === routineExerciseId);
  const swapWithIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || swapWithIndex < 0 || swapWithIndex >= items.length) return;

  const current = items[index];
  const swapWith = items[swapWithIndex];

  const { error: error1 } = await supabase
    .from('routine_exercises')
    .update({ order_index: swapWith.order_index })
    .eq('id', current.id);
  if (error1) throw error1;

  const { error: error2 } = await supabase
    .from('routine_exercises')
    .update({ order_index: current.order_index })
    .eq('id', swapWith.id);
  if (error2) throw error2;
}

export async function findOrCreateExercise(
  supabase: SupabaseClient,
  name: string,
  muscleGroup: string
): Promise<Exercise> {
  const { data: existing, error: existingError } = await supabase
    .from('exercises')
    .select('*')
    .eq('name', name)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from('exercises')
    .insert({ name, muscle_group: muscleGroup })
    .select()
    .single();
  if (createError) throw createError;
  return created;
}
