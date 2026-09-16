import { Weekday } from '../routines/types';
import { weekdayFromDate, resolveTodayDayId } from '../sessions/weekResolution';

export interface WeekCalendarDay {
  weekday: Weekday;
  label: string;
  dayName: string | null;
  isRestDay: boolean;
  isToday: boolean;
}

interface CalendarRoutineDay {
  id: string;
  name: string;
  is_rest_day: boolean;
}

const WEEK_ORDER: { weekday: Weekday; label: string }[] = [
  { weekday: 'mon', label: 'Lun' },
  { weekday: 'tue', label: 'Mar' },
  { weekday: 'wed', label: 'Mié' },
  { weekday: 'thu', label: 'Jue' },
  { weekday: 'fri', label: 'Vie' },
  { weekday: 'sat', label: 'Sáb' },
  { weekday: 'sun', label: 'Dom' },
];

export function buildWeekCalendar(
  weekdaySchedule: Record<string, unknown>,
  days: CalendarRoutineDay[],
  weekNumber: number,
  today: Date
): WeekCalendarDay[] {
  const todayWeekday = weekdayFromDate(today);

  return WEEK_ORDER.map(({ weekday, label }) => {
    const dayId = resolveTodayDayId(weekdaySchedule, weekday, weekNumber);
    const day = dayId ? days.find((d) => d.id === dayId) ?? null : null;
    const isRestDay = !day || day.is_rest_day;

    return {
      weekday,
      label,
      dayName: isRestDay ? null : day!.name,
      isRestDay,
      isToday: weekday === todayWeekday,
    };
  });
}

export function computeWeekProgress(weekNumber: number, suggestedDurationWeeks: number | null): number | null {
  if (suggestedDurationWeeks === null) return null;
  return Math.min(weekNumber / suggestedDurationWeeks, 1);
}
