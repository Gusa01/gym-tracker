import { computeConsecutiveActiveWeeks } from '../../../src/lib/home/streak';

describe('computeConsecutiveActiveWeeks', () => {
  const now = new Date(2026, 0, 20); // Tuesday, week-of-Monday = 2026-01-19

  it('returns 0 for no session history', () => {
    expect(computeConsecutiveActiveWeeks([], now)).toBe(0);
  });

  it('counts consecutive weeks including the current one', () => {
    const dates = ['2026-01-20', '2026-01-13', '2026-01-06'];
    expect(computeConsecutiveActiveWeeks(dates, now)).toBe(3);
  });

  it('skips an empty current week once and counts from the last active week', () => {
    const dates = ['2026-01-14', '2026-01-07'];
    expect(computeConsecutiveActiveWeeks(dates, now)).toBe(2);
  });

  it('stops counting at the first gap', () => {
    const dates = ['2026-01-20', '2026-01-06']; // current week present, prior week missing
    expect(computeConsecutiveActiveWeeks(dates, now)).toBe(1);
  });

  it('treats any date within a week as satisfying that week, regardless of weekday', () => {
    const dates = ['2026-01-22', '2026-01-08']; // Thursdays, weeks of 01-19 and 01-05
    // gap at week-of-01-12 breaks the streak after the first week
    expect(computeConsecutiveActiveWeeks(dates, now)).toBe(1);
  });
});
