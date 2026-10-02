import { SQLiteDatabase } from 'expo-sqlite';
import { SupabaseClient } from '@supabase/supabase-js';
import { getActiveRoutine } from '../sessions/queries';
import { listRoutineDays, listDayExercises } from '../routines/queries';
import { RoutineExerciseWithName } from '../routines/types';
import { computeWeekNumber, weekdayFromDate, resolveTodayDayId } from '../sessions/weekResolution';
import { listExerciseSetHistory } from '../progress/queries';
import { mergeCachedRecords, recordsByExercise } from '../progress/records';
import { CachedRecords } from '../progress/types';

export interface CachedRoutine {
  id: string;
  name: string;
  uses_top_set_backoff: boolean;
  suggested_duration_weeks: number | null;
  next_routine_id: string | null;
  weekday_schedule: Record<string, unknown>;
  is_active: boolean;
  started_at: string | null;
}

export interface CachedRoutineDay {
  id: string;
  routine_id: string;
  name: string;
  order_index: number;
  is_rest_day: boolean;
}

export type CachedRoutineExercise = RoutineExerciseWithName;

export interface CachedUserExerciseState {
  exercise_id: string;
  current_weight: number | null;
  suggested_next_weight: number | null;
  consecutive_hit_count: number;
  consecutive_miss_count: number;
}

export async function refreshLocalCache(
  db: SQLiteDatabase,
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const routine = await getActiveRoutine(supabase, userId);
  const days = routine ? await listRoutineDays(supabase, routine.id) : [];
  const exercisesByDay = await Promise.all(days.map((day) => listDayExercises(supabase, day.id)));
  const { data: states, error: statesError } = await supabase
    .from('user_exercise_state')
    .select('exercise_id, current_weight, suggested_next_weight, consecutive_hit_count, consecutive_miss_count')
    .eq('user_id', userId);
  if (statesError) throw statesError;

  // A history failure must not block the routine cache refresh; it just leaves the
  // previous records snapshot in place for live PR detection.
  const history = await listExerciseSetHistory(supabase, userId).catch((err) => {
    console.warn('Could not refresh exercise records cache', err);
    return null;
  });

  db.withTransactionSync(() => {
    db.runSync('delete from routines_cache');
    db.runSync('delete from routine_days_cache');
    db.runSync('delete from routine_exercises_cache');
    db.runSync('delete from user_exercise_state_cache');

    if (history) {
      db.runSync('delete from exercise_records_cache');
      recordsByExercise(history).forEach((records, exerciseId) => writeExerciseRecords(db, exerciseId, records));
    }

    if (!routine) return;

    db.runSync(
      `insert into routines_cache
         (id, name, uses_top_set_backoff, suggested_duration_weeks, next_routine_id, weekday_schedule, is_active, started_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        routine.id,
        routine.name,
        routine.uses_top_set_backoff ? 1 : 0,
        routine.suggested_duration_weeks,
        routine.next_routine_id,
        JSON.stringify(routine.weekday_schedule),
        routine.is_active ? 1 : 0,
        routine.started_at,
      ]
    );

    days.forEach((day) => {
      db.runSync(
        'insert into routine_days_cache (id, routine_id, name, order_index, is_rest_day) values (?, ?, ?, ?, ?)',
        [day.id, day.routine_id, day.name, day.order_index, day.is_rest_day ? 1 : 0]
      );
    });

    exercisesByDay.flat().forEach((exercise) => {
      db.runSync(
        `insert into routine_exercises_cache
           (id, routine_day_id, exercise_id, exercise_name, order_index, role, scheme_type, rep_unit,
            sets, rep_min, rep_max, rir_min, rir_max, top_set_reps, backoff_sets, backoff_rep_min, backoff_rep_max,
            muscle_group)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          exercise.id,
          exercise.routine_day_id,
          exercise.exercise_id,
          exercise.exercise_name,
          exercise.order_index,
          exercise.role,
          exercise.scheme_type,
          exercise.rep_unit,
          exercise.sets,
          exercise.rep_min,
          exercise.rep_max,
          exercise.rir_min,
          exercise.rir_max,
          exercise.top_set_reps,
          exercise.backoff_sets,
          exercise.backoff_rep_min,
          exercise.backoff_rep_max,
          exercise.muscle_group ?? null,
        ]
      );
    });

    (states ?? []).forEach((state) => {
      db.runSync(
        `insert into user_exercise_state_cache
           (exercise_id, current_weight, suggested_next_weight, consecutive_hit_count, consecutive_miss_count)
         values (?, ?, ?, ?, ?)`,
        [
          state.exercise_id,
          state.current_weight,
          state.suggested_next_weight,
          state.consecutive_hit_count,
          state.consecutive_miss_count,
        ]
      );
    });
  });
}

