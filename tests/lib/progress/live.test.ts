import { detectLiveRecord } from '../../../src/lib/progress/live';
import { CachedRecords, LiveSet } from '../../../src/lib/progress/types';

const weighted: CachedRecords = { best_e1rm: 96, best_weight: 85, best_seconds: null, best_reps: null };

function live(weight: number, reps: number, set_type: LiveSet['set_type'] = 'working'): LiveSet {
  return { weight, reps, set_type };
}

describe('detectLiveRecord', () => {
  it('flags a new e1rm record', () => {
    // 82.5 x 6 = 99
    expect(detectLiveRecord(live(82.5, 6), 'reps', weighted, [])).toEqual([
      { metric: 'e1rm', value: 99, previous: 96 },
    ]);
  });

  it('flags e1rm and weight together', () => {
    // 87.5 x 3 = 96.3 (> 96) and 87.5 > 85
    expect(detectLiveRecord(live(87.5, 3), 'reps', weighted, [])).toEqual([
      { metric: 'e1rm', value: 96.3, previous: 96 },
      { metric: 'weight', value: 87.5, previous: 85 },
    ]);
  });

  it('returns nothing when no record is beaten (equal is not a record)', () => {
    expect(detectLiveRecord(live(80, 6), 'reps', weighted, [])).toEqual([]);
  });

  it('never celebrates an exercise with no cached history', () => {
    expect(detectLiveRecord(live(100, 10), 'reps', null, [])).toEqual([]);
  });

  it('ignores warmup sets', () => {
    expect(detectLiveRecord(live(100, 10, 'warmup'), 'reps', weighted, [])).toEqual([]);
  });

  it('compares against earlier sets in the same session', () => {
    const earlier = [live(82.5, 6)]; // already a PR at 99
    expect(detectLiveRecord(live(80, 7), 'reps', weighted, earlier)).toEqual([]); // 98.7 < 99
    expect(detectLiveRecord(live(85, 6), 'reps', weighted, earlier)).toEqual([
      { metric: 'e1rm', value: 102, previous: 99 },
    ]);
  });

  it('ignores warmups among earlier sets', () => {
    const earlier = [live(120, 5, 'warmup')];
    expect(detectLiveRecord(live(82.5, 6), 'reps', weighted, earlier)).toEqual([
      { metric: 'e1rm', value: 99, previous: 96 },
    ]);
  });

  it('never flags a zero-weight set on a weighted exercise', () => {
    expect(detectLiveRecord(live(0, 30), 'reps', weighted, [])).toEqual([]);
  });

  it('flags a new best time on a seconds exercise', () => {
    const seconds: CachedRecords = { best_e1rm: null, best_weight: null, best_seconds: 60, best_reps: null };
    expect(detectLiveRecord(live(0, 75), 'seconds', seconds, [])).toEqual([
      { metric: 'seconds', value: 75, previous: 60 },
    ]);
  });

  it('flags most reps on a bodyweight exercise', () => {
    const bodyweight: CachedRecords = { best_e1rm: null, best_weight: null, best_seconds: null, best_reps: 12 };
    expect(detectLiveRecord(live(0, 13), 'reps', bodyweight, [])).toEqual([
      { metric: 'reps', value: 13, previous: 12 },
    ]);
  });

  it('skips a metric whose cached value is null', () => {
    const bodyweight: CachedRecords = { best_e1rm: null, best_weight: null, best_seconds: null, best_reps: 12 };
    // First weighted set on a historically bodyweight exercise: no baseline for e1rm/weight.
    expect(detectLiveRecord(live(10, 12), 'reps', bodyweight, [])).toEqual([]);
  });
});
