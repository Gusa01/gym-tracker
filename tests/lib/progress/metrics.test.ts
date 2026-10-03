import {
  estimate1RM,
  metricKind,
  primaryMetric,
  metricValue,
  bestSetPerSession,
  sortChronologically,
} from '../../../src/lib/progress/metrics';
import { ProgressSet } from '../../../src/lib/progress/types';

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

describe('estimate1RM', () => {
  it('applies Epley for more than one rep', () => {
    expect(estimate1RM(80, 6)).toBe(96);
  });

  it('returns the weight itself for a single rep', () => {
    expect(estimate1RM(100, 1)).toBe(100);
  });

  it('rounds to 0.1', () => {
    // 82.5 * (1 + 7/30) = 101.75 -> 101.8
    expect(estimate1RM(82.5, 7)).toBe(101.8);
  });

  it('returns null for zero weight or zero reps', () => {
    expect(estimate1RM(0, 10)).toBeNull();
    expect(estimate1RM(80, 0)).toBeNull();
  });
});

describe('sortChronologically', () => {
  it('orders by session_date then created_at without mutating the input', () => {
    const a = set({ session_date: '2026-09-02', created_at: '2026-09-02T10:00:00Z' });
    const b = set({ session_date: '2026-09-01', created_at: '2026-09-01T11:00:00Z' });
    const c = set({ session_date: '2026-09-01', created_at: '2026-09-01T10:00:00Z' });
    const input = [a, b, c];
    expect(sortChronologically(input)).toEqual([c, b, a]);
    expect(input).toEqual([a, b, c]);
  });
});

describe('metricKind', () => {
  it('is seconds when the most recent set is time-based', () => {
    expect(metricKind([set({ rep_unit: 'seconds', weight: 0, reps: 60 })])).toBe('seconds');
  });

  it('uses the most recent set when rep_unit differs across sets', () => {
    const older = set({ rep_unit: 'reps', session_date: '2026-09-01' });
    const newer = set({ rep_unit: 'seconds', session_date: '2026-09-08', weight: 0, reps: 45 });
    expect(metricKind([newer, older])).toBe('seconds');
  });

  it('is bodyweight when every set has weight 0', () => {
    expect(metricKind([set({ weight: 0, reps: 12 }), set({ weight: 0, reps: 10 })])).toBe('bodyweight');
  });

  it('is weighted when at least one set has weight above 0', () => {
    expect(metricKind([set({ weight: 0, reps: 12 }), set({ weight: 20, reps: 10 })])).toBe('weighted');
  });
});

describe('primaryMetric', () => {
  it('maps each kind to its main metric', () => {
    expect(primaryMetric('weighted')).toBe('e1rm');
    expect(primaryMetric('seconds')).toBe('seconds');
    expect(primaryMetric('bodyweight')).toBe('reps');
  });
});

describe('metricValue', () => {
  it('ignores zero-weight sets for weight-based metrics', () => {
    expect(metricValue({ weight: 0, reps: 10 }, 'e1rm')).toBeNull();
    expect(metricValue({ weight: 0, reps: 10 }, 'weight')).toBeNull();
  });

  it('reads reps for seconds and reps metrics', () => {
    expect(metricValue({ weight: 0, reps: 75 }, 'seconds')).toBe(75);
    expect(metricValue({ weight: 0, reps: 12 }, 'reps')).toBe(12);
  });
});

describe('bestSetPerSession', () => {
  it('returns one point per session, sorted by date, keeping the source set', () => {
    const points = bestSetPerSession(
      [
        set({ session_id: 's2', session_date: '2026-09-08', weight: 85, reps: 3 }),
        set({ session_id: 's1', session_date: '2026-09-01', weight: 80, reps: 6 }),
        set({ session_id: 's1', session_date: '2026-09-01', weight: 70, reps: 8 }),
      ],
      'e1rm'
    );
    expect(points).toEqual([
      { sessionId: 's1', date: '2026-09-01', value: 96, weight: 80, reps: 6 },
      { sessionId: 's2', date: '2026-09-08', value: 93.5, weight: 85, reps: 3 },
    ]);
  });

  it('picks the heaviest set in the weight view', () => {
    const points = bestSetPerSession(
      [set({ weight: 80, reps: 6 }), set({ weight: 85, reps: 3 })],
      'weight'
    );
    expect(points).toEqual([{ sessionId: 's1', date: '2026-09-01', value: 85, weight: 85, reps: 3 }]);
  });

  it('breaks e1rm ties with the heavier weight', () => {
    // 90 x 1 = 90 and 75 x 6 = 90
    const points = bestSetPerSession([set({ weight: 75, reps: 6 }), set({ weight: 90, reps: 1 })], 'e1rm');
    expect(points[0]).toMatchObject({ value: 90, weight: 90, reps: 1 });
  });

  it('breaks weight ties with more reps', () => {
    const points = bestSetPerSession([set({ weight: 80, reps: 5 }), set({ weight: 80, reps: 7 })], 'weight');
    expect(points[0]).toMatchObject({ value: 80, reps: 7 });
  });

  it('skips sessions with no value for the metric', () => {
    expect(bestSetPerSession([set({ weight: 0, reps: 10 })], 'e1rm')).toEqual([]);
  });
});
