import { CachedRecords, ExerciseRecords, ExerciseSetRow, Metric, ProgressSet, RecordEntry } from './types';
import { metricKind, metricValue, sortChronologically } from './metrics';

/** Strictly-greater scan in chronological order, so a tie keeps the earliest date. */
function bestEntry(sets: ProgressSet[], metric: Metric): RecordEntry | null {
  let best: RecordEntry | null = null;
  for (const set of sortChronologically(sets)) {
    const value = metricValue(set, metric);
    if (value === null) continue;
    if (!best || value > best.value) {
      best = { value, weight: set.weight, reps: set.reps, date: set.session_date };
    }
  }
  return best;
}

export function computeRecords(sets: ProgressSet[]): ExerciseRecords {
  const kind = metricKind(sets);
  return {
    kind,
    bestE1rm: kind === 'weighted' ? bestEntry(sets, 'e1rm') : null,
    bestWeight: kind === 'weighted' ? bestEntry(sets, 'weight') : null,
    bestSeconds: kind === 'seconds' ? bestEntry(sets, 'seconds') : null,
    bestReps: kind === 'bodyweight' ? bestEntry(sets, 'reps') : null,
  };
}

export function toCachedRecords(records: ExerciseRecords): CachedRecords {
  return {
    best_e1rm: records.bestE1rm?.value ?? null,
    best_weight: records.bestWeight?.value ?? null,
    best_seconds: records.bestSeconds?.value ?? null,
    best_reps: records.bestReps?.value ?? null,
  };
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

export function mergeCachedRecords(existing: CachedRecords | null, incoming: CachedRecords): CachedRecords {
  if (!existing) return incoming;
  // On a weighted exercise, weight-0 sets never qualify for a reps record (spec §7 step 5).
  const existingIsWeighted = existing.best_e1rm !== null || existing.best_weight !== null;
  return {
    best_e1rm: maxNullable(existing.best_e1rm, incoming.best_e1rm),
    best_weight: maxNullable(existing.best_weight, incoming.best_weight),
    best_seconds: maxNullable(existing.best_seconds, incoming.best_seconds),
    best_reps: existingIsWeighted ? existing.best_reps : maxNullable(existing.best_reps, incoming.best_reps),
  };
}

export function groupByExercise(rows: ExerciseSetRow[]): Map<string, ExerciseSetRow[]> {
  const groups = new Map<string, ExerciseSetRow[]>();
  for (const row of rows) {
    const group = groups.get(row.exercise_id);
    if (group) group.push(row);
    else groups.set(row.exercise_id, [row]);
  }
  return groups;
}

export function recordsByExercise(rows: ExerciseSetRow[]): Map<string, CachedRecords> {
  const result = new Map<string, CachedRecords>();
  groupByExercise(rows).forEach((sets, exerciseId) => {
    result.set(exerciseId, toCachedRecords(computeRecords(sets)));
  });
  return result;
}
