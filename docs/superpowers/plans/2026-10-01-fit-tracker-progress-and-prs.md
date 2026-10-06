# Progress Charts & Personal Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Progress section (per-exercise list with trend arrows, detail screen with a line chart and personal records) and live "¡Nuevo PR!" detection during a session that works offline.

**Architecture:** A Postgres view (`exercise_set_history`, `security_invoker`) joins logged sets to their catalog exercise and filters to qualifying sets. A paginated query reads it. All math (1RM, best set per session, records, weekly trend, live PR) lives in pure TypeScript under `src/lib/progress/`, shared by the screens and by live detection. A small SQLite table (`exercise_records_cache`) holds each exercise's bests so live detection works offline.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / expo-router drawer + stack, Supabase (Postgres view + supabase-js v2), expo-sqlite, Jest + ts-jest, `react-native-gifted-charts` (+ `react-native-svg`, `expo-linear-gradient`).

**Spec:** `docs/superpowers/specs/2026-10-01-fit-tracker-progress-and-prs-design.md`

## Global Constraints

- Work in the worktree `B:\Gusa\Dev\fit-tracker\.claude\worktrees\fit-tracker-foundation` on branch `progress-and-prs`. Run every command from that directory.
- All user-facing copy is Spanish (rioplatense), exactly as written in this plan.
- Never hard-delete rows (`.delete()`) in app code. Tests may delete their own test users.
- Modules under `src/lib/progress/` (except `queries.ts`) must not import React, React Native, Expo, expo-sqlite, or Supabase. They are pure and unit-tested.
- Unit tests live in `tests/lib/progress/*.test.ts`. Any test that talks to Supabase must be named `*.integration.test.ts` (the Jest `integration` project picks it up; the `unit` project ignores it).
- Imports use relative paths, matching the existing code (`../../../src/...` from `app/(app)/<dir>/`).
- `router.push` to dynamic routes uses the existing pattern: a fully-qualified path string cast with `as any`, e.g. `router.push(\`/(app)/progress/${id}\` as any)`.
- 1RM formula (Epley): `weight` if `reps = 1`, else `weight × (1 + reps / 30)`; `null` if `weight <= 0` or `reps <= 0`; rounded to 0.1.
- Trend threshold: strictly above +1% is `up`, strictly below −1% is `down`, otherwise `flat`. Weeks run Monday to Sunday.
- Live PR: no celebration when the exercise has no row in `exercise_records_cache`, or when the metric's cached value is `null`. A record breaks only when strictly greater than the baseline.
- Verification commands: `npm run typecheck`, `npm run test:unit`, `npx jest <path>` for a single file.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/progress/types.ts` (create) | All shared types for the feature |
| `src/lib/progress/metrics.ts` (create) | `estimate1RM`, ordering, metric kind, metric value, best set per session |
| `src/lib/progress/records.ts` (create) | Personal records, cache-shaped records, merging, grouping by exercise |
| `src/lib/progress/trend.ts` (create) | Monday week bucketing and week-over-week trend |
| `src/lib/progress/summary.ts` (create) | List rows for the Progress screen |
| `src/lib/progress/live.ts` (create) | Live PR detection |
| `src/lib/progress/format.ts` (create) | Display strings (values, dates, banner text) |
| `src/lib/progress/queries.ts` (create) | Paginated read of the view |
| `supabase/migrations/20261001120000_exercise_set_history_view.sql` (create) | The view |
| `src/lib/sqlite/schema.ts` (modify) | New `exercise_records_cache` table |
| `src/lib/sqlite/cache.ts` (modify) | Read/merge records cache; refresh it in `refreshLocalCache` |
| `src/components/PrBanner.tsx` (create) | Auto-dismissing PR banner |
| `src/hooks/useSessionSets.ts` (modify) | Live PR detection in `logSet`; merge bests in `completeSession` |
| `app/(app)/session/[sessionId].tsx` (modify) | Render the banner |
| `src/hooks/useExerciseProgress.ts` (create) | Data hooks for list and detail |
| `app/(app)/progress/_layout.tsx`, `index.tsx`, `[exerciseId].tsx` (create) | Screens |
| `app/(app)/_layout.tsx` (modify) | Drawer item "Progreso" |

---

### Task 1: Types and core metrics

**Files:**
- Create: `src/lib/progress/types.ts`
- Create: `src/lib/progress/metrics.ts`
- Test: `tests/lib/progress/metrics.test.ts`

**Interfaces:**
- Consumes: `RoutineExerciseRepUnit` from `src/lib/routines/types.ts` (`'reps' | 'seconds'`), `SetType` from `src/lib/sessions/types.ts` (`'top_set' | 'back_off' | 'working' | 'warmup'`).
- Produces: every type in `types.ts`; `estimate1RM(weight: number, reps: number): number | null`; `sortChronologically<T extends ProgressSet>(sets: T[]): T[]`; `metricKind(sets: ProgressSet[]): MetricKind`; `primaryMetric(kind: MetricKind): Metric`; `metricValue(set: { weight: number; reps: number }, metric: Metric): number | null`; `bestSetPerSession(sets: ProgressSet[], metric: Metric): ChartPoint[]`.

- [ ] **Step 1: Create the types file**

`src/lib/progress/types.ts`:

```typescript
import { RoutineExerciseRepUnit } from '../routines/types';
import { SetType } from '../sessions/types';

/** The minimum a set needs for progress math. `session_date` is `YYYY-MM-DD`. */
export interface ProgressSet {
  session_id: string;
  session_date: string;
  weight: number;
  reps: number;
  rep_unit: RoutineExerciseRepUnit;
  created_at: string;
}

/** One row of the `exercise_set_history` view. */
export interface ExerciseSetRow extends ProgressSet {
  logged_set_id: string;
  user_id: string;
  exercise_id: string;
  exercise_name: string;
  set_index: number;
  set_type: SetType;
}

export type MetricKind = 'weighted' | 'seconds' | 'bodyweight';
export type Metric = 'e1rm' | 'weight' | 'seconds' | 'reps';

export interface ChartPoint {
  sessionId: string;
  date: string;
  value: number;
  weight: number;
  reps: number;
}

export interface RecordEntry {
  value: number;
  weight: number;
  reps: number;
  date: string;
}

export interface ExerciseRecords {
  kind: MetricKind;
  bestE1rm: RecordEntry | null;
  bestWeight: RecordEntry | null;
  bestSeconds: RecordEntry | null;
  bestReps: RecordEntry | null;
}

/** Shape of one `exercise_records_cache` row (minus the key). */
export interface CachedRecords {
  best_e1rm: number | null;
  best_weight: number | null;
  best_seconds: number | null;
  best_reps: number | null;
}

export type Trend = 'up' | 'flat' | 'down';

export interface WeeklyTrend {
  trend: Trend | null;
  latestWeekValue: number | null;
}

export interface ExerciseSummary {
  exerciseId: string;
  exerciseName: string;
  kind: MetricKind;
  metric: Metric;
  latestValue: number | null;
  trend: Trend | null;
  lastTrainedDate: string;
}

export interface LiveSet {
  weight: number;
  reps: number;
  set_type: SetType;
}

export interface BrokenRecord {
  metric: Metric;
  value: number;
  previous: number;
}

export interface PrBannerData {
  id: string;
  exerciseName: string;
  broken: BrokenRecord[];
}
```

- [ ] **Step 2: Write the failing tests**

`tests/lib/progress/metrics.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest tests/lib/progress/metrics.test.ts`
Expected: FAIL, "Cannot find module '../../../src/lib/progress/metrics'".

- [ ] **Step 4: Implement**

`src/lib/progress/metrics.ts`:

```typescript
import { ChartPoint, Metric, MetricKind, ProgressSet } from './types';

/** Epley estimated one-rep max, rounded to 0.1. Null when the set can't produce one. */
export function estimate1RM(weight: number, reps: number): number | null {
  if (weight <= 0 || reps <= 0) return null;
  const raw = reps === 1 ? weight : weight * (1 + reps / 30);
  return Math.round(raw * 10) / 10;
}

function compareChronologically(a: ProgressSet, b: ProgressSet): number {
  if (a.session_date !== b.session_date) return a.session_date < b.session_date ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return 0;
}

export function sortChronologically<T extends ProgressSet>(sets: T[]): T[] {
  return [...sets].sort(compareChronologically);
}

