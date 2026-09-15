import { computeWeekNumber } from '../sessions/weekResolution';

export interface RoutineScheduleFields {
  started_at: string | null;
  suggested_duration_weeks: number | null;
  next_routine_id: string | null;
}

export function shouldSuggestRoutineSwitch(routine: RoutineScheduleFields, now: Date): boolean {
  if (!routine.started_at || routine.suggested_duration_weeks === null || !routine.next_routine_id) {
    return false;
  }
  const weekNumber = computeWeekNumber(routine.started_at, now);
  return weekNumber > routine.suggested_duration_weeks;
}
