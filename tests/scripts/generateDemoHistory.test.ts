import { generateDemoHistory, DemoExercise, DemoPhase } from '../../scripts/generateDemoHistory';

function exercise(overrides: Partial<DemoExercise>): DemoExercise {
  return {
    routineExerciseId: 're-bench',
    exerciseId: 'bench',
    muscleGroup: 'upper',
    role: 'main',
    scheme_type: 'normal',
    rep_unit: 'reps',
    sets: 3,
    rep_min: 8,
    rep_max: 10,
    rir_min: 1,
    rir_max: 2,
    top_set_reps: null,
    backoff_sets: null,
    backoff_rep_min: null,
    backoff_rep_max: null,
    ...overrides,
  };
}

// 2026-07-06 is a Monday.
function phase(overrides: Partial<DemoPhase> = {}): DemoPhase {
  return {
    weekdaySchedule: { mon: 'day-a', wed: 'day-b' },
    days: [
      { dayId: 'day-a', isRestDay: false, exercises: [exercise({})] },
      {
        dayId: 'day-b',
        isRestDay: false,
        exercises: [exercise({ routineExerciseId: 're-squat', exerciseId: 'squat', muscleGroup: 'lower' })],
      },
    ],
    weeks: 2,
    ...overrides,
  };
}

const base = { firstMonday: '2026-07-06', today: '2027-01-01', seed: 7, missRate: 0 };

