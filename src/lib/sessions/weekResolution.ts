import { Weekday } from '../routines/types';

function toLocalDayNumber(date: Date): number {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(local.getTime() / 86400000);
}

export function computeWeekNumber(startedAt: string, today: Date = new Date()): number {
  const daysSince = toLocalDayNumber(today) - toLocalDayNumber(new Date(startedAt));
  return Math.floor(Math.max(daysSince, 0) / 7) + 1;
}

const WEEKDAY_BY_JS_DAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function weekdayFromDate(date: Date): Weekday {
  return WEEKDAY_BY_JS_DAY[date.getDay()];
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveTodayDayId(
  weekdaySchedule: Record<string, unknown>,
  weekday: Weekday,
  weekNumber: number
): string | null {
  const entry = weekdaySchedule[weekday];
  if (typeof entry === 'string') return entry;
  if (
    entry !== null &&
    typeof entry === 'object' &&
    'even_week' in entry &&
    'odd_week' in entry
  ) {
    const alt = entry as { even_week: unknown; odd_week: unknown };
    const chosen = weekNumber % 2 === 0 ? alt.even_week : alt.odd_week;
    return typeof chosen === 'string' ? chosen : null;
  }
  return null;
}
