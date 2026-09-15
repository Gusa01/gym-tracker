import { hasTopSetDeficit, hasConsecutiveDeficit } from '../../../src/lib/progression/deload';
import { LoggedSet } from '../../../src/lib/sessions/types';

function topSet(overrides: Partial<LoggedSet>): LoggedSet {
  return {
    id: 'set-1',
    session_id: 'sess-1',
    routine_exercise_id: 'ex-1',
    set_index: 1,
    set_type: 'top_set',
    weight: 80,
    reps: 5,
    rir: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('hasTopSetDeficit', () => {
  it('has no deficit when reps and RIR both meet target', () => {
    expect(hasTopSetDeficit(topSet({ reps: 5, rir: 1 }), 5, 1)).toBe(false);
  });

  it('has a deficit when reps fall short', () => {
    expect(hasTopSetDeficit(topSet({ reps: 3, rir: 1 }), 5, 1)).toBe(true);
  });

  it('has a deficit when RIR falls below the floor', () => {
    expect(hasTopSetDeficit(topSet({ reps: 5, rir: 0 }), 5, 1)).toBe(true);
  });

  it('ignores RIR when rirMin is null', () => {
    expect(hasTopSetDeficit(topSet({ reps: 5, rir: null }), 5, null)).toBe(false);
  });
});

describe('hasConsecutiveDeficit', () => {
  it('is true when both of the last two sessions show a deficit', () => {
    const sets = [topSet({ reps: 3, rir: 0 }), topSet({ reps: 4, rir: 0 })];
    expect(hasConsecutiveDeficit(sets, 5, 1)).toBe(true);
  });

  it('is false when only the most recent session shows a deficit', () => {
    const sets = [topSet({ reps: 3, rir: 0 }), topSet({ reps: 5, rir: 1 })];
    expect(hasConsecutiveDeficit(sets, 5, 1)).toBe(false);
  });

  it('is false with fewer than two sessions of history', () => {
    expect(hasConsecutiveDeficit([topSet({ reps: 3, rir: 0 })], 5, 1)).toBe(false);
    expect(hasConsecutiveDeficit([], 5, 1)).toBe(false);
  });

  it('only considers the first two entries when more are given', () => {
    const sets = [topSet({ reps: 3, rir: 0 }), topSet({ reps: 3, rir: 0 }), topSet({ reps: 5, rir: 1 })];
    expect(hasConsecutiveDeficit(sets, 5, 1)).toBe(true);
  });
});
