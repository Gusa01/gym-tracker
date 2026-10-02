import {
  computeRecords,
  toCachedRecords,
  mergeCachedRecords,
  groupByExercise,
  recordsByExercise,
} from '../../../src/lib/progress/records';
import { ExerciseSetRow, ProgressSet } from '../../../src/lib/progress/types';

function set(overrides: Partial<ProgressSet>): ProgressSet {
  return {
    session_id: 's1',
    session_date: '2026-09-01',
    weight: 80,
    reps: 6,
    rep_unit: 'reps',
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

function row(overrides: Partial<ExerciseSetRow>): ExerciseSetRow {
  return {
    ...set({}),
    logged_set_id: 'l1',
    user_id: 'u1',
    exercise_id: 'bench',
    exercise_name: 'Press banca',
    set_index: 1,
    set_type: 'working',
    ...overrides,
  };
}

describe('computeRecords', () => {
  it('finds best e1rm and best weight with their source set and date for a weighted exercise', () => {
    const records = computeRecords([
      set({ session_date: '2026-09-12', weight: 80, reps: 6 }),
      set({ session_date: '2026-09-20', weight: 85, reps: 3 }),
    ]);
    expect(records).toEqual({
      kind: 'weighted',
      bestE1rm: { value: 96, weight: 80, reps: 6, date: '2026-09-12' },
      bestWeight: { value: 85, weight: 85, reps: 3, date: '2026-09-20' },
      bestSeconds: null,
      bestReps: null,
    });
  });

  it('dates a tied record on the day it was first reached', () => {
    const records = computeRecords([
      set({ session_date: '2026-09-20', weight: 85, reps: 3 }),
      set({ session_date: '2026-09-10', weight: 85, reps: 2 }),
    ]);
    expect(records.bestWeight).toEqual({ value: 85, weight: 85, reps: 2, date: '2026-09-10' });
  });

  it('ignores zero-weight sets on a weighted exercise', () => {
    const records = computeRecords([set({ weight: 0, reps: 20 }), set({ weight: 20, reps: 10 })]);
    expect(records.bestWeight?.value).toBe(20);
    expect(records.bestReps).toBeNull();
  });

  it('records best time for a seconds exercise', () => {
    const records = computeRecords([
      set({ rep_unit: 'seconds', weight: 0, reps: 60 }),
      set({ rep_unit: 'seconds', weight: 0, reps: 75, session_date: '2026-09-05' }),
    ]);
    expect(records).toEqual({
      kind: 'seconds',
      bestE1rm: null,
      bestWeight: null,
      bestSeconds: { value: 75, weight: 0, reps: 75, date: '2026-09-05' },
      bestReps: null,
    });
  });

  it('records most reps for a bodyweight exercise', () => {
    const records = computeRecords([set({ weight: 0, reps: 12 }), set({ weight: 0, reps: 15 })]);
    expect(records.kind).toBe('bodyweight');
    expect(records.bestReps?.value).toBe(15);
  });
});

describe('toCachedRecords', () => {
  it('flattens records into cache columns', () => {
    const records = computeRecords([set({ weight: 80, reps: 6 })]);
    expect(toCachedRecords(records)).toEqual({ best_e1rm: 96, best_weight: 80, best_seconds: null, best_reps: null });
  });
});

describe('mergeCachedRecords', () => {
  it('keeps the max of each column and treats null as missing', () => {
    expect(
      mergeCachedRecords(
        { best_e1rm: 96, best_weight: 85, best_seconds: null, best_reps: null },
        { best_e1rm: 98, best_weight: 80, best_seconds: null, best_reps: 12 }
      )
    ).toEqual({ best_e1rm: 98, best_weight: 85, best_seconds: null, best_reps: null });
  });

  it('ignores incoming best_reps when the existing row already has weighted data', () => {
    expect(
      mergeCachedRecords(
        { best_e1rm: 96, best_weight: 85, best_seconds: null, best_reps: null },
        { best_e1rm: null, best_weight: null, best_seconds: null, best_reps: 30 }
      )
    ).toEqual({ best_e1rm: 96, best_weight: 85, best_seconds: null, best_reps: null });
  });

  it('returns the incoming records when there is nothing cached', () => {
    const incoming = { best_e1rm: 90, best_weight: 80, best_seconds: null, best_reps: null };
    expect(mergeCachedRecords(null, incoming)).toEqual(incoming);
  });
});

describe('groupByExercise / recordsByExercise', () => {
  it('groups rows by exercise_id and computes cache records per exercise', () => {
    const rows = [
      row({ exercise_id: 'bench', weight: 80, reps: 6 }),
      row({ exercise_id: 'plank', exercise_name: 'Plancha', rep_unit: 'seconds', weight: 0, reps: 60 }),
      row({ exercise_id: 'bench', weight: 85, reps: 3 }),
    ];
    expect(groupByExercise(rows).get('bench')).toHaveLength(2);
    const records = recordsByExercise(rows);
    expect(records.get('bench')).toEqual({ best_e1rm: 96, best_weight: 85, best_seconds: null, best_reps: null });
    expect(records.get('plank')).toEqual({ best_e1rm: null, best_weight: null, best_seconds: 60, best_reps: null });
  });
});
