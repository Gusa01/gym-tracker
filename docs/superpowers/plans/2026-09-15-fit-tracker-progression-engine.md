# Progression Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After logging all of an exercise's sets, automatically compute whether to raise its weight next time, detect when a top-set/back-off exercise needs a deload, and suggest switching to the next routine once its suggested duration is exceeded — surfacing the latter two as dismissible banners on Home.

**Architecture:** A pure rules layer (`src/lib/progression/*`) computes hit/miss, weight increments, deload deficits, and routine-switch eligibility from plain data — no I/O, fully unit tested. A thin Supabase orchestration layer (`suggestions.ts`) queries recent session history for Home to feed those pure rules. Everything that happens mid-workout (the weight-progression write after completing an exercise) goes through the existing offline `pending_writes` queue from the prior plan; everything that happens on Home (accepting a deload or routine switch) is a direct, online-only action, matching how routine management already works.

**Tech Stack:** Same as the prior two plans — Expo Router, `expo-sqlite`, `@supabase/supabase-js`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-13-fit-tracker-design.md` — §8 (progression, deload, routine-switch logic). Builds on the session-logging plan (`docs/superpowers/plans/2026-09-14-fit-tracker-session-logging.md`, merged) and the routine-CRUD plan (`docs/superpowers/plans/2026-09-14-fit-tracker-import-crud.md`, merged).

**Resolved open items from the spec (§12 "Exact increment table" was explicitly left open):**
- Weight increment: **+1.25kg for `muscle_group = 'upper'`, +2.5kg for `'lower'`, +0 for anything else** (including `'core'` — core exercises are time-based and are excluded from automatic progression entirely for this plan).
- The spec's deload formula literally says "`rep_min - reps`" for the top set, but `top_set_backoff` exercises have no `rep_min` field — this plan uses `top_set_reps` (the actual target field for that scheme) as the comparison base instead. Deficit = `top_set_reps - reps > 0` (short on reps) OR `rir_min - rir > 0` (RIR came in below the floor).
- "Ignorar" on a Home banner is a per-visit dismiss only (component state, not persisted) — consistent with the spec's "no persisted pending suggestion" design (§8's opening line). The banner reappears on a later visit if the underlying condition is still true.

## Global Constraints

- Row Level Security scopes every table to `auth.uid()`; `user_exercise_state` and `routine_history` already have permissive `for all` policies from Plan 1 — no migration needed.
- Soft-delete-only (`is_deleted = true`, never hard `DELETE`) applies to `routines`/`routine_days`/`routine_exercises` — not relevant to this plan's tables (`user_exercise_state` is upserted, `routine_history` is append-only).
- TDD with Jest for pure logic and for anything that talks to the real hosted Supabase project (via `tests/helpers/supabaseAdmin.ts`'s `createAdminClient()`), exactly like the prior two plans. Code that calls `expo-sqlite` directly cannot run under Jest (no native binding in Node) — those tasks are verified manually on-device instead, exactly as established in the session-logging plan.
- UI copy is in Spanish, matching every existing screen.
- Expo Router `experiments.typedRoutes: true` requires `as any` casts on dynamic `router.push`/`router.replace` template-literal paths — not newly relevant here (no new routes), but any existing ones this plan touches keep their existing casts.
- New dependencies are added with `npx expo install <package>` — not expected to be needed for this plan.

---

## Task 1: Pure progression rules — hit/miss, weight increment, next-state calculation

**Files:**
- Create: `src/lib/progression/rules.ts`
- Test: `tests/lib/progression/rules.test.ts`

**Interfaces:**
- Consumes: `LoggedSet`, `SetType` from `src/lib/sessions/types.ts` (already exist).
- Produces (used by Task 5):
  - `SchemeFields { scheme_type: 'normal' | 'top_set_backoff'; rep_max: number | null; top_set_reps: number | null; backoff_rep_max: number | null; rir_min: number | null; rir_max: number | null }`
  - `getTargetRepsForSet(exercise: SchemeFields, setType: SetType): number`
  - `isSetHit(set: LoggedSet, exercise: SchemeFields): boolean`
  - `isExerciseHit(sets: LoggedSet[], exercise: SchemeFields): boolean`
  - `computeWeightIncrement(muscleGroup: string): number`
  - `ExerciseProgressUpdate { current_weight: number; suggested_next_weight: number; consecutive_hit_count: number; consecutive_miss_count: number }`
  - `computeNextExerciseState(current: { consecutive_hit_count: number; consecutive_miss_count: number } | null, weightUsed: number, hit: boolean, increment: number): ExerciseProgressUpdate`

This module deliberately takes a narrow `SchemeFields` shape rather than the full `RoutineExerciseWithName` type, so it has no dependency on the routines domain and no risk of being broken by later changes to that type (a later task widens `RoutineExerciseWithName` with an optional `muscle_group` field — this module doesn't need to know about that).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/progression/rules.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/progression/rules.test.ts`
Expected: FAIL — `Cannot find module '../../../src/lib/progression/rules'`

- [ ] **Step 3: Implement the rules**

```typescript
// src/lib/progression/rules.ts
import { LoggedSet, SetType } from '../sessions/types';

export interface SchemeFields {
  scheme_type: 'normal' | 'top_set_backoff';
  rep_max: number | null;
  top_set_reps: number | null;
  backoff_rep_max: number | null;
  rir_min: number | null;
  rir_max: number | null;
}

export function getTargetRepsForSet(exercise: SchemeFields, setType: SetType): number {
  if (setType === 'top_set') return exercise.top_set_reps ?? 0;
  if (setType === 'back_off') return exercise.backoff_rep_max ?? 0;
  return exercise.rep_max ?? 0;
}

export function isSetHit(set: LoggedSet, exercise: SchemeFields): boolean {
  const target = getTargetRepsForSet(exercise, set.set_type);
  const repsOk = set.reps >= target;
  const rirOk =
    exercise.rir_min === null ||
    (set.rir !== null && set.rir >= exercise.rir_min && (exercise.rir_max === null || set.rir <= exercise.rir_max));
  return repsOk && rirOk;
}

export function isExerciseHit(sets: LoggedSet[], exercise: SchemeFields): boolean {
  return sets.length > 0 && sets.every((set) => isSetHit(set, exercise));
}

export function computeWeightIncrement(muscleGroup: string): number {
  if (muscleGroup === 'upper') return 1.25;
  if (muscleGroup === 'lower') return 2.5;
  return 0;
}

export interface ExerciseProgressUpdate {
  current_weight: number;
  suggested_next_weight: number;
  consecutive_hit_count: number;
  consecutive_miss_count: number;
}

export function computeNextExerciseState(
  current: { consecutive_hit_count: number; consecutive_miss_count: number } | null,
  weightUsed: number,
  hit: boolean,
  increment: number
): ExerciseProgressUpdate {
  if (hit) {
    return {
      current_weight: weightUsed,
      suggested_next_weight: weightUsed + increment,
      consecutive_hit_count: (current?.consecutive_hit_count ?? 0) + 1,
      consecutive_miss_count: 0,
    };
  }
  return {
    current_weight: weightUsed,
    suggested_next_weight: weightUsed,
    consecutive_hit_count: 0,
    consecutive_miss_count: (current?.consecutive_miss_count ?? 0) + 1,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/progression/rules.test.ts`
