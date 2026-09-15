import { shouldSuggestRoutineSwitch } from '../../../src/lib/progression/routineSwitch';

const baseRoutine = {
  started_at: '2026-01-01T12:00:00.000Z',
  suggested_duration_weeks: 4,
  next_routine_id: 'next-routine-id',
};

describe('shouldSuggestRoutineSwitch', () => {
  it('is false before the suggested duration is exceeded (still week 4)', () => {
    expect(shouldSuggestRoutineSwitch(baseRoutine, new Date(2026, 0, 28, 12))).toBe(false);
  });

  it('is true once the suggested duration is exceeded (week 5)', () => {
    expect(shouldSuggestRoutineSwitch(baseRoutine, new Date(2026, 0, 29, 12))).toBe(true);
  });

  it('is false when the routine was never started', () => {
    expect(shouldSuggestRoutineSwitch({ ...baseRoutine, started_at: null }, new Date(2026, 0, 29, 12))).toBe(false);
  });

  it('is false when the routine has no suggested duration (indefinite)', () => {
    expect(
      shouldSuggestRoutineSwitch({ ...baseRoutine, suggested_duration_weeks: null }, new Date(2026, 0, 29, 12))
    ).toBe(false);
  });

  it('is false when there is no next routine configured', () => {
    expect(shouldSuggestRoutineSwitch({ ...baseRoutine, next_routine_id: null }, new Date(2026, 0, 29, 12))).toBe(
      false
    );
  });
});