describe('generateDemoHistory', () => {
  it('is deterministic for a given seed', () => {
    const options = { ...base, phases: [phase()], missRate: 0.5 };
    expect(generateDemoHistory(options)).toEqual(generateDemoHistory(options));
  });

  it('creates one session per scheduled weekday, in date order, with the phase week number', () => {
    const { sessions } = generateDemoHistory({ ...base, phases: [phase()] });
    expect(sessions.map((s) => [s.sessionDate, s.routineDayId, s.weekNumber])).toEqual([
      ['2026-07-06', 'day-a', 1],
      ['2026-07-08', 'day-b', 1],
      ['2026-07-13', 'day-a', 2],
      ['2026-07-15', 'day-b', 2],
    ]);
  });

  it('never generates a session on or after today', () => {
    const { sessions } = generateDemoHistory({ ...base, today: '2026-07-13', phases: [phase()] });
    expect(sessions.map((s) => s.sessionDate)).toEqual(['2026-07-06', '2026-07-08']);
  });

  it('resolves alternating weekdays by the week number within each phase', () => {
    const alternating = phase({
      weekdaySchedule: { fri: { even_week: 'day-b', odd_week: 'day-a' } },
      weeks: 2,
    });
    const { sessions } = generateDemoHistory({ ...base, phases: [phase({ weeks: 1 }), alternating] });
    // Second phase starts 2026-07-13: its week 1 (odd) -> day-a, week 2 (even) -> day-b.
    expect(sessions.slice(2).map((s) => [s.sessionDate, s.routineDayId, s.weekNumber])).toEqual([
      ['2026-07-17', 'day-a', 1],
      ['2026-07-24', 'day-b', 2],
    ]);
  });

  it('raises the weight by the muscle-group increment after every hit session', () => {
    const { sessions } = generateDemoHistory({ ...base, phases: [phase({ weeks: 3 })] });
    const benchTopWeights = sessions
      .filter((s) => s.routineDayId === 'day-a')
      .map((s) => s.sets.find((set) => set.setType === 'working')!.weight);
    const squatWeights = sessions
      .filter((s) => s.routineDayId === 'day-b')
      .map((s) => s.sets.find((set) => set.setType === 'working')!.weight);
    expect(benchTopWeights).toEqual([40, 41.25, 42.5]);
    expect(squatWeights).toEqual([60, 62.5, 65]);
  });

  it('logs the prescribed sets at target reps, plus a lighter warmup for main lifts', () => {
    const { sessions } = generateDemoHistory({ ...base, phases: [phase({ weeks: 1 })] });
    expect(sessions[0].sets).toEqual([
      { routineExerciseId: 're-bench', setIndex: 0, setType: 'warmup', weight: 20, reps: 8, rir: null },
      { routineExerciseId: 're-bench', setIndex: 1, setType: 'working', weight: 40, reps: 10, rir: 1 },
      { routineExerciseId: 're-bench', setIndex: 2, setType: 'working', weight: 40, reps: 10, rir: 1 },
      { routineExerciseId: 're-bench', setIndex: 3, setType: 'working', weight: 40, reps: 10, rir: 1 },
    ]);
  });

  it('logs top set + lighter back-off sets for top_set_backoff exercises', () => {
    const topSet = exercise({
      scheme_type: 'top_set_backoff',
      sets: null,
      rep_min: null,
      rep_max: null,
      top_set_reps: 5,
      backoff_sets: 2,
      backoff_rep_min: 8,
      backoff_rep_max: 10,
    });
    const { sessions } = generateDemoHistory({
      ...base,
      phases: [phase({ weekdaySchedule: { mon: 'day-a' }, days: [{ dayId: 'day-a', isRestDay: false, exercises: [topSet] }], weeks: 1 })],
    });
    expect(sessions[0].sets.filter((s) => s.setType !== 'warmup')).toEqual([
      { routineExerciseId: 're-bench', setIndex: 1, setType: 'top_set', weight: 40, reps: 5, rir: 1 },
      { routineExerciseId: 're-bench', setIndex: 2, setType: 'back_off', weight: 33.75, reps: 10, rir: 1 },
      { routineExerciseId: 're-bench', setIndex: 3, setType: 'back_off', weight: 33.75, reps: 10, rir: 1 },
    ]);
  });

  it('makes a missed session stall the weight instead of raising it', () => {
    const { sessions } = generateDemoHistory({ ...base, missRate: 1, phases: [phase({ weeks: 2 })] });
    const bench = sessions.filter((s) => s.routineDayId === 'day-a');
    expect(bench.map((s) => s.sets.find((set) => set.setType === 'working')!.weight)).toEqual([40, 40]);
    const lastSet = bench[0].sets[bench[0].sets.length - 1];
    expect(lastSet).toMatchObject({ reps: 8, rir: 0 });
  });

  it('lightens deload weeks without advancing progression', () => {
    const { sessions } = generateDemoHistory({ ...base, deloadWeeks: [2], phases: [phase({ weeks: 3 })] });
    const bench = sessions
      .filter((s) => s.routineDayId === 'day-a')
      .map((s) => s.sets.find((set) => set.setType === 'working')!.weight);
    // week 1: 40 (hit -> 41.25), week 2 deload: 85% of 41.25 rounded to 1.25 = 35, week 3: back to 41.25
    expect(bench).toEqual([40, 35, 41.25]);
  });

  it('logs time-based exercises with weight 0 and growing seconds', () => {
    const plank = exercise({
      routineExerciseId: 're-plank',
      exerciseId: 'plank',
      muscleGroup: 'core',
      role: 'core',
      rep_unit: 'seconds',
      sets: 2,
      rep_min: 30,
      rep_max: 45,
      rir_min: null,
      rir_max: null,
    });
    const { sessions, finalStates } = generateDemoHistory({
      ...base,
      phases: [phase({ weekdaySchedule: { mon: 'day-a' }, days: [{ dayId: 'day-a', isRestDay: false, exercises: [plank] }], weeks: 3 })],
    });
    expect(sessions.map((s) => s.sets.map((set) => [set.weight, set.reps, set.rir]))).toEqual([
      [[0, 30, null], [0, 30, null]],
      [[0, 35, null], [0, 35, null]],
      [[0, 40, null], [0, 40, null]],
    ]);
    expect(finalStates).toEqual([]);
  });

  it('skips rest days and unscheduled weekdays', () => {
    const { sessions } = generateDemoHistory({
      ...base,
      phases: [
        phase({
          weekdaySchedule: { mon: 'day-a', tue: 'rest' },
          days: [
            { dayId: 'day-a', isRestDay: false, exercises: [exercise({})] },
            { dayId: 'rest', isRestDay: true, exercises: [] },
          ],
          weeks: 1,
        }),
      ],
    });
    expect(sessions.map((s) => s.routineDayId)).toEqual(['day-a']);
  });

  it('returns the progression state each weighted exercise ends in', () => {
    const { finalStates } = generateDemoHistory({ ...base, phases: [phase({ weeks: 2 })] });
    expect(finalStates).toEqual([
      { exerciseId: 'bench', current_weight: 41.25, suggested_next_weight: 42.5, consecutive_hit_count: 2, consecutive_miss_count: 0 },
      { exerciseId: 'squat', current_weight: 62.5, suggested_next_weight: 65, consecutive_hit_count: 2, consecutive_miss_count: 0 },
    ]);
  });
});
