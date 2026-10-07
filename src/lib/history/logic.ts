import { RoutineExerciseRepUnit } from '../routines/types';
import { LoggedSet } from '../sessions/types';
import { ExerciseSetGroup, HistoryExercise, SetCorrection, SetEditValues } from './types';

const MAX_RIR = 10;

export function summarizeSession(
  sets: Array<{ routine_exercise_id: string; is_deleted?: boolean }>
): { exerciseCount: number; setCount: number } {
  const live = sets.filter((s) => !s.is_deleted);
  return { exerciseCount: new Set(live.map((s) => s.routine_exercise_id)).size, setCount: live.length };
}

export function groupSessionSets(sets: LoggedSet[], exercises: HistoryExercise[]): ExerciseSetGroup[] {
  return [...exercises]
    .sort((a, b) => a.order_index - b.order_index)
    .map((exercise) => ({
      exercise,
      sets: sets
        .filter((s) => s.routine_exercise_id === exercise.id && !s.is_deleted)
        .sort((a, b) => a.set_index - b.set_index),
    }))
    .filter((group) => group.sets.length > 0);
}

/** The first problem with the editor's values, in Spanish, or null when they are valid. */
export function validateSetEdit(
  values: SetEditValues,
  exercise: { rep_unit: RoutineExerciseRepUnit; rir_min: number | null }
): string | null {
  const timeBased = exercise.rep_unit === 'seconds';
  if (!timeBased) {
    const weight = Number(values.weight);
    if (values.weight.trim() === '' || !Number.isFinite(weight)) return 'Ingresá un peso válido.';
    if (weight < 0) return 'El peso no puede ser negativo.';
  }
  const reps = Number(values.reps);
  if (values.reps.trim() === '' || !Number.isInteger(reps) || reps < 1) {
    return timeBased
      ? 'Los segundos tienen que ser un número entero mayor a 0.'
      : 'Las reps tienen que ser un número entero mayor a 0.';
  }
  if (exercise.rir_min !== null) {
    if (values.rir === null) return 'Elegí el RIR.';
    if (!Number.isInteger(values.rir) || values.rir < 0 || values.rir > MAX_RIR) {
      return 'El RIR tiene que estar entre 0 y 10.';
    }
  }
  return null;
}

/** Turns valid editor values into an edit; fields the editor doesn't show keep the original value. */
export function editFromValues(
  values: SetEditValues,
  exercise: { rep_unit: RoutineExerciseRepUnit; rir_min: number | null },
  original: LoggedSet
): SetCorrection {
  return {
    kind: 'edit',
    weight: exercise.rep_unit === 'seconds' ? original.weight : Number(values.weight),
    reps: Number(values.reps),
    rir: exercise.rir_min !== null ? values.rir : original.rir,
  };
}

/** Full-row upsert payload: the insert half of an upsert must satisfy every NOT NULL column. */
export function buildCorrectionPayload(set: LoggedSet, change: SetCorrection): Record<string, unknown> {
  const values = change.kind === 'edit' ? change : set;
  return {
    id: set.id,
    session_id: set.session_id,
    routine_exercise_id: set.routine_exercise_id,
    set_index: set.set_index,
    set_type: set.set_type,
    weight: values.weight,
    reps: values.reps,
    rir: values.rir,
    created_at: set.created_at,
    is_deleted: change.kind === 'delete',
  };
}

export function applyCorrection(sets: LoggedSet[], setId: string, change: SetCorrection): LoggedSet[] {
  if (change.kind === 'delete') return sets.filter((s) => s.id !== setId);
  return sets.map((s) => (s.id === setId ? { ...s, weight: change.weight, reps: change.reps, rir: change.rir } : s));
}
