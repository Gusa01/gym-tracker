import {
  getTargetRepsForSet,
  isSetHit,
  isExerciseHit,
  computeWeightIncrement,
  computeNextExerciseState,
  SchemeFields,
} from '../../../src/lib/progression/rules';
import { LoggedSet } from '../../../src/lib/sessions/types';

const normalExercise: SchemeFields = {
  scheme_type: 'normal',
  rep_max: 10,
  top_set_reps: null,
  backoff_rep_max: null,
  rir_min: 2,
  rir_max: 3,
};

const topSetExercise: SchemeFields = {
  scheme_type: 'top_set_backoff',
  rep_max: null,
  top_set_reps: 5,
  backoff_rep_max: 10,
  rir_min: 1,
  rir_max: 2,
};

const coreExercise: SchemeFields = {
  scheme_type: 'normal',
  rep_max: 40,
  top_set_reps: null,
  backoff_rep_max: null,
  rir_min: null,
  rir_max: null,
};

function baseSet(overrides: Partial<LoggedSet>): LoggedSet {
  return {
    id: 'set-1',
    session_id: 'sess-1',
    routine_exercise_id: 'ex-1',
    set_index: 1,
    set_type: 'working',
    weight: 60,
    reps: 10,
    rir: 2,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getTargetRepsForSet', () => {
  it('uses rep_max for a normal working set', () => {
    expect(getTargetRepsForSet(normalExercise, 'working')).toBe(10);
  });

  it('uses top_set_reps for a top set', () => {
    expect(getTargetRepsForSet(topSetExercise, 'top_set')).toBe(5);
  });

  it('uses backoff_rep_max for a back-off set', () => {
    expect(getTargetRepsForSet(topSetExercise, 'back_off')).toBe(10);
  });

  it('falls back to 0 when the relevant field is null', () => {
    expect(getTargetRepsForSet(normalExercise, 'top_set')).toBe(0);
  });
});

describe('isSetHit', () => {
  it('hits when reps meet target and RIR is within range', () => {
    expect(isSetHit(baseSet({ set_type: 'working', reps: 10, rir: 2 }), normalExercise)).toBe(true);
  });

  it('misses when reps fall short of target', () => {
    expect(isSetHit(baseSet({ set_type: 'working', reps: 9, rir: 2 }), normalExercise)).toBe(false);
  });

  it('misses when RIR is below the floor', () => {
    expect(isSetHit(baseSet({ set_type: 'working', reps: 10, rir: 1 }), normalExercise)).toBe(false);
  });

  it('misses when RIR is above the ceiling', () => {
    expect(isSetHit(baseSet({ set_type: 'working', reps: 10, rir: 4 }), normalExercise)).toBe(false);
  });

  it('ignores RIR entirely when the exercise has no RIR target (core)', () => {
    expect(isSetHit(baseSet({ set_type: 'working', reps: 40, rir: null }), coreExercise)).toBe(true);
  });

  it('evaluates a top set against top_set_reps', () => {
    expect(isSetHit(baseSet({ set_type: 'top_set', reps: 5, rir: 1 }), topSetExercise)).toBe(true);
    expect(isSetHit(baseSet({ set_type: 'top_set', reps: 4, rir: 1 }), topSetExercise)).toBe(false);
  });
});

describe('isExerciseHit', () => {
  it('is true only when every set hits', () => {
    const sets = [
      baseSet({ set_index: 1, reps: 10, rir: 2 }),
      baseSet({ set_index: 2, reps: 10, rir: 3 }),
    ];
    expect(isExerciseHit(sets, normalExercise)).toBe(true);
  });

  it('is false if any set misses', () => {
    const sets = [
      baseSet({ set_index: 1, reps: 10, rir: 2 }),
      baseSet({ set_index: 2, reps: 8, rir: 2 }),
    ];
    expect(isExerciseHit(sets, normalExercise)).toBe(false);
  });

  it('is false for an empty set list', () => {
    expect(isExerciseHit([], normalExercise)).toBe(false);
  });
});

describe('computeWeightIncrement', () => {
  it('is 1.25 for upper', () => {
    expect(computeWeightIncrement('upper')).toBe(1.25);
  });

  it('is 2.5 for lower', () => {
    expect(computeWeightIncrement('lower')).toBe(2.5);
  });

  it('is 0 for core', () => {
    expect(computeWeightIncrement('core')).toBe(0);
  });

  it('is 0 for an unrecognized value', () => {
    expect(computeWeightIncrement('')).toBe(0);
  });
});

describe('computeNextExerciseState', () => {
  it('raises the suggested weight and increments the hit streak on a hit, with no prior state', () => {
    const result = computeNextExerciseState(null, 60, true, 2.5);
    expect(result).toEqual({
      current_weight: 60,
      suggested_next_weight: 62.5,
      consecutive_hit_count: 1,
      consecutive_miss_count: 0,
    });
  });

  it('continues the hit streak and resets the miss streak', () => {
    const result = computeNextExerciseState({ consecutive_hit_count: 2, consecutive_miss_count: 1 }, 60, true, 2.5);
    expect(result.consecutive_hit_count).toBe(3);
    expect(result.consecutive_miss_count).toBe(0);
  });

  it('keeps the same weight and increments the miss streak on a miss', () => {
    const result = computeNextExerciseState(null, 60, false, 2.5);
    expect(result).toEqual({
      current_weight: 60,
      suggested_next_weight: 60,
      consecutive_hit_count: 0,
      consecutive_miss_count: 1,
    });
  });

  it('continues the miss streak and resets the hit streak', () => {
    const result = computeNextExerciseState({ consecutive_hit_count: 5, consecutive_miss_count: 0 }, 60, false, 2.5);
    expect(result.consecutive_hit_count).toBe(0);
    expect(result.consecutive_miss_count).toBe(1);
  });
});
