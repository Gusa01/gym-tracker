import { ExerciseSetRow, ExerciseSummary } from './types';
import { metricKind, primaryMetric, sortChronologically } from './metrics';
import { groupByExercise } from './records';
import { computeWeeklyTrend } from './trend';

export function summarizeExercises(rows: ExerciseSetRow[]): ExerciseSummary[] {
  const summaries: ExerciseSummary[] = [];
  groupByExercise(rows).forEach((sets, exerciseId) => {
    const sorted = sortChronologically(sets);
    const latest = sorted[sorted.length - 1];
    const kind = metricKind(sets);
    const metric = primaryMetric(kind);
    const { trend, latestWeekValue } = computeWeeklyTrend(sets, metric);
    summaries.push({
      exerciseId,
      exerciseName: latest.exercise_name,
      kind,
      metric,
      latestValue: latestWeekValue,
      trend,
      lastTrainedDate: latest.session_date,
    });
  });

  return summaries.sort((a, b) => {
    if (a.lastTrainedDate !== b.lastTrainedDate) return a.lastTrainedDate < b.lastTrainedDate ? 1 : -1;
    return a.exerciseName.localeCompare(b.exerciseName);
  });
}