Expected: PASS (18 tests)

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/progression/rules.ts tests/lib/progression/rules.test.ts
git commit -m "feat: add pure progression rules (hit/miss, weight increment)"
```

---

## Task 2: Pure deload and routine-switch rules

**Files:**
- Create: `src/lib/progression/deload.ts`
- Create: `src/lib/progression/routineSwitch.ts`
- Test: `tests/lib/progression/deload.test.ts`
- Test: `tests/lib/progression/routineSwitch.test.ts`

**Interfaces:**
- Consumes: `LoggedSet` from `src/lib/sessions/types.ts`; `computeWeekNumber` from `src/lib/sessions/weekResolution.ts` (already exists, from the session-logging plan).
- Produces (used by Task 4):
  - `hasTopSetDeficit(set: LoggedSet, targetReps: number, rirMin: number | null): boolean`
  - `hasConsecutiveDeficit(recentTopSets: LoggedSet[], targetReps: number, rirMin: number | null): boolean` — `recentTopSets` is assumed most-recent-first; only the first two entries are considered, and fewer than two means "not enough history yet," which is never a deficit.
  - `RoutineScheduleFields { started_at: string | null; suggested_duration_weeks: number | null; next_routine_id: string | null }`
  - `shouldSuggestRoutineSwitch(routine: RoutineScheduleFields, now: Date): boolean`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/progression/deload.test.ts
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
```

```typescript
// tests/lib/progression/routineSwitch.test.ts
import { shouldSuggestRoutineSwitch } from '../../../src/lib/progression/routineSwitch';

const baseRoutine = {
  started_at: '2026-01-01T12:00:00.000Z',
  suggested_duration_weeks: 4,
  next_routine_id: 'next-routine-id',
};

describe('shouldSuggestRoutineSwitch', () => {
  it('is false before the suggested duration is exceeded (still week 4)', () => {
    expect(shouldSuggestRoutineSwitch(baseRoutine, new Date(2026, 0, 28, 12))).toBe(false);
  });

  it('is true once the suggested duration is exceeded (week 5)', () => {
    expect(shouldSuggestRoutineSwitch(baseRoutine, new Date(2026, 0, 29, 12))).toBe(true);
  });

  it('is false when the routine was never started', () => {
    expect(shouldSuggestRoutineSwitch({ ...baseRoutine, started_at: null }, new Date(2026, 0, 29, 12))).toBe(false);
  });

  it('is false when the routine has no suggested duration (indefinite)', () => {
    expect(
      shouldSuggestRoutineSwitch({ ...baseRoutine, suggested_duration_weeks: null }, new Date(2026, 0, 29, 12))
    ).toBe(false);
  });

  it('is false when there is no next routine configured', () => {
    expect(shouldSuggestRoutineSwitch({ ...baseRoutine, next_routine_id: null }, new Date(2026, 0, 29, 12))).toBe(
      false
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/progression/deload.test.ts tests/lib/progression/routineSwitch.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement deload rules**

```typescript
// src/lib/progression/deload.ts
import { LoggedSet } from '../sessions/types';

export function hasTopSetDeficit(set: LoggedSet, targetReps: number, rirMin: number | null): boolean {
  const repDeficit = targetReps - set.reps > 0;
  const rirDeficit = rirMin !== null && set.rir !== null && rirMin - set.rir > 0;
  return repDeficit || rirDeficit;
}

export function hasConsecutiveDeficit(
  recentTopSets: LoggedSet[],
  targetReps: number,
  rirMin: number | null
): boolean {
  if (recentTopSets.length < 2) return false;
  return recentTopSets.slice(0, 2).every((set) => hasTopSetDeficit(set, targetReps, rirMin));
}
```

- [ ] **Step 4: Implement routine-switch rule**

```typescript
// src/lib/progression/routineSwitch.ts
import { computeWeekNumber } from '../sessions/weekResolution';

export interface RoutineScheduleFields {
  started_at: string | null;
  suggested_duration_weeks: number | null;
  next_routine_id: string | null;
}

