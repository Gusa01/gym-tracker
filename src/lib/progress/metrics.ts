import { ChartPoint, Metric, MetricKind, ProgressSet } from './types';

/** Epley estimated one-rep max, rounded to 0.1. Null when the set can't produce one. */
export function estimate1RM(weight: number, reps: number): number | null {
  if (weight <= 0 || reps <= 0) return null;
  const raw = reps === 1 ? weight : weight * (1 + reps / 30);
  return Math.round(raw * 10) / 10;
}

function compareChronologically(a: ProgressSet, b: ProgressSet): number {
  if (a.session_date !== b.session_date) return a.session_date < b.session_date ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return 0;
}

export function sortChronologically<T extends ProgressSet>(sets: T[]): T[] {
  return [...sets].sort(compareChronologically);
}

export function metricKind(sets: ProgressSet[]): MetricKind {
  const sorted = sortChronologically(sets);
  const latest = sorted[sorted.length - 1];
  if (latest && latest.rep_unit === 'seconds') return 'seconds';
  return sets.some((s) => s.weight > 0) ? 'weighted' : 'bodyweight';
}

const PRIMARY_METRIC: Record<MetricKind, Metric> = {
  weighted: 'e1rm',
  seconds: 'seconds',
  bodyweight: 'reps',
};

export function primaryMetric(kind: MetricKind): Metric {
  return PRIMARY_METRIC[kind];
}

export function metricValue(set: { weight: number; reps: number }, metric: Metric): number | null {
  switch (metric) {
    case 'e1rm':
      return estimate1RM(set.weight, set.reps);
    case 'weight':
      return set.weight > 0 ? set.weight : null;
    case 'seconds':
    case 'reps':
      return set.reps > 0 ? set.reps : null;
  }
}

function beats(candidate: ProgressSet, value: number, current: ChartPoint, metric: Metric): boolean {
  if (value !== current.value) return value > current.value;
  if (metric === 'e1rm') return candidate.weight > current.weight;
  if (metric === 'weight') return candidate.reps > current.reps;
  return false;
}

/** One chart point per session: the session's best set for `metric`, sorted by date. */
export function bestSetPerSession(sets: ProgressSet[], metric: Metric): ChartPoint[] {
  const bestBySession = new Map<string, ChartPoint>();
  for (const set of sortChronologically(sets)) {
    const value = metricValue(set, metric);
    if (value === null) continue;
    const current = bestBySession.get(set.session_id);
    if (!current || beats(set, value, current, metric)) {
      bestBySession.set(set.session_id, {
        sessionId: set.session_id,
        date: set.session_date,
        value,
        weight: set.weight,
        reps: set.reps,
      });
    }
  }
  return [...bestBySession.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
