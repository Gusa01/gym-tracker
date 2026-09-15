import {
  computeWeekNumber,
  weekdayFromDate,
  formatDateOnly,
  resolveTodayDayId,
} from '../../../src/lib/sessions/weekResolution';

describe('computeWeekNumber', () => {
  it('is week 1 on the start day itself', () => {
    expect(computeWeekNumber('2026-01-01T12:00:00.000Z', new Date(2026, 0, 1, 12))).toBe(1);
  });

  it('is week 1 through day 6', () => {
    expect(computeWeekNumber('2026-01-01T12:00:00.000Z', new Date(2026, 0, 7, 12))).toBe(1);
  });

  it('is week 2 on day 7', () => {
    expect(computeWeekNumber('2026-01-01T12:00:00.000Z', new Date(2026, 0, 8, 12))).toBe(2);
  });

  it('is week 3 on day 14', () => {
    expect(computeWeekNumber('2026-01-01T12:00:00.000Z', new Date(2026, 0, 15, 12))).toBe(3);
  });

  it('clamps to week 1 if "today" is before the start date', () => {
    expect(computeWeekNumber('2026-01-15T12:00:00.000Z', new Date(2026, 0, 1, 12))).toBe(1);
  });
});

describe('weekdayFromDate', () => {
  it('maps a known Monday to "mon"', () => {
    // 2026-01-05 is a Monday
    expect(weekdayFromDate(new Date(2026, 0, 5))).toBe('mon');
  });

  it('maps a known Sunday to "sun"', () => {
    // 2026-01-04 is a Sunday
    expect(weekdayFromDate(new Date(2026, 0, 4))).toBe('sun');
  });
});

describe('formatDateOnly', () => {
  it('formats using local date parts, not UTC', () => {
    expect(formatDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('pads single-digit month and day', () => {
    expect(formatDateOnly(new Date(2026, 2, 4))).toBe('2026-03-04');
  });
});

describe('resolveTodayDayId', () => {
  it('returns the plain day id for a simple weekday mapping', () => {
    const schedule = { mon: 'day-a-uuid', tue: 'core-uuid' };
    expect(resolveTodayDayId(schedule, 'mon', 1)).toBe('day-a-uuid');
  });

  it('returns null when the weekday has no entry (rest day)', () => {
    const schedule = { mon: 'day-a-uuid' };
    expect(resolveTodayDayId(schedule, 'wed', 1)).toBeNull();
  });

  it('resolves the odd-week template on an odd week number', () => {
    const schedule = { fri: { even_week: 'day-a-uuid', odd_week: 'day-b-uuid' } };
    expect(resolveTodayDayId(schedule, 'fri', 1)).toBe('day-b-uuid');
    expect(resolveTodayDayId(schedule, 'fri', 3)).toBe('day-b-uuid');
  });

  it('resolves the even-week template on an even week number', () => {
    const schedule = { fri: { even_week: 'day-a-uuid', odd_week: 'day-b-uuid' } };
    expect(resolveTodayDayId(schedule, 'fri', 2)).toBe('day-a-uuid');
    expect(resolveTodayDayId(schedule, 'fri', 4)).toBe('day-a-uuid');
  });

  it('returns null for a malformed entry', () => {
    const schedule = { mon: 42 };
    expect(resolveTodayDayId(schedule, 'mon', 1)).toBeNull();
  });
});
