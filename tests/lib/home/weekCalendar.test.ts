import { buildWeekCalendar, computeWeekProgress } from '../../../src/lib/home/weekCalendar';

describe('buildWeekCalendar', () => {
  const days = [
    { id: 'day-a', name: 'Día A', is_rest_day: false },
    { id: 'day-b', name: 'Día B', is_rest_day: false },
    { id: 'day-rest', name: 'Descanso activo', is_rest_day: true },
  ];

  it('resolves a plain (non-alternating) entry every week', () => {
    const schedule = { mon: 'day-a' };
    const week1 = buildWeekCalendar(schedule, days, 1, new Date(2026, 0, 19)); // Monday
    const week2 = buildWeekCalendar(schedule, days, 2, new Date(2026, 0, 19));
    expect(week1.find((d) => d.weekday === 'mon')?.dayName).toBe('Día A');
    expect(week2.find((d) => d.weekday === 'mon')?.dayName).toBe('Día A');
  });

  it('resolves an alternating entry differently on even vs odd weeks', () => {
    const schedule = { fri: { even_week: 'day-a', odd_week: 'day-b' } };
    const oddWeek = buildWeekCalendar(schedule, days, 1, new Date(2026, 0, 19));
    const evenWeek = buildWeekCalendar(schedule, days, 2, new Date(2026, 0, 19));
    expect(oddWeek.find((d) => d.weekday === 'fri')?.dayName).toBe('Día B');
    expect(evenWeek.find((d) => d.weekday === 'fri')?.dayName).toBe('Día A');
  });

  it('marks a weekday with no schedule entry as a rest day with no name', () => {
    const week = buildWeekCalendar({ mon: 'day-a' }, days, 1, new Date(2026, 0, 19));
    const wed = week.find((d) => d.weekday === 'wed');
    expect(wed?.isRestDay).toBe(true);
    expect(wed?.dayName).toBeNull();
  });

  it('marks a weekday resolving to an is_rest_day=true routine day as a rest day with no name', () => {
    const schedule = { tue: 'day-rest' };
    const week = buildWeekCalendar(schedule, days, 1, new Date(2026, 0, 19));
    const tue = week.find((d) => d.weekday === 'tue');
    expect(tue?.isRestDay).toBe(true);
    expect(tue?.dayName).toBeNull();
  });

  it('flags only today\'s weekday as isToday', () => {
    // 2026-01-20 is a Tuesday
    const week = buildWeekCalendar({}, days, 1, new Date(2026, 0, 20));
    const flagged = week.filter((d) => d.isToday);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].weekday).toBe('tue');
  });

  it('always returns exactly 7 days in Monday-through-Sunday order', () => {
    const week = buildWeekCalendar({}, days, 1, new Date(2026, 0, 19));
    expect(week.map((d) => d.weekday)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(week.map((d) => d.label)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
  });
});

describe('computeWeekProgress', () => {
  it('returns null for an indefinite routine (no suggested duration)', () => {
    expect(computeWeekProgress(3, null)).toBeNull();
  });

  it('returns the fraction of weeks completed', () => {
    expect(computeWeekProgress(2, 8)).toBe(0.25);
  });

  it('caps at 1 when the current week exceeds the suggested duration', () => {
    expect(computeWeekProgress(10, 8)).toBe(1);
  });

  it('returns null for a zero or negative suggested duration instead of dividing to Infinity', () => {
    expect(computeWeekProgress(3, 0)).toBeNull();
  });
});
