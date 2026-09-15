import { SupabaseClient } from '@supabase/supabase-js';
import { RoutineExerciseWithName } from '../routines/types';
import { hasConsecutiveDeficit } from './deload';
import { shouldSuggestRoutineSwitch, RoutineScheduleFields } from './routineSwitch';
import { listRecentTopSets } from './queries';

export interface Suggestions {
  deloadExerciseName: string | null;
  routineSwitchAvailable: boolean;
}

export async function computeSuggestions(
  supabase: SupabaseClient,
  topSetExercises: RoutineExerciseWithName[],
  routine: RoutineScheduleFields,
  now: Date
): Promise<Suggestions> {
  let deloadExerciseName: string | null = null;

  for (const exercise of topSetExercises) {
    const recentTopSets = await listRecentTopSets(supabase, exercise.id).catch(() => []);
    if (hasConsecutiveDeficit(recentTopSets, exercise.top_set_reps ?? 0, exercise.rir_min)) {
      deloadExerciseName = exercise.exercise_name;
      break;
    }
  }

  return {
    deloadExerciseName,
    routineSwitchAvailable: shouldSuggestRoutineSwitch(routine, now),
  };
}