export function metricKind(sets: ProgressSet[]): MetricKind {
  const sorted = sortChronologically(sets);
  const latest = sorted[sorted.length - 1];
  if (latest && latest.rep_unit === 'seconds') return 'seconds';
  return sets.some((s) => s.weight > 0) ? 'weighted' : 'bodyweight';
}

const PRIMARY_METRIC: Record<MetricKind, Metric> = {
  weighted: 'e1rm',
  seconds: 'seconds',
  bodyweight: 'reps',
};

export function primaryMetric(kind: MetricKind): Metric {
  return PRIMARY_METRIC[kind];
}

export function metricValue(set: { weight: number; reps: number }, metric: Metric): number | null {
  switch (metric) {
    case 'e1rm':
      return estimate1RM(set.weight, set.reps);
    case 'weight':
      return set.weight > 0 ? set.weight : null;
    case 'seconds':
    case 'reps':
      return set.reps > 0 ? set.reps : null;
  }
}

function beats(candidate: ProgressSet, value: number, current: ChartPoint, metric: Metric): boolean {
  if (value !== current.value) return value > current.value;
  if (metric === 'e1rm') return candidate.weight > current.weight;
  if (metric === 'weight') return candidate.reps > current.reps;
  return false;
}

/** One chart point per session: the session's best set for `metric`, sorted by date. */
export function bestSetPerSession(sets: ProgressSet[], metric: Metric): ChartPoint[] {
  const bestBySession = new Map<string, ChartPoint>();
  for (const set of sortChronologically(sets)) {
    const value = metricValue(set, metric);
    if (value === null) continue;
    const current = bestBySession.get(set.session_id);
    if (!current || beats(set, value, current, metric)) {
      bestBySession.set(set.session_id, {
        sessionId: set.session_id,
        date: set.session_date,
        value,
        weight: set.weight,
        reps: set.reps,
      });
    }
  }
  return [...bestBySession.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/lib/progress/metrics.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` (expected: exit 0)

```bash
git add src/lib/progress/types.ts src/lib/progress/metrics.ts tests/lib/progress/metrics.test.ts
git commit -m "feat: add progress types and core 1RM/best-set metrics"
```

---

### Task 2: Personal records

**Files:**
- Create: `src/lib/progress/records.ts`
- Test: `tests/lib/progress/records.test.ts`

**Interfaces:**
- Consumes (Task 1): `ProgressSet`, `ExerciseSetRow`, `ExerciseRecords`, `RecordEntry`, `CachedRecords`, `Metric`; `metricKind`, `metricValue`, `sortChronologically`.
- Produces: `computeRecords(sets: ProgressSet[]): ExerciseRecords`; `toCachedRecords(records: ExerciseRecords): CachedRecords`; `mergeCachedRecords(existing: CachedRecords | null, incoming: CachedRecords): CachedRecords`; `groupByExercise(rows: ExerciseSetRow[]): Map<string, ExerciseSetRow[]>`; `recordsByExercise(rows: ExerciseSetRow[]): Map<string, CachedRecords>`.

- [ ] **Step 1: Write the failing tests**

`tests/lib/progress/records.test.ts`:

```typescript
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
    ).toEqual({ best_e1rm: 98, best_weight: 85, best_seconds: null, best_reps: 12 });
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/progress/records.test.ts`
Expected: FAIL, "Cannot find module '../../../src/lib/progress/records'".

- [ ] **Step 3: Implement**

`src/lib/progress/records.ts`:

```typescript
import { CachedRecords, ExerciseRecords, ExerciseSetRow, Metric, ProgressSet, RecordEntry } from './types';
import { metricKind, metricValue, sortChronologically } from './metrics';

/** Strictly-greater scan in chronological order, so a tie keeps the earliest date. */
function bestEntry(sets: ProgressSet[], metric: Metric): RecordEntry | null {
  let best: RecordEntry | null = null;
  for (const set of sortChronologically(sets)) {
    const value = metricValue(set, metric);
    if (value === null) continue;
    if (!best || value > best.value) {
      best = { value, weight: set.weight, reps: set.reps, date: set.session_date };
    }
  }
  return best;
}

export function computeRecords(sets: ProgressSet[]): ExerciseRecords {
  const kind = metricKind(sets);
  return {
    kind,
    bestE1rm: kind === 'weighted' ? bestEntry(sets, 'e1rm') : null,
    bestWeight: kind === 'weighted' ? bestEntry(sets, 'weight') : null,
    bestSeconds: kind === 'seconds' ? bestEntry(sets, 'seconds') : null,
    bestReps: kind === 'bodyweight' ? bestEntry(sets, 'reps') : null,
  };
}

export function toCachedRecords(records: ExerciseRecords): CachedRecords {
  return {
    best_e1rm: records.bestE1rm?.value ?? null,
    best_weight: records.bestWeight?.value ?? null,
    best_seconds: records.bestSeconds?.value ?? null,
    best_reps: records.bestReps?.value ?? null,
  };
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

export function mergeCachedRecords(existing: CachedRecords | null, incoming: CachedRecords): CachedRecords {
  if (!existing) return incoming;
  return {
    best_e1rm: maxNullable(existing.best_e1rm, incoming.best_e1rm),
    best_weight: maxNullable(existing.best_weight, incoming.best_weight),
    best_seconds: maxNullable(existing.best_seconds, incoming.best_seconds),
    best_reps: maxNullable(existing.best_reps, incoming.best_reps),
  };
}

export function groupByExercise(rows: ExerciseSetRow[]): Map<string, ExerciseSetRow[]> {
  const groups = new Map<string, ExerciseSetRow[]>();
  for (const row of rows) {
    const group = groups.get(row.exercise_id);
    if (group) group.push(row);
    else groups.set(row.exercise_id, [row]);
  }
  return groups;
}

export function recordsByExercise(rows: ExerciseSetRow[]): Map<string, CachedRecords> {
  const result = new Map<string, CachedRecords>();
  groupByExercise(rows).forEach((sets, exerciseId) => {
    result.set(exerciseId, toCachedRecords(computeRecords(sets)));
  });
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/progress/records.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` (expected: exit 0)

```bash
git add src/lib/progress/records.ts tests/lib/progress/records.test.ts
git commit -m "feat: compute personal records and cache-shaped bests"
```

---

### Task 3: Weekly trend and list summary

**Files:**
- Create: `src/lib/progress/trend.ts`
- Create: `src/lib/progress/summary.ts`
- Test: `tests/lib/progress/trend.test.ts`
- Test: `tests/lib/progress/summary.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `ProgressSet`, `ExerciseSetRow`, `ExerciseSummary`, `Metric`, `Trend`, `WeeklyTrend`; `metricValue`, `metricKind`, `primaryMetric`, `sortChronologically`; `groupByExercise`.
- Produces: `weekStart(date: string): string`; `computeWeeklyTrend(sets: ProgressSet[], metric: Metric): WeeklyTrend`; `summarizeExercises(rows: ExerciseSetRow[]): ExerciseSummary[]`.

- [ ] **Step 1: Write the failing trend tests**

`tests/lib/progress/trend.test.ts`:

```typescript
import { weekStart, computeWeeklyTrend } from '../../../src/lib/progress/trend';
import { ProgressSet } from '../../../src/lib/progress/types';

function set(session_date: string, weight: number, reps = 1): ProgressSet {
  return {
    session_id: session_date,
    session_date,
    weight,
    reps,
    rep_unit: 'reps',
    created_at: `${session_date}T10:00:00Z`,
  };
}

describe('weekStart', () => {
  it('returns the Monday of the week', () => {
    expect(weekStart('2026-09-30')).toBe('2026-09-28'); // Wednesday
    expect(weekStart('2026-09-28')).toBe('2026-09-28'); // Monday
  });

  it('puts Sunday in the same week as the preceding Monday', () => {
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // next Monday
  });
});

// reps = 1 makes e1rm equal the weight, so the numbers below read directly.
describe('computeWeeklyTrend', () => {
  it('is up when the latest week beats the previous one by more than 1%', () => {
    expect(computeWeeklyTrend([set('2026-09-21', 100), set('2026-09-28', 101.5)], 'e1rm')).toEqual({
      trend: 'up',
      latestWeekValue: 101.5,
    });
  });

  it('is flat within 1% either way (exactly 1% is flat)', () => {
    expect(computeWeeklyTrend([set('2026-09-21', 100), set('2026-09-28', 101)], 'e1rm').trend).toBe('flat');
    expect(computeWeeklyTrend([set('2026-09-21', 100), set('2026-09-28', 99.5)], 'e1rm').trend).toBe('flat');
  });

  it('is down when the latest week drops more than 1%', () => {
    expect(computeWeeklyTrend([set('2026-09-21', 100), set('2026-09-28', 98)], 'e1rm').trend).toBe('down');
  });

  it('uses the best of each week, not the average', () => {
    const sets = [set('2026-09-21', 100), set('2026-09-28', 104), set('2026-09-30', 70)];
    expect(computeWeeklyTrend(sets, 'e1rm')).toEqual({ trend: 'up', latestWeekValue: 104 });
  });

  it('skips weeks with no data', () => {
    const sets = [set('2026-08-31', 100), set('2026-09-28', 100.5)];
    expect(computeWeeklyTrend(sets, 'e1rm').trend).toBe('flat');
  });

  it('gives no arrow with fewer than 2 weeks, but still reports the value', () => {
    expect(computeWeeklyTrend([set('2026-09-28', 100), set('2026-09-30', 102)], 'e1rm')).toEqual({
      trend: null,
      latestWeekValue: 102,
    });
  });

  it('returns nulls with no usable data', () => {
    expect(computeWeeklyTrend([], 'e1rm')).toEqual({ trend: null, latestWeekValue: null });
    expect(computeWeeklyTrend([set('2026-09-28', 0, 10)], 'e1rm')).toEqual({ trend: null, latestWeekValue: null });
  });
});
```

- [ ] **Step 2: Write the failing summary tests**

`tests/lib/progress/summary.test.ts`:

```typescript
import { summarizeExercises } from '../../../src/lib/progress/summary';
import { ExerciseSetRow } from '../../../src/lib/progress/types';

function row(overrides: Partial<ExerciseSetRow>): ExerciseSetRow {
  return {
    logged_set_id: 'l1',
    user_id: 'u1',
    exercise_id: 'bench',
    exercise_name: 'Press banca',
    rep_unit: 'reps',
    session_id: 's1',
    session_date: '2026-09-21',
    set_index: 1,
    set_type: 'working',
    weight: 80,
    reps: 6,
    created_at: '2026-09-21T10:00:00Z',
    ...overrides,
  };
}

describe('summarizeExercises', () => {
  it('builds one row per exercise sorted by last trained date, most recent first', () => {
    const summaries = summarizeExercises([
      row({ exercise_id: 'bench', session_id: 'a', session_date: '2026-09-21', weight: 80, reps: 6 }),
      row({ exercise_id: 'bench', session_id: 'b', session_date: '2026-09-28', weight: 82.5, reps: 6 }),
      row({
        exercise_id: 'plank',
        exercise_name: 'Plancha',
        rep_unit: 'seconds',
        session_id: 'c',
        session_date: '2026-09-30',
        weight: 0,
        reps: 75,
      }),
    ]);

    expect(summaries).toEqual([
      {
        exerciseId: 'plank',
        exerciseName: 'Plancha',
        kind: 'seconds',
        metric: 'seconds',
        latestValue: 75,
        trend: null,
        lastTrainedDate: '2026-09-30',
      },
      {
        exerciseId: 'bench',
        exerciseName: 'Press banca',
        kind: 'weighted',
        metric: 'e1rm',
        latestValue: 99, // 82.5 * (1 + 6/30)
        trend: 'up',
        lastTrainedDate: '2026-09-28',
      },
    ]);
  });

  it('breaks a last-trained tie by exercise name', () => {
    const summaries = summarizeExercises([
      row({ exercise_id: 'squat', exercise_name: 'Sentadilla' }),
      row({ exercise_id: 'bench', exercise_name: 'Press banca' }),
    ]);
    expect(summaries.map((s) => s.exerciseName)).toEqual(['Press banca', 'Sentadilla']);
  });

  it('returns an empty list for no rows', () => {
    expect(summarizeExercises([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest tests/lib/progress/trend.test.ts tests/lib/progress/summary.test.ts`
Expected: FAIL, cannot find modules `trend` / `summary`.

- [ ] **Step 4: Implement the trend**

`src/lib/progress/trend.ts`:

```typescript
import { Metric, ProgressSet, Trend, WeeklyTrend } from './types';
import { metricValue } from './metrics';

const TREND_THRESHOLD = 0.01;

/** Monday (YYYY-MM-DD) of the week containing `date`. Dates are treated as calendar dates, not instants. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - daysSinceMonday);
  return day.toISOString().slice(0, 10);
}

/** Compares the best value of the latest trained week with the previous trained week. */
export function computeWeeklyTrend(sets: ProgressSet[], metric: Metric): WeeklyTrend {
  const bestByWeek = new Map<string, number>();
  for (const set of sets) {
    const value = metricValue(set, metric);
    if (value === null) continue;
    const week = weekStart(set.session_date);
    const current = bestByWeek.get(week);
    if (current === undefined || value > current) bestByWeek.set(week, value);
  }

  const weeks = [...bestByWeek.keys()].sort();
  if (weeks.length === 0) return { trend: null, latestWeekValue: null };

  const latest = bestByWeek.get(weeks[weeks.length - 1])!;
  if (weeks.length < 2) return { trend: null, latestWeekValue: latest };

  const previous = bestByWeek.get(weeks[weeks.length - 2])!;
  const change = (latest - previous) / previous;
  const trend: Trend = change > TREND_THRESHOLD ? 'up' : change < -TREND_THRESHOLD ? 'down' : 'flat';
  return { trend, latestWeekValue: latest };
}
```

- [ ] **Step 5: Implement the summary**

`src/lib/progress/summary.ts`:

```typescript
import { ExerciseSetRow, ExerciseSummary } from './types';
import { metricKind, primaryMetric, sortChronologically } from './metrics';
import { groupByExercise } from './records';
import { computeWeeklyTrend } from './trend';

export function summarizeExercises(rows: ExerciseSetRow[]): ExerciseSummary[] {
  const summaries: ExerciseSummary[] = [];
  groupByExercise(rows).forEach((sets, exerciseId) => {
    const sorted = sortChronologically(sets);
    const latest = sorted[sorted.length - 1];
    const kind = metricKind(sets);
    const metric = primaryMetric(kind);
    const { trend, latestWeekValue } = computeWeeklyTrend(sets, metric);
    summaries.push({
      exerciseId,
      exerciseName: latest.exercise_name,
      kind,
      metric,
      latestValue: latestWeekValue,
      trend,
      lastTrainedDate: latest.session_date,
    });
  });

  return summaries.sort((a, b) => {
    if (a.lastTrainedDate !== b.lastTrainedDate) return a.lastTrainedDate < b.lastTrainedDate ? 1 : -1;
    return a.exerciseName.localeCompare(b.exerciseName);
  });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest tests/lib/progress/trend.test.ts tests/lib/progress/summary.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck` (expected: exit 0)

```bash
git add src/lib/progress/trend.ts src/lib/progress/summary.ts tests/lib/progress/trend.test.ts tests/lib/progress/summary.test.ts
git commit -m "feat: add week-over-week trend and progress list summary"
```

---

### Task 4: Live PR detection and display formatting

**Files:**
- Create: `src/lib/progress/live.ts`
- Create: `src/lib/progress/format.ts`
- Test: `tests/lib/progress/live.test.ts`
- Test: `tests/lib/progress/format.test.ts`

**Interfaces:**
- Consumes (Task 1): `LiveSet`, `CachedRecords`, `BrokenRecord`, `Metric`, `RecordEntry`, `ChartPoint`; `metricValue`. `RoutineExerciseRepUnit` from `src/lib/routines/types.ts`.
- Produces: `detectLiveRecord(newSet: LiveSet, repUnit: RoutineExerciseRepUnit, previousBest: CachedRecords | null, earlierSessionSets: LiveSet[]): BrokenRecord[]`; `formatNumber(value: number): string`; `formatMetricValue(value: number, metric: Metric): string`; `formatSourceSet(set: { weight: number; reps: number }, metric: Metric): string`; `formatShortDate(date: string): string`; `formatDaysAgo(date: string, today: Date): string`; `buildPrBannerText(exerciseName: string, broken: BrokenRecord[]): { title: string; detail: string }`; constants `TOGGLE_LABEL` and `RECORD_LABEL`.

- [ ] **Step 1: Write the failing live-detection tests**

`tests/lib/progress/live.test.ts`:

```typescript
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
```

- [ ] **Step 2: Write the failing format tests**

`tests/lib/progress/format.test.ts`:

```typescript
import {
  formatNumber,
  formatMetricValue,
  formatSourceSet,
  formatShortDate,
  formatDaysAgo,
  buildPrBannerText,
} from '../../../src/lib/progress/format';

describe('formatNumber', () => {
  it('drops a trailing .0 and keeps one decimal otherwise', () => {
    expect(formatNumber(96)).toBe('96');
    expect(formatNumber(97.5)).toBe('97.5');
    expect(formatNumber(96.04)).toBe('96');
  });
});

describe('formatMetricValue', () => {
  it('adds the unit for each metric', () => {
    expect(formatMetricValue(96, 'e1rm')).toBe('96 kg');
    expect(formatMetricValue(85, 'weight')).toBe('85 kg');
    expect(formatMetricValue(75, 'seconds')).toBe('75 s');
    expect(formatMetricValue(12, 'reps')).toBe('12 reps');
  });
});

describe('formatSourceSet', () => {
  it('shows weight x reps for weight-based metrics', () => {
    expect(formatSourceSet({ weight: 80, reps: 6 }, 'e1rm')).toBe('80 kg × 6');
    expect(formatSourceSet({ weight: 82.5, reps: 3 }, 'weight')).toBe('82.5 kg × 3');
  });

  it('shows the single value otherwise', () => {
    expect(formatSourceSet({ weight: 0, reps: 75 }, 'seconds')).toBe('75 s');
    expect(formatSourceSet({ weight: 0, reps: 12 }, 'reps')).toBe('12 reps');
  });
});

describe('formatShortDate', () => {
  it('formats YYYY-MM-DD as DD/MM', () => {
    expect(formatShortDate('2026-09-12')).toBe('12/09');
  });
});

describe('formatDaysAgo', () => {
  const today = new Date(2026, 9, 1, 18, 30); // 1 Oct 2026, local time
  it('says hoy, ayer, or hace N días', () => {
    expect(formatDaysAgo('2026-10-01', today)).toBe('hoy');
    expect(formatDaysAgo('2026-09-30', today)).toBe('ayer');
    expect(formatDaysAgo('2026-09-27', today)).toBe('hace 4 días');
  });
});

describe('buildPrBannerText', () => {
  it('shows value and previous for a single record', () => {
    expect(buildPrBannerText('Press banca', [{ metric: 'e1rm', value: 98, previous: 96 }])).toEqual({
      title: '🏆 ¡Nuevo PR en Press banca!',
      detail: '1RM est. 98 kg (antes 96 kg)',
    });
  });

  it('joins several records without the previous values', () => {
    expect(
      buildPrBannerText('Press banca', [
        { metric: 'e1rm', value: 98, previous: 96 },
        { metric: 'weight', value: 85, previous: 82.5 },
      ]).detail
    ).toBe('1RM est. 98 kg · Peso 85 kg');
  });

  it('labels time and rep records', () => {
    expect(buildPrBannerText('Plancha', [{ metric: 'seconds', value: 75, previous: 60 }]).detail).toBe(
      'Tiempo 75 s (antes 60 s)'
    );
    expect(buildPrBannerText('Dominadas', [{ metric: 'reps', value: 13, previous: 12 }]).detail).toBe(
      'Máx. 13 reps (antes 12 reps)'
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest tests/lib/progress/live.test.ts tests/lib/progress/format.test.ts`
Expected: FAIL, cannot find modules `live` / `format`.

- [ ] **Step 4: Implement live detection**

`src/lib/progress/live.ts`:

```typescript
import { RoutineExerciseRepUnit } from '../routines/types';
import { BrokenRecord, CachedRecords, LiveSet, Metric } from './types';
import { metricValue } from './metrics';

const CACHE_FIELD: Record<Metric, keyof CachedRecords> = {
  e1rm: 'best_e1rm',
  weight: 'best_weight',
  seconds: 'best_seconds',
  reps: 'best_reps',
};

function metricsFor(set: LiveSet, repUnit: RoutineExerciseRepUnit): Metric[] {
  if (repUnit === 'seconds') return ['seconds'];
  return set.weight > 0 ? ['e1rm', 'weight'] : ['reps'];
}

/**
 * Records broken by `newSet`. The baseline for each metric is the cached best from completed
 * sessions, raised by any earlier set in the current session, so the same record is never
 * celebrated twice. An exercise (or metric) with no cached history never celebrates.
 */
export function detectLiveRecord(
  newSet: LiveSet,
  repUnit: RoutineExerciseRepUnit,
  previousBest: CachedRecords | null,
  earlierSessionSets: LiveSet[]
): BrokenRecord[] {
  if (newSet.set_type === 'warmup' || !previousBest) return [];
  const earlier = earlierSessionSets.filter((s) => s.set_type !== 'warmup');

  const broken: BrokenRecord[] = [];
  for (const metric of metricsFor(newSet, repUnit)) {
    const cached = previousBest[CACHE_FIELD[metric]];
    if (cached === null) continue;
    const value = metricValue(newSet, metric);
    if (value === null) continue;
    const earlierValues = earlier
      .map((s) => metricValue(s, metric))
      .filter((v): v is number => v !== null);
    const baseline = Math.max(cached, ...earlierValues);
    if (value > baseline) broken.push({ metric, value, previous: baseline });
  }
  return broken;
}
```

- [ ] **Step 5: Implement formatting**

`src/lib/progress/format.ts`:

```typescript
import { BrokenRecord, Metric } from './types';

/** Labels for the detail screen's metric toggle. */
export const TOGGLE_LABEL: Record<'e1rm' | 'weight', string> = { e1rm: '1RM est.', weight: 'Peso' };

/** Labels for the detail screen's records card. */
export const RECORD_LABEL: Record<Metric, string> = {
  e1rm: 'Mejor 1RM est.',
  weight: 'Mejor peso',
  seconds: 'Mejor tiempo',
  reps: 'Más reps',
};

const BANNER_LABEL: Record<Metric, string> = { e1rm: '1RM est.', weight: 'Peso', seconds: 'Tiempo', reps: 'Máx.' };

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatMetricValue(value: number, metric: Metric): string {
  const n = formatNumber(value);
  if (metric === 'seconds') return `${n} s`;
  if (metric === 'reps') return `${n} reps`;
  return `${n} kg`;
}

export function formatSourceSet(set: { weight: number; reps: number }, metric: Metric): string {
  if (metric === 'e1rm' || metric === 'weight') return `${formatNumber(set.weight)} kg × ${set.reps}`;
  return formatMetricValue(set.reps, metric);
}

export function formatShortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

export function formatDaysAgo(date: string, today: Date): string {
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dateUtc = Date.parse(`${date}T00:00:00Z`);
  const days = Math.round((todayUtc - dateUtc) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

export function buildPrBannerText(exerciseName: string, broken: BrokenRecord[]): { title: string; detail: string } {
  const title = `🏆 ¡Nuevo PR en ${exerciseName}!`;
  if (broken.length === 1) {
    const [record] = broken;
    return {
      title,
      detail: `${BANNER_LABEL[record.metric]} ${formatMetricValue(record.value, record.metric)} (antes ${formatMetricValue(record.previous, record.metric)})`,
    };
  }
  return {
    title,
    detail: broken.map((r) => `${BANNER_LABEL[r.metric]} ${formatMetricValue(r.value, r.metric)}`).join(' · '),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest tests/lib/progress/live.test.ts tests/lib/progress/format.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck` (expected: exit 0)

```bash
git add src/lib/progress/live.ts src/lib/progress/format.ts tests/lib/progress/live.test.ts tests/lib/progress/format.test.ts
git commit -m "feat: detect live personal records and format progress values"
```

---

### Task 5: `exercise_set_history` view and paginated query

**Files:**
- Create: `supabase/migrations/20261001120000_exercise_set_history_view.sql`
- Create: `src/lib/progress/queries.ts`
- Test: `tests/lib/progress/queries.integration.test.ts`

**Interfaces:**
- Consumes (Task 1): `ExerciseSetRow`. Test helpers: `createAdminClient()` from `tests/helpers/supabaseAdmin.ts`; `seedTestRoutine(supabase, userId)` from `tests/helpers/seedTestRoutine.ts`, which returns `{ exercise, routine, day, routineExercise }` and always reuses the same catalog exercise named `[test-fixture] Shared Exercise`.
- Produces: `listExerciseSetHistory(supabase: SupabaseClient, userId: string, exerciseId?: string): Promise<ExerciseSetRow[]>`.

Context: `workout_sessions` has a unique constraint on `(user_id, routine_day_id, session_date)`, so every test session below uses a distinct day/date pair. `logged_sets.rir` is nullable. Local Supabase and the hosted project both cap responses at 1000 rows (`supabase/config.toml`: `max_rows = 1000`).

- [ ] **Step 1: Write the migration**

`supabase/migrations/20261001120000_exercise_set_history_view.sql`:

```sql
-- One row per qualifying logged set, keyed by the catalog exercise so the same exercise
-- logged in different routines forms one series. Qualifying = completed session, not a
-- warmup. Soft-deleted routines/exercises are intentionally NOT filtered: history is immutable.
--
-- security_invoker makes the view run with the caller's permissions, so the RLS policies on
-- logged_sets / workout_sessions apply. Without it a view runs as its owner and would expose
-- every user's sets.
create view public.exercise_set_history
with (security_invoker = true) as
select
  ls.id            as logged_set_id,
  ws.user_id,
  re.exercise_id,
  e.name           as exercise_name,
  re.rep_unit,
  ws.id            as session_id,
  ws.session_date,
  ls.set_index,
  ls.set_type,
  ls.weight,
  ls.reps,
  ls.created_at
from public.logged_sets ls
join public.workout_sessions ws on ws.id = ls.session_id
join public.routine_exercises re on re.id = ls.routine_exercise_id
join public.exercises e on e.id = re.exercise_id
where ws.status = 'completed'
  and ls.set_type <> 'warmup';
```

- [ ] **Step 2: Write the failing integration tests**

`tests/lib/progress/queries.integration.test.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import { listExerciseSetHistory } from '../../../src/lib/progress/queries';

const admin = createAdminClient();
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = 'testpassword123';
const createdUserIds: string[] = [];

async function createUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email };
}

async function signIn(email: string) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function insertSession(userId: string, dayId: string, date: string, status: 'completed' | 'in_progress') {
  const { data, error } = await admin
    .from('workout_sessions')
    .insert({ user_id: userId, routine_day_id: dayId, session_date: date, status })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function insertSets(
  sessionId: string,
  routineExerciseId: string,
  sets: Array<{ set_type: string; weight: number; reps: number }>
) {
  const { data, error } = await admin
    .from('logged_sets')
    .insert(sets.map((s, i) => ({ session_id: sessionId, routine_exercise_id: routineExerciseId, set_index: i, ...s })))
    .select('id');
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe('exercise_set_history view', () => {
  let userId: string;
  let exerciseId: string;
  let expectedIds: string[];

  beforeAll(async () => {
    ({ userId } = await createUser('history'));
    const first = await seedTestRoutine(admin, userId);
    const second = await seedTestRoutine(admin, userId);
    exerciseId = first.exercise.id;

    const completed = await insertSession(userId, first.day.id, '2026-01-05', 'completed');
    const [, workingId] = await insertSets(completed, first.routineExercise.id, [
      { set_type: 'warmup', weight: 40, reps: 10 },
      { set_type: 'working', weight: 80, reps: 6 },
    ]);

    const unfinished = await insertSession(userId, first.day.id, '2026-01-06', 'in_progress');
    await insertSets(unfinished, first.routineExercise.id, [{ set_type: 'working', weight: 85, reps: 5 }]);

    const otherRoutine = await insertSession(userId, second.day.id, '2026-01-07', 'completed');
    const [otherId] = await insertSets(otherRoutine, second.routineExercise.id, [
      { set_type: 'working', weight: 82.5, reps: 6 },
    ]);

    expectedIds = [workingId, otherId];
  });

  it('excludes warmup sets and sets from unfinished sessions', async () => {
    const rows = await listExerciseSetHistory(admin, userId);
    expect(rows.map((r) => r.logged_set_id).sort()).toEqual([...expectedIds].sort());
  });

  it('merges one catalog exercise logged in two routines into one series', async () => {
    const rows = await listExerciseSetHistory(admin, userId);
    expect(new Set(rows.map((r) => r.exercise_id))).toEqual(new Set([exerciseId]));
    expect(new Set(rows.map((r) => r.session_id)).size).toBe(2);
    expect(rows[0].exercise_name).toBe('[test-fixture] Shared Exercise');
  });

  it('returns numeric weight and reps, ordered by session date', async () => {
    const rows = await listExerciseSetHistory(admin, userId);
    expect(rows.map((r) => r.session_date)).toEqual(['2026-01-05', '2026-01-07']);
    expect(rows.map((r) => r.weight)).toEqual([80, 82.5]);
    expect(typeof rows[0].reps).toBe('number');
  });

  it('filters by exercise when one is given', async () => {
    expect(await listExerciseSetHistory(admin, userId, exerciseId)).toHaveLength(2);
    expect(await listExerciseSetHistory(admin, userId, '00000000-0000-0000-0000-000000000000')).toHaveLength(0);
  });
});

describe('exercise_set_history row level security', () => {
  it("never shows another user's sets", async () => {
    const owner = await createUser('history-owner');
    const other = await createUser('history-other');
    const seeded = await seedTestRoutine(admin, owner.userId);
    const session = await insertSession(owner.userId, seeded.day.id, '2026-01-05', 'completed');
    await insertSets(session, seeded.routineExercise.id, [{ set_type: 'working', weight: 60, reps: 8 }]);

    const ownerClient = await signIn(owner.email);
    const otherClient = await signIn(other.email);

    const { data: ownRows, error: ownError } = await ownerClient.from('exercise_set_history').select('*');
    expect(ownError).toBeNull();
    expect(ownRows).toHaveLength(1);

    const { data: unfiltered, error: unfilteredError } = await otherClient.from('exercise_set_history').select('*');
    expect(unfilteredError).toBeNull();
    expect(unfiltered).toHaveLength(0);

    const { data: targeted } = await otherClient
      .from('exercise_set_history')
      .select('*')
      .eq('user_id', owner.userId);
    expect(targeted).toHaveLength(0);
  });
});

describe('listExerciseSetHistory pagination', () => {
  it('returns every row past the 1000-row response cap', async () => {
    const { userId } = await createUser('history-paging');
    const seeded = await seedTestRoutine(admin, userId);
    const session = await insertSession(userId, seeded.day.id, '2026-01-05', 'completed');
    await insertSets(
      session,
      seeded.routineExercise.id,
      Array.from({ length: 1001 }, () => ({ set_type: 'working', weight: 50, reps: 10 }))
    );

    const rows = await listExerciseSetHistory(admin, userId);
    expect(rows).toHaveLength(1001);
    expect(new Set(rows.map((r) => r.logged_set_id)).size).toBe(1001);
  });
});
```

- [ ] **Step 3: Apply the migration to the hosted project (ASK THE USER FIRST)**

The integration suite runs locally against the hosted Supabase project. Applying the migration there is an outward-facing change to the user's real database (additive and read-only, a single view). **Stop and ask the user for permission before running it.** On approval:

Run: `npx supabase db push`
Expected: lists `20261001120000_exercise_set_history_view.sql` and applies it without errors.

If the user declines, skip to Step 4 and rely on the CI `integration` job (which applies all migrations to a throwaway local stack) for Steps 4 and 6.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx jest tests/lib/progress/queries.integration.test.ts`
Expected: FAIL, "Cannot find module '../../../src/lib/progress/queries'".

- [ ] **Step 5: Implement the query**

`src/lib/progress/queries.ts`:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { ExerciseSetRow } from './types';

// PostgREST caps every response at 1000 rows (hosted default and supabase/config.toml max_rows)
// and truncates silently, so read the view page by page until a short page comes back.
const PAGE_SIZE = 1000;

export async function listExerciseSetHistory(
  supabase: SupabaseClient,
  userId: string,
  exerciseId?: string
): Promise<ExerciseSetRow[]> {
  const rows: ExerciseSetRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from('exercise_set_history').select('*').eq('user_id', userId);
    if (exerciseId) query = query.eq('exercise_id', exerciseId);
    const { data, error } = await query
      .order('session_date')
      .order('logged_set_id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []).map(
      (raw): ExerciseSetRow => ({
        ...raw,
        weight: Number(raw.weight),
        reps: Number(raw.reps),
        set_index: Number(raw.set_index),
      })
    );
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest tests/lib/progress/queries.integration.test.ts`
Expected: PASS (6 tests). If Step 3 was skipped, this runs in CI instead; note it in the task report.

- [ ] **Step 7: Typecheck, confirm the unit project ignores it, and commit**

Run: `npm run typecheck` (expected: exit 0)
Run: `npx jest --selectProjects unit --listTests` (expected: `queries.integration.test.ts` is NOT listed)

```bash
git add supabase/migrations/20261001120000_exercise_set_history_view.sql src/lib/progress/queries.ts tests/lib/progress/queries.integration.test.ts
git commit -m "feat: add exercise_set_history view and paginated history query"
```

---

### Task 6: Local records cache

**Files:**
- Modify: `src/lib/sqlite/schema.ts` (append a table to `CREATE_TABLES_SQL`)
- Modify: `src/lib/sqlite/cache.ts` (imports; `refreshLocalCache`; two new exported functions)
- Test: `tests/lib/sqlite/schema.test.ts` (extend)

**Interfaces:**
- Consumes (Tasks 2, 5): `CachedRecords`; `recordsByExercise`, `mergeCachedRecords`; `listExerciseSetHistory`.
- Produces: `getCachedExerciseRecords(db: SQLiteDatabase, exerciseId: string): CachedRecords | null`; `mergeCachedExerciseRecords(db: SQLiteDatabase, exerciseId: string, sessionBests: CachedRecords): void`. `refreshLocalCache` additionally replaces `exercise_records_cache`.

Context: `initDatabase()` runs `CREATE_TABLES_SQL` on every launch, so a new `create table if not exists` reaches already-installed devices without a migration statement. `cache.ts` imports expo-sqlite and is not unit-tested; its logic lives in the pure functions from Task 2.

- [ ] **Step 1: Extend the schema test (failing)**

In `tests/lib/sqlite/schema.test.ts`, replace the first `describe` block with:

```typescript
describe('local SQLite schema', () => {
  it('defines all cache/queue tables', () => {
    for (const table of [
      'routines_cache',
      'routine_days_cache',
      'routine_exercises_cache',
      'user_exercise_state_cache',
      'exercise_records_cache',
      'pending_writes',
    ]) {
      expect(CREATE_TABLES_SQL).toContain(`create table if not exists ${table}`);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/lib/sqlite/schema.test.ts`
Expected: FAIL on `exercise_records_cache`.

- [ ] **Step 3: Add the table**

In `src/lib/sqlite/schema.ts`, inside `CREATE_TABLES_SQL`, insert this block after the `user_exercise_state_cache` table and before `pending_writes`:

```sql
  create table if not exists exercise_records_cache (
    exercise_id text primary key,
    best_e1rm real,
    best_weight real,
    best_seconds real,
    best_reps real
  );

```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest tests/lib/sqlite/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Read and write the cache in `cache.ts`**

Add these imports at the top of `src/lib/sqlite/cache.ts`, below the existing ones:

```typescript
import { listExerciseSetHistory } from '../progress/queries';
import { mergeCachedRecords, recordsByExercise } from '../progress/records';
import { CachedRecords } from '../progress/types';
```

Add these functions right after `getCachedExerciseState`:

```typescript
export function getCachedExerciseRecords(db: SQLiteDatabase, exerciseId: string): CachedRecords | null {
  const rows = db.getAllSync<CachedRecords>(
    'select best_e1rm, best_weight, best_seconds, best_reps from exercise_records_cache where exercise_id = ?',
    [exerciseId]
  );
  return rows[0] ?? null;
}

function writeExerciseRecords(db: SQLiteDatabase, exerciseId: string, records: CachedRecords): void {
  db.runSync(
    `insert or replace into exercise_records_cache (exercise_id, best_e1rm, best_weight, best_seconds, best_reps)
     values (?, ?, ?, ?, ?)`,
    [exerciseId, records.best_e1rm, records.best_weight, records.best_seconds, records.best_reps]
  );
}

/** Folds a just-finished session's bests into the cache, so offline sessions compare against them. */
export function mergeCachedExerciseRecords(db: SQLiteDatabase, exerciseId: string, sessionBests: CachedRecords): void {
  writeExerciseRecords(db, exerciseId, mergeCachedRecords(getCachedExerciseRecords(db, exerciseId), sessionBests));
}
```

- [ ] **Step 6: Refresh the records inside `refreshLocalCache`**

In `refreshLocalCache`, right after the `if (statesError) throw statesError;` line, add:

```typescript
  // A history failure must not block the routine cache refresh; it just leaves the
  // previous records snapshot in place for live PR detection.
  const history = await listExerciseSetHistory(supabase, userId).catch(() => null);
```

Inside the `db.withTransactionSync(() => { ... })` callback, right after the four existing `db.runSync('delete from ...')` lines and **before** `if (!routine) return;`, add:

```typescript
    if (history) {
      db.runSync('delete from exercise_records_cache');
      recordsByExercise(history).forEach((records, exerciseId) => writeExerciseRecords(db, exerciseId, records));
    }
```

(Before the early return because records exist even when the user has no active routine.)

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck` (expected: exit 0)
Run: `npm run test:unit` (expected: all suites pass)

```bash
git add src/lib/sqlite/schema.ts src/lib/sqlite/cache.ts tests/lib/sqlite/schema.test.ts
git commit -m "feat: cache per-exercise personal records locally for offline PR detection"
```

---

### Task 7: Live PR banner in the session

**Files:**
- Create: `src/components/PrBanner.tsx`
- Modify: `src/hooks/useSessionSets.ts`
- Modify: `app/(app)/session/[sessionId].tsx`

**Interfaces:**
- Consumes: `detectLiveRecord` (Task 4), `buildPrBannerText` (Task 4), `computeRecords` + `toCachedRecords` (Task 2), `getCachedExerciseRecords` + `mergeCachedExerciseRecords` (Task 6), `PrBannerData` + `ProgressSet` (Task 1). Existing: `CachedRoutineExercise` has `id`, `exercise_id`, `exercise_name`, `rep_unit`; `LoggedSet` has `routine_exercise_id`, `set_type`, `weight`, `reps`, `created_at`.
- Produces: `useSessionSets` additionally returns `prBanner: PrBannerData | null` and `dismissPrBanner: () => void` (stable via `useCallback`). `PrBanner({ banner, onDismiss })` component.

No unit test: the decision logic is already covered by `live.test.ts` and `records.test.ts`; this task is wiring. Verify on device (Task 9).

- [ ] **Step 1: Create the banner component**

`src/components/PrBanner.tsx`:

```tsx
import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PrBannerData } from '../lib/progress/types';
import { buildPrBannerText } from '../lib/progress/format';

const VISIBLE_MS = 3000;

export function PrBanner({ banner, onDismiss }: { banner: PrBannerData | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [banner, onDismiss]);

  if (!banner) return null;
  const { title, detail } = buildPrBannerText(banner.exerciseName, banner.broken);

  return (
    <View style={styles.banner} pointerEvents="none">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  title: { color: '#fff', fontWeight: '700', fontSize: 15 },
  detail: { color: '#e5e5e5', marginTop: 2 },
});
```

- [ ] **Step 2: Wire detection into `useSessionSets`**

In `src/hooks/useSessionSets.ts`:

1. Change the cache import line to:

```typescript
import {
  getCachedDayExercises,
  getCachedExerciseState,
  getCachedExerciseRecords,
  mergeCachedExerciseRecords,
  CachedRoutineExercise,
} from '../lib/sqlite/cache';
```

2. Add imports below the existing ones:

```typescript
import { detectLiveRecord } from '../lib/progress/live';
import { computeRecords, toCachedRecords } from '../lib/progress/records';
import { PrBannerData, ProgressSet } from '../lib/progress/types';
```

3. Below `const [loading, setLoading] = useState(true);` add:

```typescript
  const [prBanner, setPrBanner] = useState<PrBannerData | null>(null);
  const dismissPrBanner = useCallback(() => setPrBanner(null), []);
```

4. In `logSet`, the existing line `const exercise = exercises.find((e) => e.id === routineExerciseId);` stays. Directly after it (before the `if (exercise && exercise.muscle_group !== 'core' ...` progression block) add:

```typescript
    if (exercise) {
      try {
        const earlierSets = loggedSets.filter(
          (s) => exercises.find((e) => e.id === s.routine_exercise_id)?.exercise_id === exercise.exercise_id
        );
        const broken = detectLiveRecord(
          { weight, reps, set_type: setType },
          exercise.rep_unit,
          getCachedExerciseRecords(getDatabase(), exercise.exercise_id),
          earlierSets
        );
        if (broken.length > 0) setPrBanner({ id, exerciseName: exercise.exercise_name, broken });
      } catch {
        // PR detection is a nicety: never let it break logging a set.
      }
    }
```

(`loggedSets` here is the state *before* this set was appended, which is exactly "earlier sets in this session".)

5. In `completeSession`, right after `if (!sessionId) return;` add:

```typescript
    try {
      // Fold this session's bests into the local records cache now, so a following offline
      // session compares against them before the next server refresh.
      const today = new Date().toISOString().slice(0, 10);
      exercises.forEach((exercise) => {
        const sets: ProgressSet[] = loggedSets
          .filter((s) => s.routine_exercise_id === exercise.id && s.set_type !== 'warmup')
          .map((s) => ({
            session_id: sessionId,
            session_date: today,
            weight: s.weight,
            reps: s.reps,
            rep_unit: exercise.rep_unit,
            created_at: s.created_at,
          }));
        if (sets.length === 0) return;
        mergeCachedExerciseRecords(getDatabase(), exercise.exercise_id, toCachedRecords(computeRecords(sets)));
      });
    } catch {
      // Same as above: the next cache refresh recomputes records from the server anyway.
    }
```

6. Change the hook's return statement to:

```typescript
  return {
    dayName,
    exercises,
    loggedSets,
    weightByExercise,
    loading,
    loadForDay,
    logSet,
    completeSession,
    prBanner,
    dismissPrBanner,
  };
```

- [ ] **Step 3: Render the banner on the session screen**

In `app/(app)/session/[sessionId].tsx`:

1. Add the import: `import { PrBanner } from '../../../src/components/PrBanner';`
2. Destructure the new values:

```typescript
  const {
    dayName,
    exercises,
    loggedSets,
    weightByExercise,
    loading,
    loadForDay,
    logSet,
    completeSession,
    prBanner,
    dismissPrBanner,
  } = useSessionSets(sessionId);
```

3. Wrap the returned `ScrollView` (the non-loading branch) in a container so the banner overlays it:

```tsx
  return (
    <View style={styles.container}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* ...existing ScrollView children unchanged... */}
      </ScrollView>
      <PrBanner banner={prBanner} onDismiss={dismissPrBanner} />
    </View>
  );
```

Keep every existing child of the `ScrollView` exactly as it is.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck` (expected: exit 0)
Run: `npm run test:unit` (expected: all suites pass)

```bash
git add src/components/PrBanner.tsx src/hooks/useSessionSets.ts "app/(app)/session/[sessionId].tsx"
git commit -m "feat: show a live PR banner while logging sets"
```

---

### Task 8: Progress list screen and drawer entry

**Files:**
- Modify: `package.json` / `package-lock.json` (via `npx expo install`)
- Create: `src/hooks/useExerciseProgress.ts`
- Create: `app/(app)/progress/_layout.tsx`
- Create: `app/(app)/progress/index.tsx`
- Modify: `app/(app)/_layout.tsx`

**Interfaces:**
- Consumes: `listExerciseSetHistory` (Task 5), `summarizeExercises` (Task 3), `formatMetricValue` + `formatDaysAgo` (Task 4), `ExerciseSummary` + `ExerciseSetRow` + `Trend` (Task 1). Existing: `useAuthSession()` returns `{ session }`; `supabase` from `src/lib/supabase`.
- Produces: `useProgressSummary(userId: string | undefined): { summaries: ExerciseSummary[]; isLoading: boolean; error: string | null; refetch: () => Promise<void> }`; `useExerciseProgress(userId: string | undefined, exerciseId: string | undefined): { rows: ExerciseSetRow[]; isLoading: boolean; error: string | null; refetch: () => Promise<void> }`; constant `PROGRESS_OFFLINE_MESSAGE`.

- [ ] **Step 1: Install chart dependencies (needed by Task 9; installed here so this task's build includes them)**

Run: `npx expo install react-native-gifted-charts react-native-svg expo-linear-gradient`
Expected: all three added to `dependencies`, with `react-native-svg` and `expo-linear-gradient` pinned to SDK-57-compatible versions.

Run: `npm run test:unit` (expected: still passes; Jest never imports these packages)

- [ ] **Step 2: Create the data hooks**

`src/hooks/useExerciseProgress.ts`:

```typescript
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { listExerciseSetHistory } from '../lib/progress/queries';
import { summarizeExercises } from '../lib/progress/summary';
import { ExerciseSetRow, ExerciseSummary } from '../lib/progress/types';

export const PROGRESS_OFFLINE_MESSAGE = 'Conectate para ver tu progreso';

// Both hooks refetch on focus (not just mount) so returning from a finished session shows it.
export function useProgressSummary(userId: string | undefined) {
  const [summaries, setSummaries] = useState<ExerciseSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);
    try {
      setSummaries(summarizeExercises(await listExerciseSetHistory(supabase, userId)));
    } catch {
      setError(PROGRESS_OFFLINE_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { summaries, isLoading, error, refetch };
}

export function useExerciseProgress(userId: string | undefined, exerciseId: string | undefined) {
  const [rows, setRows] = useState<ExerciseSetRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId || !exerciseId) return;
    setIsLoading(true);
    setError(null);
    try {
      setRows(await listExerciseSetHistory(supabase, userId, exerciseId));
    } catch {
      setError(PROGRESS_OFFLINE_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, [userId, exerciseId]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { rows, isLoading, error, refetch };
}
```

- [ ] **Step 3: Create the stack layout**

`app/(app)/progress/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function ProgressLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 4: Create the list screen**

`app/(app)/progress/index.tsx`:

```tsx
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useProgressSummary } from '../../../src/hooks/useExerciseProgress';
import { formatDaysAgo, formatMetricValue } from '../../../src/lib/progress/format';
import { Trend } from '../../../src/lib/progress/types';

const TREND_ARROW: Record<Trend, string> = { up: '↑', flat: '→', down: '↓' };
const TREND_COLOR: Record<Trend, string> = { up: '#16a34a', flat: '#666', down: '#dc2626' };

export default function ProgressList() {
  const { session } = useAuthSession();
  const { summaries, isLoading, error, refetch } = useProgressSummary(session?.user.id);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={refetch}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  const today = new Date();

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={summaries}
      keyExtractor={(item) => item.exerciseId}
      ListEmptyComponent={
        <Text style={styles.message}>
          Todavía no hay datos. Completá tu primera sesión para empezar a ver tu progreso.
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => router.push(`/(app)/progress/${item.exerciseId}` as any)}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>{item.exerciseName}</Text>
            <Text style={styles.subtitle}>{formatDaysAgo(item.lastTrainedDate, today)}</Text>
          </View>
          {item.latestValue !== null && (
            <Text style={styles.value}>{formatMetricValue(item.latestValue, item.metric)}</Text>
          )}
          <Text style={[styles.arrow, item.trend ? { color: TREND_COLOR[item.trend] } : null]}>
            {item.trend ? TREND_ARROW[item.trend] : ' '}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { textAlign: 'center', color: '#666', marginTop: 32 },
  retryButton: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 16 },
  retryText: { color: '#fff', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  rowMain: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#666', marginTop: 2, fontSize: 12 },
  value: { fontSize: 16, fontWeight: '600', marginRight: 12 },
  arrow: { fontSize: 20, width: 20, textAlign: 'center' },
});
```

- [ ] **Step 5: Add the drawer entry**

In `app/(app)/_layout.tsx`, add this line directly after the `routines` `Drawer.Screen`:

```tsx
      <Drawer.Screen name="progress" options={{ title: 'Progreso', swipeEnabled: false }} />
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck` (expected: exit 0. If typed routes complain about the new route before `.expo/types` regenerates, the `as any` cast already covers `router.push`; nothing else references the route by type.)
Run: `npm run test:unit` (expected: pass)

```bash
git add package.json package-lock.json src/hooks/useExerciseProgress.ts "app/(app)/progress/_layout.tsx" "app/(app)/progress/index.tsx" "app/(app)/_layout.tsx"
git commit -m "feat: add Progreso list screen with weekly trend arrows"
```

---

### Task 9: Exercise detail screen with chart and records

**Files:**
- Create: `app/(app)/progress/[exerciseId].tsx`

**Interfaces:**
- Consumes: `useExerciseProgress`, `PROGRESS_OFFLINE_MESSAGE` (Task 8); `metricKind`, `primaryMetric`, `bestSetPerSession` (Task 1); `computeRecords` (Task 2); `formatMetricValue`, `formatSourceSet`, `formatShortDate`, `TOGGLE_LABEL`, `RECORD_LABEL` (Task 4); `ChartPoint`, `Metric`, `RecordEntry` (Task 1). `LineChart` from `react-native-gifted-charts`.
- Produces: the screen at route `/(app)/progress/[exerciseId]`.

Gifted-charts props used below: `data` (`{ value, label }[]`), `width`, `height`, `color`, `thickness`, `dataPointsColor`, `noOfSections`, `yAxisOffset`, `initialSpacing`, `spacing`, `focusEnabled`, `showStripOnFocus`, `onFocus(item, index)`, `xAxisLabelTextStyle`, `yAxisTextStyle`. **Before writing the screen, confirm each prop name in `node_modules/react-native-gifted-charts` type definitions (search for `LineChartPropsType`).** If a name differs in the installed version, use the installed equivalent with the same behavior and note it in the task report.

- [ ] **Step 1: Create the screen**

`app/(app)/progress/[exerciseId].tsx`:

```tsx
import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LineChart } from 'react-native-gifted-charts';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useExerciseProgress } from '../../../src/hooks/useExerciseProgress';
import { bestSetPerSession, metricKind, primaryMetric } from '../../../src/lib/progress/metrics';
import { computeRecords } from '../../../src/lib/progress/records';
import {
  RECORD_LABEL,
  TOGGLE_LABEL,
  formatMetricValue,
  formatShortDate,
  formatSourceSet,
} from '../../../src/lib/progress/format';
import { Metric, RecordEntry } from '../../../src/lib/progress/types';

