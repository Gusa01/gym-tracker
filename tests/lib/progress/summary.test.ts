import { summarizeExercises } from '../../../src/lib/progress/summary';
import { ExerciseSetRow } from '../../../src/lib/progress/types';

function row(overrides: Partial<ExerciseSetRow>): ExerciseSetRow {
  return {
    logged_set_id: 'l1',
    user_id: 'u1',
    exercise_id: 'bench',
    exercise_name: 'Press banca',
    rep_unit: 'reps',
    session_id: 's1',
    session_date: '2026-09-21',
    set_index: 1,
    set_type: 'working',
    weight: 80,
    reps: 6,
    created_at: '2026-09-21T10:00:00Z',
    ...overrides,
  };
}

describe('summarizeExercises', () => {
  it('builds one row per exercise sorted by last trained date, most recent first', () => {
    const summaries = summarizeExercises([
      row({ exercise_id: 'bench', session_id: 'a', session_date: '2026-09-21', weight: 80, reps: 6 }),
      row({ exercise_id: 'bench', session_id: 'b', session_date: '2026-09-28', weight: 82.5, reps: 6 }),
      row({
        exercise_id: 'plank',
        exercise_name: 'Plancha',
        rep_unit: 'seconds',
        session_id: 'c',
        session_date: '2026-09-30',
        weight: 0,
        reps: 75,
      }),
    ]);

    expect(summaries).toEqual([
      {
        exerciseId: 'plank',
        exerciseName: 'Plancha',
        kind: 'seconds',
        metric: 'seconds',
        latestValue: 75,
        trend: null,
        lastTrainedDate: '2026-09-30',
      },
      {
        exerciseId: 'bench',
        exerciseName: 'Press banca',
        kind: 'weighted',
        metric: 'e1rm',
        latestValue: 99, // 82.5 * (1 + 6/30)
        trend: 'up',
        lastTrainedDate: '2026-09-28',
      },
    ]);
  });

  it('breaks a last-trained tie by exercise name', () => {
    const summaries = summarizeExercises([
      row({ exercise_id: 'squat', exercise_name: 'Sentadilla' }),
      row({ exercise_id: 'bench', exercise_name: 'Press banca' }),
    ]);
    expect(summaries.map((s) => s.exerciseName)).toEqual(['Press banca', 'Sentadilla']);
  });

  it('returns an empty list for no rows', () => {
    expect(summarizeExercises([])).toEqual([]);
  });
});
