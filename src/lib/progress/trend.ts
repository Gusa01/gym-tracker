import { Metric, ProgressSet, Trend, WeeklyTrend } from './types';
import { metricValue } from './metrics';

const TREND_THRESHOLD = 0.01;

/** Monday (YYYY-MM-DD) of the week containing `date`. Dates are treated as calendar dates, not instants. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - daysSinceMonday);
  return day.toISOString().slice(0, 10);
}

/** Compares the best value of the latest trained week with the previous trained week. */
export function computeWeeklyTrend(sets: ProgressSet[], metric: Metric): WeeklyTrend {
  const bestByWeek = new Map<string, number>();
  for (const set of sets) {
    const value = metricValue(set, metric);
    if (value === null) continue;
    const week = weekStart(set.session_date);
    const current = bestByWeek.get(week);
    if (current === undefined || value > current) bestByWeek.set(week, value);
  }

  const weeks = [...bestByWeek.keys()].sort();
  if (weeks.length === 0) return { trend: null, latestWeekValue: null };

  const latest = bestByWeek.get(weeks[weeks.length - 1])!;
  if (weeks.length < 2) return { trend: null, latestWeekValue: latest };

  const previous = bestByWeek.get(weeks[weeks.length - 2])!;
  const change = (latest - previous) / previous;
  const trend: Trend = change > TREND_THRESHOLD ? 'up' : change < -TREND_THRESHOLD ? 'down' : 'flat';
  return { trend, latestWeekValue: latest };
}