const MAX_X_LABELS = 6;

export default function ExerciseProgressDetail() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const { session } = useAuthSession();
  const { rows, isLoading, error, refetch } = useExerciseProgress(session?.user.id, exerciseId);
  const { width: screenWidth } = useWindowDimensions();
  const [toggle, setToggle] = useState<'e1rm' | 'weight'>('e1rm');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const kind = rows.length > 0 ? metricKind(rows) : null;
  const metric: Metric | null = kind === 'weighted' ? toggle : kind ? primaryMetric(kind) : null;
  const points = useMemo(() => (metric ? bestSetPerSession(rows, metric) : []), [rows, metric]);
  const records = useMemo(() => (rows.length > 0 ? computeRecords(rows) : null), [rows]);
  const exerciseName = rows.length > 0 ? rows[rows.length - 1].exercise_name : '';

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={refetch}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  const chartWidth = screenWidth - 32 - 40; // screen padding and y-axis labels
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const chartData = points.map((p, i) => ({ value: p.value, label: i % labelStep === 0 ? formatShortDate(p.date) : '' }));
  const minValue = points.length > 0 ? Math.min(...points.map((p) => p.value)) : 0;
  const selected = points[selectedIndex ?? points.length - 1];

  const recordRows: Array<{ metric: Metric; entry: RecordEntry | null }> = records
    ? kind === 'weighted'
      ? [
          { metric: 'e1rm', entry: records.bestE1rm },
          { metric: 'weight', entry: records.bestWeight },
        ]
      : kind === 'seconds'
        ? [{ metric: 'seconds', entry: records.bestSeconds }]
        : [{ metric: 'reps', entry: records.bestReps }]
    : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.backRow}>
        <Text style={styles.back}>←</Text>
        <Text style={styles.title}>{exerciseName}</Text>
      </Pressable>

      {kind === 'weighted' && (
        <View style={styles.toggle}>
          {(['e1rm', 'weight'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.toggleOption, toggle === option && styles.toggleOptionActive]}
              onPress={() => {
                setToggle(option);
                setSelectedIndex(null);
              }}
            >
              <Text style={[styles.toggleText, toggle === option && styles.toggleTextActive]}>
                {TOGGLE_LABEL[option]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {metric && points.length > 0 && (
        <View style={styles.card}>
          <LineChart
            data={chartData}
            width={chartWidth}
            height={200}
            color="#111"
            thickness={2}
            dataPointsColor="#111"
            noOfSections={4}
            yAxisOffset={Math.max(0, Math.floor(minValue * 0.9))}
            initialSpacing={12}
            spacing={points.length > 1 ? Math.max(24, (chartWidth - 24) / (points.length - 1)) : 24}
            focusEnabled
            showStripOnFocus
            onFocus={(_item: unknown, index: number) => setSelectedIndex(index)}
            xAxisLabelTextStyle={styles.axisText}
            yAxisTextStyle={styles.axisText}
          />
          {selected && (
            <Text style={styles.selected}>
              {formatShortDate(selected.date)} · {formatSourceSet(selected, metric)} ·{' '}
              {formatMetricValue(selected.value, metric)}
            </Text>
          )}
          {points.length === 1 && <Text style={styles.hint}>Seguí entrenando para ver la evolución</Text>}
        </View>
      )}

      {recordRows.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🏆 Récords</Text>
          {recordRows.map(({ metric: recordMetric, entry }) =>
            entry ? (
              <View key={recordMetric} style={styles.recordRow}>
                <View style={styles.recordHeader}>
                  <Text style={styles.recordLabel}>{RECORD_LABEL[recordMetric]}</Text>
                  <Text style={styles.recordValue}>{formatMetricValue(entry.value, recordMetric)}</Text>
                </View>
                <Text style={styles.recordDetail}>
                  {formatSourceSet(entry, recordMetric)} · {formatShortDate(entry.date)}
                </Text>
              </View>
            ) : null
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { textAlign: 'center', color: '#666' },
  retryButton: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 16 },
  retryText: { color: '#fff', fontWeight: '600' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { fontSize: 22 },
  title: { fontSize: 22, fontWeight: '700', flexShrink: 1 },
  toggle: { flexDirection: 'row', backgroundColor: '#eee', borderRadius: 8, padding: 4, alignSelf: 'flex-start' },
  toggleOption: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  toggleOptionActive: { backgroundColor: '#111' },
  toggleText: { fontWeight: '600', color: '#111' },
  toggleTextActive: { color: '#fff' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, overflow: 'hidden' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  axisText: { color: '#666', fontSize: 10 },
  selected: { marginTop: 8, color: '#111', fontWeight: '600' },
  hint: { marginTop: 4, color: '#666' },
  recordRow: { paddingVertical: 6 },
  recordHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  recordLabel: { fontWeight: '600' },
  recordValue: { fontWeight: '700' },
  recordDetail: { color: '#666', marginTop: 2 },
});
```

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck` (expected: exit 0)
Run: `npm run test:unit` (expected: pass)

```bash
git add "app/(app)/progress/[exerciseId].tsx"
git commit -m "feat: add exercise progress detail with chart and personal records"
```

---

### Task 10: Full verification and device checklist

**Files:** none new. Fix-ups only, if verification finds a problem.

- [ ] **Step 1: Run every automated check**

Run: `npm run typecheck` (expected: exit 0)
Run: `npm run test:unit` (expected: all unit suites pass, including the six new `tests/lib/progress/*.test.ts` files)
Run: `npm run test:integration` (expected: pass, only if the migration was pushed in Task 5 Step 3; otherwise the CI `integration` job covers it)

- [ ] **Step 2: Hand the device checklist to the user**

This is the user's job (Expo Go on their phone). Give them this list verbatim:

1. Abrí el menú lateral: aparece **Progreso** entre Rutinas y Cerrar sesión.
2. Progreso muestra tus ejercicios entrenados, el más reciente arriba, con número y flecha.
3. Tocá un ejercicio con pesas: el gráfico arranca en **1RM est.**; cambiá a **Peso**; tocá un punto y aparece su fecha y el set.
4. Abajo aparecen **Récords** con fecha.
5. En una sesión, registrá un set que supere tu récord: aparece "🏆 ¡Nuevo PR!" unos 3 segundos y se va solo.
6. Después registrá un set más liviano del mismo ejercicio: no aparece el cartel.
7. Un ejercicio que nunca hiciste: no aparece el cartel en su primera sesión.
8. Modo avión: Progreso muestra "Conectate para ver tu progreso" con **Reintentar**; el cartel de PR igual funciona en la sesión.
9. Terminá la sesión, volvé a Progreso: la sesión nueva aparece.

- [ ] **Step 3: Commit any fix-ups**

If Step 1 or 2 surfaced a problem, fix it with a failing test first where the problem is in `src/lib/progress/`, then:

```bash
git add <changed files>
git commit -m "fix: <what was wrong>"
```
