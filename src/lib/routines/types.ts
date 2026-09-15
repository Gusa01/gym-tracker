export interface Routine {
  id: string;
  user_id: string;
  name: string;
  uses_top_set_backoff: boolean;
  suggested_duration_weeks: number | null;
  next_routine_id: string | null;
  weekday_schedule: Record<string, unknown>;
  is_active: boolean;
  started_at: string | null;
  is_deleted: boolean;
  created_at: string;
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface RoutineDay {
  id: string;
  routine_id: string;
  name: string;
  order_index: number;
  is_rest_day: boolean;
  is_deleted: boolean;
}

export interface Exercise {
  id: string;
  name: string;
  muscle_group: string;
}

export type RoutineExerciseRole = 'main' | 'accessory' | 'core';
export type RoutineExerciseSchemeType = 'normal' | 'top_set_backoff';
export type RoutineExerciseRepUnit = 'reps' | 'seconds';

export interface RoutineExercise {
  id: string;
  routine_day_id: string;
  exercise_id: string;
  order_index: number;
  role: RoutineExerciseRole;
  scheme_type: RoutineExerciseSchemeType;
  rep_unit: RoutineExerciseRepUnit;
  sets: number | null;
  rep_min: number | null;
  rep_max: number | null;
  rir_min: number | null;
  rir_max: number | null;
  top_set_reps: number | null;
  backoff_sets: number | null;
  backoff_rep_min: number | null;
  backoff_rep_max: number | null;
  is_deleted: boolean;
}

export interface RoutineExerciseWithName extends RoutineExercise {
  exercise_name: string;
}
