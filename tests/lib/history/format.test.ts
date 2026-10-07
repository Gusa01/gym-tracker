import { formatSessionTitle, formatSetLabel, formatSetValues } from '../../../src/lib/history/format';
import { LoggedSet } from '../../../src/lib/sessions/types';

function set(overrides: Partial<LoggedSet>): LoggedSet {
  return {
    id: 's1',
    session_id: 'sess',
    routine_exercise_id: 're',
    set_index: 1,
    set_type: 'working',
    weight: 80,
    reps: 8,
    rir: 2,
    created_at: '2026-10-01T18:00:00Z',
    ...overrides,
  };
}

describe('formatSessionTitle', () => {
  it('shows the Spanish weekday, DD/MM and the day name', () => {
    expect(formatSessionTitle('2026-10-01', 'Push')).toBe('Jue 01/10 · Push'); // a Thursday
    expect(formatSessionTitle('2026-10-05', 'Upper')).toBe('Lun 05/10 · Upper');
    expect(formatSessionTitle('2026-10-04', 'Legs')).toBe('Dom 04/10 · Legs');
  });

  it('drops the separator when there is no day name', () => {
    expect(formatSessionTitle('2026-10-01', '')).toBe('Jue 01/10');
  });
});

describe('formatSetLabel', () => {
  it('names each set type', () => {
    expect(formatSetLabel(set({ set_type: 'top_set' }))).toBe('Top set');
    expect(formatSetLabel(set({ set_type: 'back_off' }))).toBe('Back-off');
    expect(formatSetLabel(set({ set_type: 'working', set_index: 3 }))).toBe('Serie 3');
    expect(formatSetLabel(set({ set_type: 'warmup' }))).toBe('Entrada en calor');
  });
});

describe('formatSetValues', () => {
  it('shows weight x reps and RIR for weighted sets', () => {
    expect(formatSetValues(set({ weight: 82.5, reps: 6, rir: 1 }), 'reps')).toBe('82.5 kg × 6 · RIR 1');
    expect(formatSetValues(set({ rir: null }), 'reps')).toBe('80 kg × 8');
  });

  it('shows seconds for time-based sets and reps for zero-weight sets', () => {
    expect(formatSetValues(set({ weight: 0, reps: 45, rir: null }), 'seconds')).toBe('45 s');
    expect(formatSetValues(set({ weight: 0, reps: 12, rir: null }), 'reps')).toBe('12 reps');
  });
});
