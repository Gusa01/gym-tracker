import { RoutineExerciseRepUnit } from '../routines/types';
import { BrokenRecord, CachedRecords, LiveSet, Metric } from './types';
import { metricValue } from './metrics';

const CACHE_FIELD: Record<Metric, keyof CachedRecords> = {
  e1rm: 'best_e1rm',
  weight: 'best_weight',
  seconds: 'best_seconds',
  reps: 'best_reps',
};

function metricsFor(set: LiveSet, repUnit: RoutineExerciseRepUnit): Metric[] {
  if (repUnit === 'seconds') return ['seconds'];
  return set.weight > 0 ? ['e1rm', 'weight'] : ['reps'];
}

/**
 * Records broken by `newSet`. The baseline for each metric is the cached best from completed
 * sessions, raised by any earlier set in the current session, so the same record is never
 * celebrated twice. An exercise (or metric) with no cached history never celebrates.
 */
export function detectLiveRecord(
  newSet: LiveSet,
  repUnit: RoutineExerciseRepUnit,
  previousBest: CachedRecords | null,
  earlierSessionSets: LiveSet[]
): BrokenRecord[] {
  if (newSet.set_type === 'warmup' || !previousBest) return [];
  const earlier = earlierSessionSets.filter((s) => s.set_type !== 'warmup');

  const broken: BrokenRecord[] = [];
  for (const metric of metricsFor(newSet, repUnit)) {
    const cached = previousBest[CACHE_FIELD[metric]];
    if (cached === null) continue;
    const value = metricValue(newSet, metric);
    if (value === null) continue;
    const earlierValues = earlier
      .map((s) => metricValue(s, metric))
      .filter((v): v is number => v !== null);
    const baseline = Math.max(cached, ...earlierValues);
    if (value > baseline) broken.push({ metric, value, previous: baseline });
  }
  return broken;
}
