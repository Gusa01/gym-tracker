import { weekStart, computeWeeklyTrend } from '../../../src/lib/progress/trend';
import { ProgressSet } from '../../../src/lib/progress/types';

function set(session_date: string, weight: number, reps = 1): ProgressSet {
  return {
    session_id: session_date,
    session_date,
    weight,
    reps,
    rep_unit: 'reps',
    created_at: `${session_date}T10:00:00Z`,
  };
}

describe('weekStart', () => {
  it('returns the Monday of the week', () => {
    expect(weekStart('2026-09-30')).toBe('2026-09-28'); // Wednesday
    expect(weekStart('2026-09-28')).toBe('2026-09-28'); // Monday
  });

  it('puts Sunday in the same week as the preceding Monday', () => {
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // next Monday
  });
});

// reps = 1 makes e1rm equal the weight, so the numbers below read directly.
describe('computeWeeklyTrend', () => {
  it('is up when the latest week beats the previous one by more than 1%', () => {
    expect(computeWeeklyTrend([set('2026-09-21', 100), set('2026-09-28', 101.5)], 'e1rm')).toEqual({
      trend: 'up',
      latestWeekValue: 101.5,
    });
  });

  it('is flat within 1% either way (exactly 1% is flat)', () => {
    expect(computeWeeklyTrend([set('2026-09-21', 100), set('2026-09-28', 101)], 'e1rm').trend).toBe('flat');
    expect(computeWeeklyTrend([set('2026-09-21', 100), set('2026-09-28', 99.5)], 'e1rm').trend).toBe('flat');
  });

  it('is down when the latest week drops more than 1%', () => {
    expect(computeWeeklyTrend([set('2026-09-21', 100), set('2026-09-28', 98)], 'e1rm').trend).toBe('down');
  });

  it('uses the best of each week, not the average', () => {
    const sets = [set('2026-09-21', 100), set('2026-09-28', 104), set('2026-09-30', 70)];
    expect(computeWeeklyTrend(sets, 'e1rm')).toEqual({ trend: 'up', latestWeekValue: 104 });
  });

  it('skips weeks with no data', () => {
    const sets = [set('2026-08-31', 100), set('2026-09-28', 100.5)];
    expect(computeWeeklyTrend(sets, 'e1rm').trend).toBe('flat');
  });

  it('gives no arrow with fewer than 2 weeks, but still reports the value', () => {
    expect(computeWeeklyTrend([set('2026-09-28', 100), set('2026-09-30', 102)], 'e1rm')).toEqual({
      trend: null,
      latestWeekValue: 102,
    });
  });

  it('returns nulls with no usable data', () => {
    expect(computeWeeklyTrend([], 'e1rm')).toEqual({ trend: null, latestWeekValue: null });
    expect(computeWeeklyTrend([set('2026-09-28', 0, 10)], 'e1rm')).toEqual({ trend: null, latestWeekValue: null });
  });
});
