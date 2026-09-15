import { RoutineExerciseWithName } from '../routines/types';
import { SetType } from './types';

export interface PrescribedSet {
  setIndex: number;
  setType: SetType;
}

export function buildPrescribedSets(exercise: {
  scheme_type: 'normal' | 'top_set_backoff';
  sets: number | null;
  backoff_sets: number | null;
}): PrescribedSet[] {
  if (exercise.scheme_type === 'top_set_backoff') {
    const backoffCount = exercise.backoff_sets ?? 0;
    const result: PrescribedSet[] = [{ setIndex: 1, setType: 'top_set' }];
    for (let i = 0; i < backoffCount; i++) {
      result.push({ setIndex: i + 2, setType: 'back_off' });
    }
    return result;
  }
  const setCount = exercise.sets ?? 0;
  const result: PrescribedSet[] = [];
  for (let i = 0; i < setCount; i++) {
    result.push({ setIndex: i + 1, setType: 'working' });
  }
  return result;
}

export function formatTargetScheme(exercise: RoutineExerciseWithName): string {
  const unit = exercise.rep_unit === 'seconds' ? 's' : '';
  const rir =
    exercise.rir_min !== null && exercise.rir_max !== null
      ? ` @ RIR ${exercise.rir_min}-${exercise.rir_max}`
      : '';
  if (exercise.scheme_type === 'top_set_backoff') {
    return `Top set 1×${exercise.top_set_reps} + Back-off ${exercise.backoff_sets}×${exercise.backoff_rep_min}-${exercise.backoff_rep_max}${unit}${rir}`;
  }
  return `${exercise.sets}×${exercise.rep_min}-${exercise.rep_max}${unit}${rir}`;
}
