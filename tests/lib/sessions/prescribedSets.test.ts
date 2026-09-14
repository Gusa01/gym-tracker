import { buildPrescribedSets, formatTargetScheme } from '../../../src/lib/sessions/prescribedSets';
import { RoutineExerciseWithName } from '../../../src/lib/routines/types';

function baseExercise(overrides: Partial<RoutineExerciseWithName>): RoutineExerciseWithName {
  return {
    id: 'ex-1',
    routine_day_id: 'day-1',
    exercise_id: 'catalog-1',
    exercise_name: 'Press banca',
    order_index: 0,
    role: 'main',
    scheme_type: 'normal',
    rep_unit: 'reps',
    sets: null,
    rep_min: null,
    rep_max: null,
    rir_min: null,
    rir_max: null,
    top_set_reps: null,
    backoff_sets: null,
    backoff_rep_min: null,
    backoff_rep_max: null,
    is_deleted: false,
    ...overrides,
  };
}

describe('buildPrescribedSets', () => {
  it('builds N working sets for a normal scheme', () => {
    const exercise = baseExercise({ scheme_type: 'normal', sets: 3 });
    expect(buildPrescribedSets(exercise)).toEqual([
      { setIndex: 1, setType: 'working' },
      { setIndex: 2, setType: 'working' },
      { setIndex: 3, setType: 'working' },
    ]);
  });

  it('returns an empty array when sets is null for a normal scheme', () => {
    const exercise = baseExercise({ scheme_type: 'normal', sets: null });
    expect(buildPrescribedSets(exercise)).toEqual([]);
  });

  it('builds a top set followed by N back-off sets', () => {
    const exercise = baseExercise({ scheme_type: 'top_set_backoff', backoff_sets: 2 });
    expect(buildPrescribedSets(exercise)).toEqual([
      { setIndex: 1, setType: 'top_set' },
      { setIndex: 2, setType: 'back_off' },
      { setIndex: 3, setType: 'back_off' },
    ]);
  });

  it('builds just the top set when backoff_sets is null', () => {
    const exercise = baseExercise({ scheme_type: 'top_set_backoff', backoff_sets: null });
    expect(buildPrescribedSets(exercise)).toEqual([{ setIndex: 1, setType: 'top_set' }]);
  });
});

describe('formatTargetScheme', () => {
  it('formats a normal reps scheme with RIR', () => {
    const exercise = baseExercise({
      scheme_type: 'normal',
      sets: 3,
      rep_min: 8,
      rep_max: 10,
      rir_min: 2,
      rir_max: 3,
    });
    expect(formatTargetScheme(exercise)).toBe('3×8-10 @ RIR 2-3');
  });

  it('formats a normal seconds scheme without RIR (core)', () => {
    const exercise = baseExercise({
      scheme_type: 'normal',
      rep_unit: 'seconds',
      sets: 3,
      rep_min: 30,
      rep_max: 40,
      rir_min: null,
      rir_max: null,
    });
    expect(formatTargetScheme(exercise)).toBe('3×30-40s');
  });

  it('formats a top-set/back-off scheme', () => {
    const exercise = baseExercise({
      scheme_type: 'top_set_backoff',
      top_set_reps: 5,
      backoff_sets: 2,
      backoff_rep_min: 8,
      backoff_rep_max: 10,
      rir_min: 1,
      rir_max: 2,
    });
    expect(formatTargetScheme(exercise)).toBe('Top set 1×5 + Back-off 2×8-10 @ RIR 1-2');
  });
});
