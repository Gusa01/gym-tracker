import { RoutineExerciseRepUnit } from '../routines/types';
import { SetType } from '../sessions/types';

/** The minimum a set needs for progress math. `session_date` is `YYYY-MM-DD`. */
export interface ProgressSet {
  session_id: string;
  session_date: string;
  weight: number;
  reps: number;
  rep_unit: RoutineExerciseRepUnit;
  created_at: string;
}

/** One row of the `exercise_set_history` view. */
export interface ExerciseSetRow extends ProgressSet {
  logged_set_id: string;
  user_id: string;
  exercise_id: string;
  exercise_name: string;
  set_index: number;
  set_type: SetType;
}

export type MetricKind = 'weighted' | 'seconds' | 'bodyweight';
export type Metric = 'e1rm' | 'weight' | 'seconds' | 'reps';

export interface ChartPoint {
  sessionId: string;
  date: string;
  value: number;
  weight: number;
  reps: number;
}

export interface RecordEntry {
  value: number;
  weight: number;
  reps: number;
  date: string;
}

export interface ExerciseRecords {
  kind: MetricKind;
  bestE1rm: RecordEntry | null;
  bestWeight: RecordEntry | null;
  bestSeconds: RecordEntry | null;
  bestReps: RecordEntry | null;
}

/** Shape of one `exercise_records_cache` row (minus the key). */
export interface CachedRecords {
  best_e1rm: number | null;
  best_weight: number | null;
  best_seconds: number | null;
  best_reps: number | null;
}

export type Trend = 'up' | 'flat' | 'down';

export interface WeeklyTrend {
  trend: Trend | null;
  latestWeekValue: number | null;
}

export interface ExerciseSummary {
  exerciseId: string;
  exerciseName: string;
  kind: MetricKind;
  metric: Metric;
  latestValue: number | null;
  trend: Trend | null;
  lastTrainedDate: string;
}

export interface LiveSet {
  weight: number;
  reps: number;
  set_type: SetType;
}

export interface BrokenRecord {
  metric: Metric;
  value: number;
  previous: number;
}

export interface PrBannerData {
  id: string;
  exerciseName: string;
  broken: BrokenRecord[];
}
