import { RoutineExerciseRepUnit, RoutineExerciseSchemeType } from '../routines/types';
import { LoggedSet } from '../sessions/types';

export type SetCorrection =
  | { kind: 'edit'; weight: number; reps: number; rir: number | null }
  | { kind: 'delete' };

/** The routine exercise a historical set points to (soft-deleted ones included). */
export interface HistoryExercise {
  id: string;
  exercise_name: string;
  order_index: number;
  scheme_type: RoutineExerciseSchemeType;
  rep_unit: RoutineExerciseRepUnit;
  rir_min: number | null;
}

export interface HistorySessionRow {
  id: string;
  sessionDate: string;
  dayName: string;
  exerciseCount: number;
  setCount: number;
}

export interface SessionDetail {
  id: string;
  sessionDate: string;
  dayName: string;
  sets: LoggedSet[];
  exercises: HistoryExercise[];
}

export interface ExerciseSetGroup {
  exercise: HistoryExercise;
  sets: LoggedSet[];
}

/** Raw editor input: the steppers hold strings. */
export interface SetEditValues {
  weight: string;
  reps: string;
  rir: number | null;
}
