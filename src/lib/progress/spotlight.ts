import { ExerciseSetRow, ExerciseSummary } from './types';
import { bestSetPerSession } from './metrics';
import { groupByExercise } from './records';

export const SPARKLINE_POINTS = 10;

/**
 * Which exercise the Home progress card shows: the user's saved choice while it still exists,
 * otherwise the most recently trained weighted exercise (summaries are sorted most recent first),
 * otherwise the most recent exercise of any kind.
 */
export function pickSpotlightExercise(summaries: ExerciseSummary[], preferredId: string | null): string | null {
  if (preferredId && summaries.some((s) => s.exerciseId === preferredId)) return preferredId;
  return (summaries.find((s) => s.kind === 'weighted') ?? summaries[0])?.exerciseId ?? null;
}

/** Last SPARKLINE_POINTS per-session values of each exercise's primary metric, oldest first. */
export function sparklinesByExercise(rows: ExerciseSetRow[], summaries: ExerciseSummary[]): Map<string, number[]> {
  const groups = groupByExercise(rows);
  const result = new Map<string, number[]>();
  for (const summary of summaries) {
    const points = bestSetPerSession(groups.get(summary.exerciseId) ?? [], summary.metric);
    result.set(
      summary.exerciseId,
      points.slice(-SPARKLINE_POINTS).map((p) => p.value)
    );
  }
  return result;
}