export function shouldSuggestRoutineSwitch(routine: RoutineScheduleFields, now: Date): boolean {
  if (!routine.started_at || routine.suggested_duration_weeks === null || !routine.next_routine_id) {
    return false;
  }
  const weekNumber = computeWeekNumber(routine.started_at, now);
  return weekNumber > routine.suggested_duration_weeks;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/lib/progression/deload.test.ts tests/lib/progression/routineSwitch.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/progression/deload.ts src/lib/progression/routineSwitch.ts tests/lib/progression/deload.test.ts tests/lib/progression/routineSwitch.test.ts
git commit -m "feat: add pure deload and routine-switch rules"
```

---

## Task 3: Local cache and offline-queue extensions (muscle_group, progress counters, new entity type)

**Files:**
- Modify: `src/lib/sqlite/schema.ts`
- Modify: `src/lib/sqlite/db.ts`
- Modify: `src/lib/routines/types.ts`
- Modify: `src/lib/routines/queries.ts`
- Modify: `src/lib/sqlite/cache.ts`
- Modify: `src/lib/sync/flushQueue.ts`
- Modify: `src/lib/sqlite/pendingWrites.ts`
- Test: `tests/lib/sync/flushQueue.test.ts` (extend existing file)
- Test: `tests/lib/sqlite/schema.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces (used by Task 5):
  - `RoutineExerciseWithName` gains an optional `muscle_group?: string` field.
  - `CachedUserExerciseState` gains `consecutive_hit_count: number` and `consecutive_miss_count: number`.
  - `PendingWrite.entity` widens to `'workout_sessions' | 'logged_sets' | 'user_exercise_state'`.
  - `flushPendingWrites` upserts `user_exercise_state` writes on conflict target `'user_id,exercise_id'` instead of the primary key (its natural uniqueness is `(user_id, exercise_id)`, not the `id` column the client never learns).

**Why `muscle_group` is optional, not required:** several existing test fixtures across the last two plans construct `RoutineExerciseWithName` object literals by hand (e.g. `tests/lib/sessions/prescribedSets.test.ts`'s `baseExercise` helper). Making the new field required would break every one of those call sites for a field they don't need. Optional keeps this change additive — real rows from the database always populate it (the column is `not null` in Postgres), and the one caller that needs it (Task 5) falls back to `''` (which `computeWeightIncrement` already treats as "no increment") if it's ever missing.

**Why a local ALTER TABLE, not just editing the CREATE TABLE:** `schema.ts`'s `create table if not exists` statements only take effect on a device's *first* launch — a device that already ran the session-logging plan's schema has these tables already, so a fresh-install-only column addition would never reach it. This task adds the column to both the `CREATE TABLE` text (for genuinely new installs) and a separate idempotent migration list (for devices upgrading from the older schema).

- [ ] **Step 1: Update the local cache schema**

Read `src/lib/sqlite/schema.ts` first. Modify the `routine_exercises_cache` and `user_exercise_state_cache` table definitions to add the new columns, and add a new exported `MIGRATION_STATEMENTS` array:

```typescript
// src/lib/sqlite/schema.ts
export const CREATE_TABLES_SQL = `
  create table if not exists routines_cache (
    id text primary key,
    name text not null,
    uses_top_set_backoff integer not null,
    suggested_duration_weeks integer,
    next_routine_id text,
    weekday_schedule text not null,
    is_active integer not null,
    started_at text
  );

  create table if not exists routine_days_cache (
    id text primary key,
    routine_id text not null,
    name text not null,
    order_index integer not null,
    is_rest_day integer not null
  );

  create table if not exists routine_exercises_cache (
    id text primary key,
    routine_day_id text not null,
    exercise_id text not null,
    exercise_name text not null,
    order_index integer not null,
    role text not null,
    scheme_type text not null,
    rep_unit text not null,
    sets integer,
    rep_min integer,
    rep_max integer,
    rir_min integer,
    rir_max integer,
    top_set_reps integer,
    backoff_sets integer,
    backoff_rep_min integer,
    backoff_rep_max integer,
    muscle_group text
  );

  create table if not exists user_exercise_state_cache (
    exercise_id text primary key,
    current_weight real,
    suggested_next_weight real,
    consecutive_hit_count integer not null default 0,
    consecutive_miss_count integer not null default 0
  );

  create table if not exists pending_writes (
    id text primary key,
    entity text not null,
    payload_json text not null,
    created_at text not null,
    attempts integer not null default 0
  );
`;

export const MIGRATION_STATEMENTS = [
  'alter table routine_exercises_cache add column muscle_group text',
  'alter table user_exercise_state_cache add column consecutive_hit_count integer not null default 0',
  'alter table user_exercise_state_cache add column consecutive_miss_count integer not null default 0',
];
```

- [ ] **Step 2: Run the existing schema test to confirm it still passes, then extend it**

Run: `npx jest tests/lib/sqlite/schema.test.ts`
Expected: PASS (unchanged — it only checks for `create table if not exists <name>` substrings, which are all still present)

Read `tests/lib/sqlite/schema.test.ts` and add a new `describe` block:

```typescript
// tests/lib/sqlite/schema.test.ts — add below the existing describe block
import { MIGRATION_STATEMENTS } from '../../../src/lib/sqlite/schema';

describe('local SQLite schema migrations', () => {
  it('adds muscle_group and the progress counters for devices upgrading from the prior schema', () => {
    expect(MIGRATION_STATEMENTS).toContain('alter table routine_exercises_cache add column muscle_group text');
    expect(MIGRATION_STATEMENTS).toContain(
      'alter table user_exercise_state_cache add column consecutive_hit_count integer not null default 0'
    );
    expect(MIGRATION_STATEMENTS).toContain(
      'alter table user_exercise_state_cache add column consecutive_miss_count integer not null default 0'
    );
  });
});
```

(Add the `MIGRATION_STATEMENTS` import to the existing `import { CREATE_TABLES_SQL } from ...` line at the top of the file rather than duplicating the import statement.)

Run: `npx jest tests/lib/sqlite/schema.test.ts`
Expected: PASS (2 tests total)

- [ ] **Step 3: Apply the migration in `initDatabase`**

Read `src/lib/sqlite/db.ts` first. Update it:

```typescript
// src/lib/sqlite/db.ts
import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL, MIGRATION_STATEMENTS } from './schema';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync('fit-tracker.db');
  }
  return dbInstance;
}

export function initDatabase(): void {
  const db = getDatabase();
  db.execSync(CREATE_TABLES_SQL);
  for (const statement of MIGRATION_STATEMENTS) {
    try {
      db.execSync(statement);
    } catch {
      // Already applied on a device that had this table before this column existed —
      // expected on every launch after the first one that added it. SQLite has no
      // portable "ADD COLUMN IF NOT EXISTS" old enough to rely on here.
    }
  }
}
```

This cannot be unit tested under Jest (calls `expo-sqlite`) — verified manually on-device in Task 5/6's walkthrough.

- [ ] **Step 4: Widen `RoutineExerciseWithName` and `listDayExercises`**

Read `src/lib/routines/types.ts` first. Add the optional field to `RoutineExerciseWithName`:

```typescript
// src/lib/routines/types.ts — modify this interface only, leave everything else unchanged
export interface RoutineExerciseWithName extends RoutineExercise {
  exercise_name: string;
  muscle_group?: string;
}
```

Read `src/lib/routines/queries.ts` first. Update `listDayExercises` to select and map the new field:

```typescript
// src/lib/routines/queries.ts — replace only the listDayExercises function
export async function listDayExercises(
  supabase: SupabaseClient,
  dayId: string
): Promise<RoutineExerciseWithName[]> {
  const { data, error } = await supabase
    .from('routine_exercises')
    .select('*, exercises(name, muscle_group)')
    .eq('routine_day_id', dayId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  return (data as any[]).map((row) => ({
    ...row,
    exercise_name: row.exercises.name,
    muscle_group: row.exercises.muscle_group,
  }));
}
```

Run: `npx jest tests/lib/routines/queries.test.ts`
Expected: PASS — this is a purely additive change (existing tests only assert `exercise_name`, unaffected by the extra field).

- [ ] **Step 5: Update the local cache read/write for the new columns**

Read `src/lib/sqlite/cache.ts` first. Update `CachedUserExerciseState`, the `refreshLocalCache` reads/inserts, and nothing else in this file (its exported function signatures are otherwise unchanged):

```typescript
// src/lib/sqlite/cache.ts — modify CachedUserExerciseState
export interface CachedUserExerciseState {
  exercise_id: string;
  current_weight: number | null;
  suggested_next_weight: number | null;
  consecutive_hit_count: number;
  consecutive_miss_count: number;
}
```

In `refreshLocalCache`, change the `user_exercise_state` select to include the two counters:

```typescript
  const { data: states, error: statesError } = await supabase
    .from('user_exercise_state')
    .select('exercise_id, current_weight, suggested_next_weight, consecutive_hit_count, consecutive_miss_count')
    .eq('user_id', userId);
  if (statesError) throw statesError;
```

Change the `routine_exercises_cache` insert to include `muscle_group` (18th column now):

```typescript
    exercisesByDay.flat().forEach((exercise) => {
      db.runSync(
        `insert into routine_exercises_cache
           (id, routine_day_id, exercise_id, exercise_name, order_index, role, scheme_type, rep_unit,
            sets, rep_min, rep_max, rir_min, rir_max, top_set_reps, backoff_sets, backoff_rep_min, backoff_rep_max,
            muscle_group)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          exercise.id,
          exercise.routine_day_id,
          exercise.exercise_id,
          exercise.exercise_name,
          exercise.order_index,
          exercise.role,
          exercise.scheme_type,
          exercise.rep_unit,
          exercise.sets,
          exercise.rep_min,
          exercise.rep_max,
          exercise.rir_min,
          exercise.rir_max,
          exercise.top_set_reps,
          exercise.backoff_sets,
          exercise.backoff_rep_min,
          exercise.backoff_rep_max,
          exercise.muscle_group ?? null,
        ]
      );
    });
