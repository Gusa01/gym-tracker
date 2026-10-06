import { pickSpotlightExercise, sparklinesByExercise, SPARKLINE_POINTS } from '../../../src/lib/progress/spotlight';
import { ExerciseSetRow, ExerciseSummary } from '../../../src/lib/progress/types';

function summary(overrides: Partial<ExerciseSummary>): ExerciseSummary {
  return {
    exerciseId: 'bench',
    exerciseName: 'Press banca',
    kind: 'weighted',
    metric: 'e1rm',
    latestValue: 96,
    trend: 'up',
    lastTrainedDate: '2026-10-01',
    ...overrides,
  };
}

function row(overrides: Partial<ExerciseSetRow>): ExerciseSetRow {
  return {
    logged_set_id: 'l1',
    user_id: 'u1',
    exercise_id: 'bench',
    exercise_name: 'Press banca',
    rep_unit: 'reps',
    session_id: 's1',
    session_date: '2026-09-01',
    set_index: 1,
    set_type: 'working',
    weight: 80,
    reps: 1,
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

describe('pickSpotlightExercise', () => {
  const summaries = [
    summary({ exerciseId: 'plank', exerciseName: 'Plancha', kind: 'seconds', metric: 'seconds' }),
    summary({ exerciseId: 'squat', exerciseName: 'Sentadilla' }),
    summary({ exerciseId: 'bench' }),
  ];

  it('keeps the preferred exercise when it is still in the list', () => {
    expect(pickSpotlightExercise(summaries, 'bench')).toBe('bench');
  });

  it('falls back to the most recently trained weighted exercise', () => {
    expect(pickSpotlightExercise(summaries, null)).toBe('squat');
    expect(pickSpotlightExercise(summaries, 'gone')).toBe('squat');
  });

  it('uses the most recent exercise when none is weighted', () => {
    expect(pickSpotlightExercise([summaries[0]], null)).toBe('plank');
  });

  it('returns null with no exercises', () => {
    expect(pickSpotlightExercise([], 'bench')).toBeNull();
  });
});

describe('sparklinesByExercise', () => {
  it('gives each exercise its primary-metric value per session, oldest first', () => {
    const sparklines = sparklinesByExercise(
      [
        row({ session_id: 's2', session_date: '2026-09-08', weight: 85 }),
        row({ session_id: 's1', session_date: '2026-09-01', weight: 80 }),
        row({ exercise_id: 'plank', rep_unit: 'seconds', session_id: 's3', weight: 0, reps: 60 }),
      ],
      [summary({ exerciseId: 'bench' }), summary({ exerciseId: 'plank', kind: 'seconds', metric: 'seconds' })]
    );
    expect(sparklines.get('bench')).toEqual([80, 85]);
    expect(sparklines.get('plank')).toEqual([60]);
  });

  it(`keeps only the last ${SPARKLINE_POINTS} sessions`, () => {
    const rows = Array.from({ length: SPARKLINE_POINTS + 3 }, (_, i) =>
      row({ session_id: `s${i}`, session_date: `2026-09-${String(i + 1).padStart(2, '0')}`, weight: 60 + i })
    );
    const values = sparklinesByExercise(rows, [summary({})]).get('bench')!;
    expect(values).toHaveLength(SPARKLINE_POINTS);
    expect(values[0]).toBe(63);
    expect(values[values.length - 1]).toBe(72);
  });
});
