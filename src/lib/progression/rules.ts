import { LoggedSet, SetType } from '../sessions/types';

export interface SchemeFields {
  scheme_type: 'normal' | 'top_set_backoff';
  rep_max: number | null;
  top_set_reps: number | null;
  backoff_rep_max: number | null;
  rir_min: number | null;
  rir_max: number | null;
}

export function getTargetRepsForSet(exercise: SchemeFields, setType: SetType): number {
  if (setType === 'top_set') return exercise.top_set_reps ?? 0;
  if (setType === 'back_off') return exercise.backoff_rep_max ?? 0;
  return exercise.rep_max ?? 0;
}

export function isSetHit(set: LoggedSet, exercise: SchemeFields): boolean {
  const target = getTargetRepsForSet(exercise, set.set_type);
  const repsOk = set.reps >= target;
  const rirOk =
    exercise.rir_min === null ||
    (set.rir !== null && set.rir >= exercise.rir_min && (exercise.rir_max === null || set.rir <= exercise.rir_max));
  return repsOk && rirOk;
}

export function isExerciseHit(sets: LoggedSet[], exercise: SchemeFields): boolean {
  return sets.length > 0 && sets.every((set) => isSetHit(set, exercise));
}

export function computeWeightIncrement(muscleGroup: string): number {
  if (muscleGroup === 'upper') return 1.25;
  if (muscleGroup === 'lower') return 2.5;
  return 0;
}

export interface ExerciseProgressUpdate {
  current_weight: number;
  suggested_next_weight: number;
  consecutive_hit_count: number;
  consecutive_miss_count: number;
}

export function computeNextExerciseState(
  current: { consecutive_hit_count: number; consecutive_miss_count: number } | null,
  weightUsed: number,
  hit: boolean,
  increment: number
): ExerciseProgressUpdate {
  if (hit) {
    return {
      current_weight: weightUsed,
      suggested_next_weight: weightUsed + increment,
      consecutive_hit_count: (current?.consecutive_hit_count ?? 0) + 1,
      consecutive_miss_count: 0,
    };
  }
  return {
    current_weight: weightUsed,
    suggested_next_weight: weightUsed,
    consecutive_hit_count: 0,
    consecutive_miss_count: (current?.consecutive_miss_count ?? 0) + 1,
  };
}