```

Change the `user_exercise_state_cache` insert to include the two counters:

```typescript
    (states ?? []).forEach((state) => {
      db.runSync(
        `insert into user_exercise_state_cache
           (exercise_id, current_weight, suggested_next_weight, consecutive_hit_count, consecutive_miss_count)
         values (?, ?, ?, ?, ?)`,
        [
          state.exercise_id,
          state.current_weight,
          state.suggested_next_weight,
          state.consecutive_hit_count,
          state.consecutive_miss_count,
        ]
      );
    });
```

This cannot be unit tested under Jest (calls `expo-sqlite`) — verified manually on-device.

- [ ] **Step 6: Write the failing tests for the widened offline queue**

Read `tests/lib/sync/flushQueue.test.ts` first. Extend the `fakeSupabase` helper to capture the `upsert` call's second argument, and add two new tests:

```typescript
// tests/lib/sync/flushQueue.test.ts — replace the fakeSupabase helper and add new tests
import { flushPendingWrites, PendingWrite } from '../../../src/lib/sync/flushQueue';

function fakeSupabase(behavior: (table: string, payload: Record<string, unknown>) => { error: unknown }) {
  const calls: Array<{ table: string; payload: Record<string, unknown>; options?: { onConflict?: string } }> = [];
  const client = {
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>, options?: { onConflict?: string }) {
          calls.push({ table, payload, options });
          return Promise.resolve(behavior(table, payload));
        },
      };
    },
  };
  return { client, calls };
}

// ...(keep the existing three `it(...)` blocks inside `describe('flushPendingWrites', ...)` unchanged)...

// Add these two new tests inside the same describe('flushPendingWrites', ...) block:
  it('upserts user_exercise_state on conflict (user_id, exercise_id), not the primary key', async () => {
    const { client, calls } = fakeSupabase(() => ({ error: null }));
    const writes: PendingWrite[] = [
      {
        id: 'w1',
        entity: 'user_exercise_state',
        payload: { user_id: 'u1', exercise_id: 'e1', current_weight: 60 },
      },
    ];
    await flushPendingWrites(client as any, writes);
    expect(calls[0].options).toEqual({ onConflict: 'user_id,exercise_id' });
  });

  it('upserts workout_sessions and logged_sets with no onConflict override (primary key default)', async () => {
    const { client, calls } = fakeSupabase(() => ({ error: null }));
    const writes: PendingWrite[] = [{ id: 'w1', entity: 'workout_sessions', payload: { id: 'w1' } }];
    await flushPendingWrites(client as any, writes);
    expect(calls[0].options).toBeUndefined();
  });
```

- [ ] **Step 7: Run the tests to verify the new ones fail**

Run: `npx jest tests/lib/sync/flushQueue.test.ts`
Expected: the 3 pre-existing tests still pass (the fake's new second parameter is optional and unused by them); the 2 new tests FAIL — `entity` type doesn't include `'user_exercise_state'` yet, and `flushPendingWrites` never passes an `onConflict` option

- [ ] **Step 8: Widen the entity type and add per-entity conflict targets**

Read `src/lib/sync/flushQueue.ts` first, then replace it:

```typescript
// src/lib/sync/flushQueue.ts
import { SupabaseClient } from '@supabase/supabase-js';

export interface PendingWrite {
  id: string;
  entity: 'workout_sessions' | 'logged_sets' | 'user_exercise_state';
  payload: Record<string, unknown>;
}

export interface FlushResult {
  succeededIds: string[];
  failedIds: string[];
}

const CONFLICT_TARGETS: Partial<Record<PendingWrite['entity'], string>> = {
  user_exercise_state: 'user_id,exercise_id',
};

