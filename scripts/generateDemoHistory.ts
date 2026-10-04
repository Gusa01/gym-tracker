import { resolveTodayDayId } from '../src/lib/sessions/weekResolution';
import { buildPrescribedSets } from '../src/lib/sessions/prescribedSets';
import { computeWeightIncrement, getTargetRepsForSet } from '../src/lib/progression/rules';
import { SetType } from '../src/lib/sessions/types';
import {
  RoutineExerciseRepUnit,
  RoutineExerciseRole,
  RoutineExerciseSchemeType,
  Weekday,
} from '../src/lib/routines/types';

export interface DemoExercise {
  routineExerciseId: string;
  exerciseId: string;
  muscleGroup: string;
  role: RoutineExerciseRole;
  scheme_type: RoutineExerciseSchemeType;
  rep_unit: RoutineExerciseRepUnit;
  sets: number | null;
  rep_min: number | null;
  rep_max: number | null;
  rir_min: number | null;
  rir_max: number | null;
  top_set_reps: number | null;
  backoff_sets: number | null;
  backoff_rep_min: number | null;
  backoff_rep_max: number | null;
}

export interface DemoDay {
  dayId: string;
  isRestDay: boolean;
  exercises: DemoExercise[];
}

/** One routine run for `weeks` consecutive weeks; week numbers restart at 1 per phase. */
export interface DemoPhase {
  weekdaySchedule: Record<string, unknown>;
  days: DemoDay[];
  weeks: number;
}

export interface DemoSet {
  routineExerciseId: string;
  setIndex: number;
  setType: SetType;
  weight: number;
  reps: number;
  rir: number | null;
}

export interface DemoSession {
  routineDayId: string;
  sessionDate: string;
  weekNumber: number;
  sets: DemoSet[];
}

export interface DemoExerciseState {
  exerciseId: string;
  current_weight: number;
  suggested_next_weight: number;
  consecutive_hit_count: number;
  consecutive_miss_count: number;
}

export interface DemoHistoryOptions {
  phases: DemoPhase[];
  /** Monday (YYYY-MM-DD) the first phase starts on. */
  firstMonday: string;
  /** Sessions are only generated strictly before this date (YYYY-MM-DD). */
  today: string;
  seed: number;
  /** 1-based week numbers counted across all phases. */
  deloadWeeks?: number[];
  /** Chance that a weighted exercise misses its last set in a session. */
  missRate?: number;
}

const WEEK: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEIGHT_STEP = 1.25;
const DELOAD_FACTOR = 0.85;
const BACKOFF_FACTOR = 0.85;
const WARMUP_FACTOR = 0.5;
const WARMUP_REPS = 8;
const SECONDS_STEP = 5;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** mulberry32: tiny seeded PRNG so the demo history is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundToStep(weight: number): number {
  return Math.round(weight / WEIGHT_STEP) * WEIGHT_STEP;
}

function startingWeight(exercise: DemoExercise): number {
  if (exercise.rep_unit === 'seconds' || exercise.muscleGroup === 'core') return 0;
  if (exercise.muscleGroup === 'lower') return exercise.role === 'main' ? 60 : 30;
  return exercise.role === 'main' ? 40 : 10;
}

interface RunningState {
  nextWeight: number;
  lastWeight: number | null;
  hits: number;
  misses: number;
  sessions: number;
}

export function generateDemoHistory(options: DemoHistoryOptions): {
  sessions: DemoSession[];
  finalStates: DemoExerciseState[];
} {
  const random = seededRandom(options.seed);
  const missRate = options.missRate ?? 0.2;
  const deloadWeeks = new Set(options.deloadWeeks ?? []);
  const states = new Map<string, RunningState>();
  const weightedExerciseIds = new Set<string>();
  const sessions: DemoSession[] = [];

  let monday = options.firstMonday;
  let globalWeek = 0;

  for (const phase of options.phases) {
    for (let week = 1; week <= phase.weeks; week++) {
      globalWeek++;
      const isDeload = deloadWeeks.has(globalWeek);

      WEEK.forEach((weekday, offset) => {
        const sessionDate = addDays(monday, offset);
        if (sessionDate >= options.today) return;
        const dayId = resolveTodayDayId(phase.weekdaySchedule, weekday, week);
        const day = phase.days.find((d) => d.dayId === dayId);
        if (!day || day.isRestDay || day.exercises.length === 0) return;

        const sets: DemoSet[] = [];
        for (const exercise of day.exercises) {
          const initial = startingWeight(exercise);
          const state = states.get(exercise.exerciseId) ?? {
            nextWeight: initial,
            lastWeight: null,
            hits: 0,
            misses: 0,
            sessions: 0,
          };
          states.set(exercise.exerciseId, state);
          const weighted = initial > 0;
          if (weighted) weightedExerciseIds.add(exercise.exerciseId);

          const workWeight = isDeload && weighted ? roundToStep(state.nextWeight * DELOAD_FACTOR) : state.nextWeight;
          const prescribed = buildPrescribedSets(exercise);
          const missed = weighted && !isDeload && random() < missRate;

          if (weighted && exercise.role === 'main') {
            sets.push({
              routineExerciseId: exercise.routineExerciseId,
              setIndex: 0,
              setType: 'warmup',
              weight: roundToStep(workWeight * WARMUP_FACTOR),
              reps: WARMUP_REPS,
              rir: null,
            });
          }

          prescribed.forEach((p, i) => {
            const isMissedSet = missed && i === prescribed.length - 1;
            let reps: number;
            if (exercise.rep_unit === 'seconds') {
              const start = exercise.rep_min ?? 30;
              reps = Math.min(start + SECONDS_STEP * state.sessions, (exercise.rep_max ?? start) + 30);
            } else {
              const target = getTargetRepsForSet(exercise, p.setType);
              reps = isMissedSet ? Math.max(1, target - 2) : target;
            }
            sets.push({
              routineExerciseId: exercise.routineExerciseId,
              setIndex: p.setIndex,
              setType: p.setType,
              weight: p.setType === 'back_off' ? roundToStep(workWeight * BACKOFF_FACTOR) : workWeight,
              reps,
              rir: isMissedSet ? 0 : exercise.rir_min,
            });
          });

          if (weighted && !isDeload) {
            state.lastWeight = workWeight;
            if (missed) {
              state.misses++;
              state.hits = 0;
            } else {
              state.hits++;
              state.misses = 0;
              state.nextWeight = workWeight + computeWeightIncrement(exercise.muscleGroup);
            }
          }
          state.sessions++;
        }

        sessions.push({ routineDayId: day.dayId, sessionDate, weekNumber: week, sets });
      });

      monday = addDays(monday, 7);
    }
  }

  const finalStates: DemoExerciseState[] = [];
  states.forEach((state, exerciseId) => {
    if (!weightedExerciseIds.has(exerciseId) || state.lastWeight === null) return;
    finalStates.push({
      exerciseId,
      current_weight: state.lastWeight,
      suggested_next_weight: state.nextWeight,
      consecutive_hit_count: state.hits,
      consecutive_miss_count: state.misses,
    });
  });

  return { sessions, finalStates };
}