export function getCachedActiveRoutine(db: SQLiteDatabase): CachedRoutine | null {
  const row = db.getAllSync<{
    id: string;
    name: string;
    uses_top_set_backoff: number;
    suggested_duration_weeks: number | null;
    next_routine_id: string | null;
    weekday_schedule: string;
    is_active: number;
    started_at: string | null;
  }>('select * from routines_cache limit 1')[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    uses_top_set_backoff: row.uses_top_set_backoff === 1,
    suggested_duration_weeks: row.suggested_duration_weeks,
    next_routine_id: row.next_routine_id,
    weekday_schedule: JSON.parse(row.weekday_schedule),
    is_active: row.is_active === 1,
    started_at: row.started_at,
  };
}

export function getCachedRoutineDays(db: SQLiteDatabase, routineId: string): CachedRoutineDay[] {
  const rows = db.getAllSync<{
    id: string;
    routine_id: string;
    name: string;
    order_index: number;
    is_rest_day: number;
  }>('select * from routine_days_cache where routine_id = ? order by order_index', [routineId]);
  return rows.map((row) => ({ ...row, is_rest_day: row.is_rest_day === 1 }));
}

export function getCachedDayExercises(db: SQLiteDatabase, dayId: string): CachedRoutineExercise[] {
  return db.getAllSync<CachedRoutineExercise>(
    'select * from routine_exercises_cache where routine_day_id = ? order by order_index',
    [dayId]
  );
}

export function getCachedExerciseState(db: SQLiteDatabase, exerciseId: string): CachedUserExerciseState | null {
  const rows = db.getAllSync<CachedUserExerciseState>(
    'select * from user_exercise_state_cache where exercise_id = ?',
    [exerciseId]
  );
  return rows[0] ?? null;
}

export function getCachedExerciseRecords(db: SQLiteDatabase, exerciseId: string): CachedRecords | null {
  const rows = db.getAllSync<CachedRecords>(
    'select best_e1rm, best_weight, best_seconds, best_reps from exercise_records_cache where exercise_id = ?',
    [exerciseId]
  );
  return rows[0] ?? null;
}

function writeExerciseRecords(db: SQLiteDatabase, exerciseId: string, records: CachedRecords): void {
  db.runSync(
    `insert or replace into exercise_records_cache (exercise_id, best_e1rm, best_weight, best_seconds, best_reps)
     values (?, ?, ?, ?, ?)`,
    [exerciseId, records.best_e1rm, records.best_weight, records.best_seconds, records.best_reps]
  );
}

/** Folds a just-finished session's bests into the cache, so offline sessions compare against them. */
export function mergeCachedExerciseRecords(db: SQLiteDatabase, exerciseId: string, sessionBests: CachedRecords): void {
  writeExerciseRecords(db, exerciseId, mergeCachedRecords(getCachedExerciseRecords(db, exerciseId), sessionBests));
}

export interface ResolvedToday {
  routine: CachedRoutine;
  weekNumber: number;
  day: CachedRoutineDay | null;
}

export function resolveToday(db: SQLiteDatabase, today: Date = new Date()): ResolvedToday | null {
  const routine = getCachedActiveRoutine(db);
  if (!routine || !routine.started_at) return null;

  const weekNumber = computeWeekNumber(routine.started_at, today);
  const dayId = resolveTodayDayId(routine.weekday_schedule, weekdayFromDate(today), weekNumber);
  if (!dayId) return { routine, weekNumber, day: null };

  const days = getCachedRoutineDays(db, routine.id);
  const day = days.find((d) => d.id === dayId) ?? null;
  return { routine, weekNumber, day };
}
