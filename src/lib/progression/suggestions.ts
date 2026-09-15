import { SupabaseClient } from '@supabase/supabase-js';
import { RoutineExerciseWithName } from '../routines/types';
import { hasConsecutiveDeficit } from './deload';
import { shouldSuggestRoutineSwitch, RoutineScheduleFields } from './routineSwitch';
import { listRecentTopSets, getLatestDeloadEvent } from './queries';

export interface Suggestions {
  deloadExerciseName: string | null;
  routineSwitchAvailable: boolean;
}

export async function computeSuggestions(
  supabase: SupabaseClient,
  topSetExercises: RoutineExerciseWithName[],
  routine: RoutineScheduleFields,
  routineId: string,
  now: Date
): Promise<Suggestions> {
  const latestDeloadAt = await getLatestDeloadEvent(supabase, routineId);

  const deficitNames = await Promise.all(
    topSetExercises.map(async (exercise) => {
      const recentTopSets = await listRecentTopSets(supabase, exercise.id);
      if (!hasConsecutiveDeficit(recentTopSets, exercise.top_set_reps ?? 0, exercise.rir_min)) {
        return null;
      }
      const mostRecentSessionAt = recentTopSets[0]?.created_at;
      if (latestDeloadAt && mostRecentSessionAt && mostRecentSessionAt <= latestDeloadAt) {
        // Already accepted a deload after this exact pair of sessions — don't nag again
        // until a new session makes the pair stale.
        return null;
      }
      return exercise.exercise_name;
    })
  );

  return {
    deloadExerciseName: deficitNames.find((name): name is string => name !== null) ?? null,
    routineSwitchAvailable: shouldSuggestRoutineSwitch(routine, now),
  };
}