export async function flushPendingWrites(supabase: SupabaseClient, writes: PendingWrite[]): Promise<FlushResult> {
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  for (const write of writes) {
    const onConflict = CONFLICT_TARGETS[write.entity];
    const { error } = await supabase.from(write.entity).upsert(write.payload, onConflict ? { onConflict } : undefined);
    if (error) {
      failedIds.push(write.id);
    } else {
      succeededIds.push(write.id);
    }
  }
  return { succeededIds, failedIds };
}
```

Read `src/lib/sqlite/pendingWrites.ts` first, then update its entity cast to match the widened union:

```typescript
// src/lib/sqlite/pendingWrites.ts — change only the cast inside listPendingWrites
export function listPendingWrites(db: SQLiteDatabase): PendingWrite[] {
  const rows = db.getAllSync<PendingWriteRow>('select * from pending_writes order by created_at asc');
  return rows.map((row) => ({
    id: row.id,
    entity: row.entity as 'workout_sessions' | 'logged_sets' | 'user_exercise_state',
    payload: JSON.parse(row.payload_json),
  }));
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx jest tests/lib/sync/flushQueue.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 10: Type-check, run the full suite, and commit**

Run: `npx tsc --noEmit && npx jest`
Expected: no type errors; all suites pass

```bash
git add src/lib/sqlite/schema.ts src/lib/sqlite/db.ts src/lib/routines/types.ts src/lib/routines/queries.ts src/lib/sqlite/cache.ts src/lib/sync/flushQueue.ts src/lib/sqlite/pendingWrites.ts tests/lib/sync/flushQueue.test.ts tests/lib/sqlite/schema.test.ts
git commit -m "feat: extend local cache and offline queue for progression data"
```

---

## Task 4: Deload/routine-switch orchestration and the deload mutation

**Files:**
- Create: `src/lib/progression/queries.ts`
- Create: `src/lib/progression/mutations.ts`
- Create: `src/lib/progression/suggestions.ts`
- Test: `tests/lib/progression/suggestions.test.ts`

**Interfaces:**
- Consumes: `hasConsecutiveDeficit` from `src/lib/progression/deload.ts` (Task 2); `shouldSuggestRoutineSwitch`, `RoutineScheduleFields` from `src/lib/progression/routineSwitch.ts` (Task 2); `LoggedSet` from `src/lib/sessions/types.ts`; `RoutineExerciseWithName` from `src/lib/routines/types.ts`; `seedActiveRoutine` from `tests/helpers/seedActiveRoutine.ts` (already exists).
- Produces (used by Task 6):
  - `listRecentTopSets(supabase: SupabaseClient, routineExerciseId: string, limit?: number): Promise<LoggedSet[]>` — most-recent-first, only from `completed` sessions.
  - `recordDeload(supabase: SupabaseClient, userId: string, routineId: string): Promise<void>`
  - `Suggestions { deloadExerciseName: string | null; routineSwitchAvailable: boolean }`
  - `computeSuggestions(supabase: SupabaseClient, topSetExercises: RoutineExerciseWithName[], routine: RoutineScheduleFields, now: Date): Promise<Suggestions>` — `topSetExercises` must already be filtered to `scheme_type === 'top_set_backoff'` and deduplicated by the caller (this function doesn't filter or dedupe; that's Task 6's job, done against the already-cached day/exercise lists it already has).

This function deliberately takes plain `RoutineExerciseWithName[]`/`RoutineScheduleFields` rather than reading from the local SQLite cache directly, so it stays Jest-testable against the real hosted Supabase project (matching every other Supabase-touching module in this codebase) instead of being stuck in the untestable expo-sqlite bucket like `cache.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/progression/suggestions.test.ts
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedActiveRoutine } from '../../helpers/seedActiveRoutine';
import { listRecentTopSets, recordDeload } from '../../../src/lib/progression/queries';
import { computeSuggestions } from '../../../src/lib/progression/suggestions';
import { RoutineExerciseWithName } from '../../../src/lib/routines/types';

const supabase = createAdminClient();
const testEmail = `progression-suggestions-${Date.now()}@example.com`;
let userId: string;

beforeAll(async () => {
  const { data, error } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: 'testpassword123',
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
});

afterAll(async () => {
  await supabase.auth.admin.deleteUser(userId);
});

async function seedTopSetExercise(dayId: string): Promise<RoutineExerciseWithName> {
  const suffix = Date.now() + Math.random();
  const { data: exercise, error: exerciseError } = await supabase
    .from('exercises')
    .insert({ name: `Sentadilla ${suffix}`, muscle_group: 'lower' })
    .select()
    .single();
  if (exerciseError) throw exerciseError;

  const { data: routineExercise, error: routineExerciseError } = await supabase
    .from('routine_exercises')
    .insert({
      routine_day_id: dayId,
      exercise_id: exercise.id,
      order_index: 1,
      role: 'main',
      scheme_type: 'top_set_backoff',
      top_set_reps: 5,
      backoff_sets: 2,
      backoff_rep_min: 8,
      backoff_rep_max: 10,
      rir_min: 1,
      rir_max: 2,
    })
    .select('*, exercises(name)')
    .single();
  if (routineExerciseError) throw routineExerciseError;

  return { ...routineExercise, exercise_name: routineExercise.exercises.name };
}

async function seedCompletedSessionWithTopSet(
  dayId: string,
  routineExerciseId: string,
  sessionDate: string,
  reps: number,
  rir: number
) {
  const { data: sessionRow, error: sessionError } = await supabase
    .from('workout_sessions')
    .insert({ user_id: userId, routine_day_id: dayId, session_date: sessionDate, status: 'completed' })
    .select()
    .single();
  if (sessionError) throw sessionError;

  const { error: setError } = await supabase.from('logged_sets').insert({
    session_id: sessionRow.id,
    routine_exercise_id: routineExerciseId,
    set_index: 1,
    set_type: 'top_set',
    weight: 80,
    reps,
    rir,
  });
  if (setError) throw setError;
}

describe('listRecentTopSets', () => {
  it('returns completed-session top sets, most recent first, limited to 2', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);
    const exercise = await seedTopSetExercise(day.id);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-03-01', 5, 2);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-03-08', 4, 1);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-03-15', 3, 0);

    const sets = await listRecentTopSets(supabase, exercise.id);
    expect(sets).toHaveLength(2);
    expect(sets.map((s) => s.reps)).toEqual([3, 4]);
  });
});

describe('computeSuggestions', () => {
  it('suggests a deload when the top set missed in the last two completed sessions', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);
    const exercise = await seedTopSetExercise(day.id);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-04-01', 3, 0);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-04-08', 4, 0);

    const result = await computeSuggestions(
      supabase,
      [exercise],
      { started_at: null, suggested_duration_weeks: null, next_routine_id: null },
      new Date()
    );
    expect(result.deloadExerciseName).toBe(exercise.exercise_name);
  });

  it('does not suggest a deload when only one of the last two sessions missed', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);
    const exercise = await seedTopSetExercise(day.id);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-05-01', 5, 2);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-05-08', 3, 0);

    const result = await computeSuggestions(
      supabase,
      [exercise],
      { started_at: null, suggested_duration_weeks: null, next_routine_id: null },
      new Date()
    );
    expect(result.deloadExerciseName).toBeNull();
  });

  it('suggests a routine switch once the suggested duration is exceeded', async () => {
    const routine = {
      started_at: '2026-01-01T12:00:00.000Z',
      suggested_duration_weeks: 4,
      next_routine_id: 'next-routine-id',
    };
    const result = await computeSuggestions(supabase, [], routine, new Date(2026, 0, 29, 12));
    expect(result.routineSwitchAvailable).toBe(true);
  });

  it('does not suggest a routine switch with no next routine configured', async () => {
    const routine = {
      started_at: '2026-01-01T12:00:00.000Z',
      suggested_duration_weeks: 4,
      next_routine_id: null,
    };
    const result = await computeSuggestions(supabase, [], routine, new Date(2026, 0, 29, 12));
    expect(result.routineSwitchAvailable).toBe(false);
  });
});

describe('recordDeload', () => {
  it('inserts a deload event into routine_history', async () => {
    const { routine } = await seedActiveRoutine(supabase, userId);
    await recordDeload(supabase, userId, routine.id);
    const { data, error } = await supabase
      .from('routine_history')
      .select('*')
      .eq('routine_id', routine.id)
      .eq('event_type', 'deload');
    if (error) throw error;
    expect(data).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/progression/suggestions.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the queries and mutation**

```typescript
// src/lib/progression/queries.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { LoggedSet } from '../sessions/types';

export async function listRecentTopSets(
  supabase: SupabaseClient,
  routineExerciseId: string,
  limit = 2
): Promise<LoggedSet[]> {
  const { data, error } = await supabase
    .from('logged_sets')
    .select('*, workout_sessions!inner(status)')
    .eq('routine_exercise_id', routineExerciseId)
    .eq('set_type', 'top_set')
    .eq('workout_sessions.status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as any[]).map(({ workout_sessions, ...rest }) => rest as LoggedSet);
}
```

```typescript
// src/lib/progression/mutations.ts
import { SupabaseClient } from '@supabase/supabase-js';

export async function recordDeload(supabase: SupabaseClient, userId: string, routineId: string): Promise<void> {
  const { error } = await supabase
    .from('routine_history')
    .insert({ user_id: userId, routine_id: routineId, event_type: 'deload' });
  if (error) throw error;
}
```

- [ ] **Step 4: Implement the suggestions orchestration**

```typescript
// src/lib/progression/suggestions.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { RoutineExerciseWithName } from '../routines/types';
import { hasConsecutiveDeficit } from './deload';
import { shouldSuggestRoutineSwitch, RoutineScheduleFields } from './routineSwitch';
import { listRecentTopSets } from './queries';

export interface Suggestions {
  deloadExerciseName: string | null;
  routineSwitchAvailable: boolean;
}

export async function computeSuggestions(
  supabase: SupabaseClient,
  topSetExercises: RoutineExerciseWithName[],
  routine: RoutineScheduleFields,
  now: Date
): Promise<Suggestions> {
  let deloadExerciseName: string | null = null;

  for (const exercise of topSetExercises) {
    const recentTopSets = await listRecentTopSets(supabase, exercise.id).catch(() => []);
    if (hasConsecutiveDeficit(recentTopSets, exercise.top_set_reps ?? 0, exercise.rir_min)) {
      deloadExerciseName = exercise.exercise_name;
      break;
    }
  }

  return {
    deloadExerciseName,
    routineSwitchAvailable: shouldSuggestRoutineSwitch(routine, now),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/lib/progression/suggestions.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Type-check, run the full suite, and commit**

Run: `npx tsc --noEmit && npx jest`

```bash
git add src/lib/progression/queries.ts src/lib/progression/mutations.ts src/lib/progression/suggestions.ts tests/lib/progression/suggestions.test.ts
git commit -m "feat: add deload/routine-switch suggestion orchestration"
```

---

## Task 5: Wire progression into session logging

**Files:**
- Modify: `src/hooks/useSessionSets.ts`

**Interfaces:**
- Consumes: `isExerciseHit`, `computeWeightIncrement`, `computeNextExerciseState` from `src/lib/progression/rules.ts` (Task 1); `buildPrescribedSets` from `src/lib/sessions/prescribedSets.ts` (already exists); the widened `enqueueWrite`/`PendingWrite` entity type and `CachedUserExerciseState`'s new fields (Task 3).
- Produces: nothing consumed by a later task — this is a leaf integration.

**This task's code calls `expo-sqlite` (via `getCachedExerciseState`/`enqueueWrite`) and cannot be unit tested under Jest — verified manually on-device in Task 6's walkthrough, exactly like the session-logging plan's UI-integration tasks.**

- [ ] **Step 1: Read the current file**

Read `src/hooks/useSessionSets.ts` first — it currently exports `useSessionSets(sessionId)` returning `{ dayName, exercises, loggedSets, weightByExercise, loading, loadForDay, logSet, completeSession }`. `logSet` builds a `logged_sets` payload, enqueues it, appends it to local state, and does a best-effort `flushOnly`. `loadForDay` populates `weightByExercise` from each exercise's cached `current_weight`.

- [ ] **Step 2: Prefer the suggested weight when prefilling**

In `loadForDay`, change:

```typescript
      weights[exercise.id] = state?.current_weight ?? null;
```

to:

```typescript
      weights[exercise.id] = state?.suggested_next_weight ?? state?.current_weight ?? null;
```

- [ ] **Step 3: Recompute progression after an exercise's last set is logged**

Add the new imports:

```typescript
import { buildPrescribedSets } from '../lib/sessions/prescribedSets';
import { isExerciseHit, computeWeightIncrement, computeNextExerciseState } from '../lib/progression/rules';
```

Replace `logSet` with a version that, after appending the new set, checks whether that exercise's prescribed sets are now all logged and — if so, and the exercise isn't `core` — computes and enqueues the progression update:

```typescript
  async function logSet(
    routineExerciseId: string,
    setIndex: number,
    setType: SetType,
    weight: number,
    reps: number,
    rir: number | null
  ) {
    if (!sessionId || !userId) return;
    const id = Crypto.randomUUID();
    const payload = {
      id,
      session_id: sessionId,
      routine_exercise_id: routineExerciseId,
      set_index: setIndex,
      set_type: setType,
      weight,
      reps,
      rir,
      created_at: new Date().toISOString(),
    };
    enqueueWrite(getDatabase(), id, 'logged_sets', payload);
    const updatedLoggedSets = [...loggedSets, payload as LoggedSet];
    setLoggedSets(updatedLoggedSets);

    const exercise = exercises.find((e) => e.id === routineExerciseId);
    if (exercise && exercise.muscle_group !== 'core') {
      const setsForExercise = updatedLoggedSets.filter((s) => s.routine_exercise_id === routineExerciseId);
      const prescribed = buildPrescribedSets(exercise);
      if (setsForExercise.length === prescribed.length) {
        const hit = isExerciseHit(setsForExercise, exercise);
        const weightUsed = setsForExercise.find((s) => s.set_index === 1)?.weight ?? weight;
        const increment = computeWeightIncrement(exercise.muscle_group ?? '');
        const current = getCachedExerciseState(getDatabase(), exercise.exercise_id);
        const update = computeNextExerciseState(current, weightUsed, hit, increment);
        const progressWriteId = Crypto.randomUUID();
        enqueueWrite(getDatabase(), progressWriteId, 'user_exercise_state', {
          user_id: userId,
          exercise_id: exercise.exercise_id,
          ...update,
          updated_at: new Date().toISOString(),
        });
      }
    }

    flushOnly(getDatabase(), supabase).catch(() => {});
  }
```

Note this changes the function's early guard from `if (!sessionId) return;` to `if (!sessionId || !userId) return;` — the progression write needs `userId` to build its payload, and in practice this hook is only ever used from the authenticated `(app)` route group, so `userId` is always present when a real set gets logged.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run the full Jest suite to confirm no regressions**

Run: `npx jest`
Expected: all suites pass (this task adds no new Jest tests, per the note above)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSessionSets.ts
git commit -m "feat: recompute weight progression after completing an exercise"
```

---

## Task 6: Wire deload and routine-switch banners into Home

**Files:**
- Modify: `src/hooks/useHomeData.ts`
- Modify: `app/(app)/index.tsx`

**Interfaces:**
- Consumes: `computeSuggestions` from `src/lib/progression/suggestions.ts` (Task 4); `recordDeload` from `src/lib/progression/mutations.ts` (Task 4); `activateRoutine` from `src/lib/routines/mutations.ts` (already exists); `getRoutine` from `src/lib/routines/queries.ts` (already exists); `getCachedRoutineDays`, `getCachedDayExercises` from `src/lib/sqlite/cache.ts` (already exist, already imported elsewhere but not yet in this hook).
- Produces: nothing consumed by a later task — this is the final integration.

**This task's code calls `expo-sqlite` and cannot be unit tested under Jest — this task's last step is the manual on-device walkthrough for the whole plan.**

- [ ] **Step 1: Read the current file**

Read `src/hooks/useHomeData.ts` first — it currently exports `useHomeData()` returning `{ loading, error, routineName, weekNumber, todayDayName, todayIsRestDay, sessionStatus, startOrResumeSession }`. Its `load()` function resolves the active routine/today's day via `resolveToday` and sets session status; `startOrResumeSession` creates or resumes today's session.

- [ ] **Step 2: Add the new imports**

```typescript
import { getCachedRoutineDays, getCachedDayExercises } from '../lib/sqlite/cache';
import { computeSuggestions } from '../lib/progression/suggestions';
import { recordDeload } from '../lib/progression/mutations';
import { activateRoutine } from '../lib/routines/mutations';
import { getRoutine } from '../lib/routines/queries';
```

(`resolveToday` is already imported from `'../lib/sqlite/cache'` in this file — add the two new names to that same import line rather than a second import statement.)

- [ ] **Step 3: Add suggestion state**

Add these state declarations alongside the existing ones:

```typescript
  const [deloadExerciseName, setDeloadExerciseName] = useState<string | null>(null);
  const [deloadDismissed, setDeloadDismissed] = useState(false);
  const [routineSwitchAvailable, setRoutineSwitchAvailable] = useState(false);
  const [nextRoutineId, setNextRoutineId] = useState<string | null>(null);
  const [nextRoutineName, setNextRoutineName] = useState<string | null>(null);
  const [switchDismissed, setSwitchDismissed] = useState(false);
```

- [ ] **Step 4: Compute suggestions inside `load()`**

In the early-return branch for "no active routine" (`if (!resolved) { ... return; }`), add resets for the new state alongside the existing ones:

```typescript
      if (!resolved) {
        setRoutineName(null);
        setWeekNumber(null);
        setTodayDayId(null);
        setTodayDayName(null);
        setTodayIsRestDay(false);
        setSessionStatus('none');
        setDeloadExerciseName(null);
        setRoutineSwitchAvailable(false);
        setNextRoutineName(null);
        return;
      }
```

After `setRoutineName(resolved.routine.name); setWeekNumber(resolved.weekNumber);` and before the `const day = resolved.day;` line, add the suggestion computation:

```typescript
      setDeloadDismissed(false);
      setSwitchDismissed(false);
      const days = getCachedRoutineDays(getDatabase(), resolved.routine.id);
      const exercisesByDay = days.map((d) => getCachedDayExercises(getDatabase(), d.id));
      const seenExerciseIds = new Set<string>();
      const topSetExercises = exercisesByDay.flat().filter((exercise) => {
        if (exercise.scheme_type !== 'top_set_backoff' || seenExerciseIds.has(exercise.id)) return false;
        seenExerciseIds.add(exercise.id);
        return true;
      });
      const suggestions = await computeSuggestions(supabase, topSetExercises, resolved.routine, new Date()).catch(
        () => ({ deloadExerciseName: null, routineSwitchAvailable: false })
      );
      setDeloadExerciseName(suggestions.deloadExerciseName);
      setRoutineSwitchAvailable(suggestions.routineSwitchAvailable);
      setNextRoutineId(resolved.routine.next_routine_id);
      if (suggestions.routineSwitchAvailable && resolved.routine.next_routine_id) {
        const nextRoutine = await getRoutine(supabase, resolved.routine.next_routine_id).catch(() => null);
        setNextRoutineName(nextRoutine?.name ?? null);
      } else {
        setNextRoutineName(null);
      }
```

- [ ] **Step 5: Add accept/dismiss handlers**

Add these functions alongside `startOrResumeSession` (before the `return` statement):

```typescript
  function dismissDeload() {
    setDeloadDismissed(true);
  }

  function dismissSwitch() {
    setSwitchDismissed(true);
  }

  async function acceptDeload() {
    const resolved = resolveToday(getDatabase());
    if (!userId || !resolved) return;
    await recordDeload(supabase, userId, resolved.routine.id);
    setDeloadDismissed(true);
  }

  async function acceptSwitch() {
    if (!userId || !nextRoutineId) return;
    await activateRoutine(supabase, userId, nextRoutineId);
    setSwitchDismissed(true);
    await load();
  }
```

- [ ] **Step 6: Update the returned object**

Replace the `return` statement:

```typescript
  return {
    loading,
    error,
    routineName,
    weekNumber,
    todayDayName,
    todayIsRestDay,
    sessionStatus,
    startOrResumeSession,
    deloadExerciseName: deloadDismissed ? null : deloadExerciseName,
    routineSwitchAvailable: switchDismissed ? false : routineSwitchAvailable,
    nextRoutineName,
    dismissDeload,
    dismissSwitch,
    acceptDeload,
    acceptSwitch,
  };
```

- [ ] **Step 7: Add the banners to the Home screen**

Read `app/(app)/index.tsx` first. Add `Alert` to the existing `react-native` import:

```typescript
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
```

Destructure the new hook fields:

```typescript
  const {
    loading,
    error,
    routineName,
    weekNumber,
    todayDayName,
    todayIsRestDay,
    sessionStatus,
    startOrResumeSession,
    deloadExerciseName,
    routineSwitchAvailable,
    nextRoutineName,
    dismissDeload,
    dismissSwitch,
    acceptDeload,
    acceptSwitch,
  } = useHomeData();
```

Add the two accept handlers alongside `handleStart`:

```typescript
  async function handleAcceptDeload() {
    try {
      await acceptDeload();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo registrar el deload.');
    }
  }

  async function handleAcceptSwitch() {
    try {
      await acceptSwitch();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo cambiar de rutina.');
    }
  }
```

Add the banners right after the closing `</View>` of the existing `{!loading && !error && (...)}` routine card block, still inside the outer container `<View>`:

```tsx
      {deloadExerciseName && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            ¿Bajarle la intensidad a "{deloadExerciseName}"? Viene costando en las últimas sesiones.
          </Text>
          <View style={styles.bannerActions}>
            <Pressable style={styles.bannerButton} onPress={handleAcceptDeload}>
              <Text style={styles.bannerButtonText}>Aceptar</Text>
            </Pressable>
            <Pressable style={styles.bannerButtonSecondary} onPress={dismissDeload}>
              <Text style={styles.bannerButtonSecondaryText}>Ignorar</Text>
            </Pressable>
          </View>
        </View>
      )}

      {routineSwitchAvailable && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Ya pasaron las semanas sugeridas de esta rutina
            {nextRoutineName ? ` — ¿cambiar a "${nextRoutineName}"?` : '.'}
          </Text>
          <View style={styles.bannerActions}>
            <Pressable style={styles.bannerButton} onPress={handleAcceptSwitch}>
              <Text style={styles.bannerButtonText}>Aceptar</Text>
            </Pressable>
            <Pressable style={styles.bannerButtonSecondary} onPress={dismissSwitch}>
              <Text style={styles.bannerButtonSecondaryText}>Ignorar</Text>
            </Pressable>
          </View>
        </View>
      )}
```

Add the new styles to the existing `StyleSheet.create({...})` call:

```typescript
  banner: { width: '100%', gap: 8, borderWidth: 1, borderColor: '#f59e0b', borderRadius: 8, padding: 16 },
  bannerText: { color: '#111' },
  bannerActions: { flexDirection: 'row', gap: 8 },
  bannerButton: { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 10, alignItems: 'center' },
  bannerButtonText: { color: '#fff', fontWeight: '600' },
  bannerButtonSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  bannerButtonSecondaryText: { color: '#111', fontWeight: '600' },
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 9: Run the full Jest suite**

Run: `npx jest`
Expected: all suites pass (this task adds no new Jest tests)

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useHomeData.ts "app/(app)/index.tsx"
git commit -m "feat: surface deload and routine-switch banners on Home"
```

- [ ] **Step 11: Manual end-to-end verification on a real device**

This is the check for everything Tasks 3, 5, and 6 couldn't cover with Jest:

1. Pick a `normal`-scheme exercise in your active routine whose target you can realistically hit (e.g. `3×8-10 @ RIR 2-3`). Log all its prescribed sets meeting or exceeding the rep/RIR target on every set. Complete the session.
2. Check the Supabase dashboard's `user_exercise_state` table: confirm a row now exists for that exercise with `suggested_next_weight` equal to what you logged plus the expected increment (1.25 if the exercise's catalog `muscle_group` is `upper`, 2.5 if `lower`), and `consecutive_hit_count = 1`.
3. Start a new session on a day that includes the same exercise (or manually re-open the session screen for a fresh day touching it). Confirm the weight field is now prefilled with the *suggested* weight, not the old one.
4. Log that same exercise again, but this time miss the target on at least one set (fewer reps, or worse RIR). Confirm in Supabase that `suggested_next_weight` stayed equal to what you actually logged this time, and `consecutive_miss_count = 1`, `consecutive_hit_count = 0`.
5. Confirm a `core`-muscle-group exercise never gets a `user_exercise_state` row created for it no matter how you log it.
6. If your routine has a `top_set_backoff` exercise: log two separate completed sessions where its top set misses either the rep or RIR target both times. Reopen Home and confirm the deload banner appears naming that exercise. Tap "Aceptar" and confirm a `deload` row appears in `routine_history` for the active routine, and the banner disappears. Reopen Home again (a fresh focus) and confirm the banner does **not** persist forever if you tap "Ignorar" instead — it should still be dismissed for that visit, but note it's expected to reappear on the *next* visit if the deficit condition is still true (no persisted dismissal, per this plan's ruling above).
7. If you have a routine with `suggested_duration_weeks` set and a `next_routine_id` configured: temporarily verify the boundary by checking the Supabase `routines.started_at` value is old enough to exceed the suggested duration (or use a routine you know is overdue). Confirm the switch banner appears with the next routine's name, and tapping "Aceptar" actually activates that routine (check `routines.is_active` flips in Supabase, and Home now shows the new routine's name).

Report the outcome of this walkthrough — if any step fails, fix it before considering the plan done.

---

## Self-Review Notes

**Spec coverage:** §8 "Progression (raise weight)" → Tasks 1, 5. §8 "Deload" → Tasks 2, 4, 6. §8 "Routine switch" → Tasks 2, 4, 6. The two items §12 left open (exact increment table, and — implicitly — what "no persisted pending suggestion" means for the dismiss UX) are resolved explicitly in this plan's header rather than left ambiguous.

**Explicitly out of scope (unchanged from the session-logging plan's own scoping):** nothing new deferred by this plan beyond what's stated above (core exercises get no automatic progression; deload/switch dismissal isn't persisted).

**Cross-task type-safety note:** `RoutineExerciseWithName.muscle_group` is optional specifically so that Task 1's and the pre-existing `prescribedSets.test.ts`'s hand-built exercise fixtures never need updating when Task 3 lands — verified by design in Task 3's write-up above, not left as an assumption.
