# Workout Logging + Offline Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user log a workout session (sets, reps/seconds, RIR) against today's resolved routine day, fully offline-first, with a local SQLite cache for reads and a `pending_writes` queue that flushes to Supabase on reconnect.

**Architecture:** A pure domain layer (`src/lib/sessions/*`) computes which day to train today and what sets an exercise prescribes, with no I/O — fully unit tested. A thin SQLite layer (`src/lib/sqlite/*`) mirrors the active routine for offline reads and queues session/set writes; it cannot run under Jest (no native module in Node) so it's verified manually on-device, matching the existing `db.ts`/`schema.ts` convention. A sync service flushes the queue on reconnect/foreground. Two screens (Home, Session) consume this: Home resolves and shows today's day and starts/resumes a session; the Session screen logs sets against it.

**Tech Stack:** Expo Router, `expo-sqlite` (already a dependency), `@supabase/supabase-js`, new dependencies `@react-native-community/netinfo` (connectivity listener) and `expo-crypto` (client-side UUIDs for offline-created rows), `@react-native-async-storage/async-storage` (already a dependency, used here to remember the in-progress session across app restarts).

**Spec:** `docs/superpowers/specs/2026-09-13-fit-tracker-design.md` — §3 (client/offline architecture), §4 (local SQLite mirror), §7 (client logging flow), §9 (auth, already implemented), §10 (offline sync), §11.3 (offline queue tests).

**Explicitly out of scope (Plan 4 — "progression engine"):** §8's progression/deload/routine-switch computation. This plan prefills the logging weight from `user_exercise_state.current_weight` only — it does **not** compute `suggested_next_weight`, detect deloads, or suggest routine switches. Those are a separate, already-named future plan.

## Global Constraints

- Soft-delete-only (`is_deleted = true`, never hard `DELETE`) applies to `routines` / `routine_days` / `routine_exercises` (Plan 1/2 tables) — it does **not** apply to this plan's tables. `workout_sessions` and `routine_history` are append-only with no `is_deleted` column at all; `logged_sets` has an RLS delete policy already in place, but this plan does not add a delete-a-set UI feature (no spec requirement for it — YAGNI).
- Row Level Security scopes every table to `auth.uid()`; all tables this plan touches (`workout_sessions`, `logged_sets`, `user_exercise_state`, `routines` read-only) already have RLS policies from Plan 1 — no new migration is needed unless a task explicitly says otherwise.
- Expo Router `experiments.typedRoutes: true` requires `as any` casts on dynamic `router.push`/`router.replace` template-literal paths, using fully-qualified `/(app)/...` paths.
- UI copy is in Spanish, matching every existing screen.
- TDD for pure domain logic and for anything that talks to the real hosted Supabase project (via `tests/helpers/supabaseAdmin.ts`'s `createAdminClient()`), exactly like Plan 1/2. Code that calls `expo-sqlite` (`SQLite.openDatabaseSync`, `runSync`, `getAllSync`, etc.) **cannot run under Jest** — there is no native SQLite binding in the Node test environment. This is not a new gap: `tests/lib/sqlite/schema.test.ts` already only string-checks the `CREATE_TABLES_SQL` constant rather than executing it. Any task whose code calls `expo-sqlite` directly is verified manually on-device instead of with a Jest test — say so explicitly in that task's test step.
- No automated E2E/UI testing (spec §11.4) — Home and Session screens are verified manually.
- New dependencies are added with `npx expo install <package>` (not a hand-picked version in `package.json`), so Expo resolves the version compatible with this project's SDK.

---

## Task 1: Session domain types and pure logic (week/day resolution, prescribed sets)

**Files:**
- Create: `src/lib/sessions/types.ts`
- Create: `src/lib/sessions/weekResolution.ts`
- Create: `src/lib/sessions/prescribedSets.ts`
- Test: `tests/lib/sessions/weekResolution.test.ts`
- Test: `tests/lib/sessions/prescribedSets.test.ts`

**Interfaces:**
- Consumes: `Weekday` and `RoutineExerciseWithName` from `src/lib/routines/types.ts` (already exist).
- Produces (used by later tasks):
  - `SessionStatus = 'in_progress' | 'completed'`
  - `WorkoutSession { id: string; user_id: string; routine_day_id: string; session_date: string; week_number: number | null; status: SessionStatus }`
  - `SetType = 'top_set' | 'back_off' | 'working' | 'warmup'`
  - `LoggedSet { id: string; session_id: string; routine_exercise_id: string; set_index: number; set_type: SetType; weight: number; reps: number; rir: number | null; created_at: string }`
  - `computeWeekNumber(startedAt: string, today?: Date): number`
  - `weekdayFromDate(date: Date): Weekday`
  - `formatDateOnly(date: Date): string`
  - `resolveTodayDayId(weekdaySchedule: Record<string, unknown>, weekday: Weekday, weekNumber: number): string | null`
  - `PrescribedSet { setIndex: number; setType: SetType }`
  - `buildPrescribedSets(exercise: { scheme_type: 'normal' | 'top_set_backoff'; sets: number | null; backoff_sets: number | null }): PrescribedSet[]`
  - `formatTargetScheme(exercise: RoutineExerciseWithName): string`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/sessions/types.ts
export type SessionStatus = 'in_progress' | 'completed';

export interface WorkoutSession {
  id: string;
  user_id: string;
  routine_day_id: string;
  session_date: string;
  week_number: number | null;
  status: SessionStatus;
}

export type SetType = 'top_set' | 'back_off' | 'working' | 'warmup';

export interface LoggedSet {
  id: string;
  session_id: string;
  routine_exercise_id: string;
  set_index: number;
  set_type: SetType;
  weight: number;
  reps: number;
  rir: number | null;
  created_at: string;
}
```

- [ ] **Step 2: Write the failing tests for week/day resolution**

```typescript
// tests/lib/sessions/weekResolution.test.ts
import {
  computeWeekNumber,
  weekdayFromDate,
  formatDateOnly,
  resolveTodayDayId,
} from '../../../src/lib/sessions/weekResolution';

describe('computeWeekNumber', () => {
  it('is week 1 on the start day itself', () => {
    expect(computeWeekNumber('2026-01-01T12:00:00.000Z', new Date(2026, 0, 1, 12))).toBe(1);
  });

  it('is week 1 through day 6', () => {
    expect(computeWeekNumber('2026-01-01T12:00:00.000Z', new Date(2026, 0, 7, 12))).toBe(1);
  });

  it('is week 2 on day 7', () => {
    expect(computeWeekNumber('2026-01-01T12:00:00.000Z', new Date(2026, 0, 8, 12))).toBe(2);
  });

  it('is week 3 on day 14', () => {
    expect(computeWeekNumber('2026-01-01T12:00:00.000Z', new Date(2026, 0, 15, 12))).toBe(3);
  });

  it('clamps to week 1 if "today" is before the start date', () => {
    expect(computeWeekNumber('2026-01-15T12:00:00.000Z', new Date(2026, 0, 1, 12))).toBe(1);
  });
});

describe('weekdayFromDate', () => {
  it('maps a known Monday to "mon"', () => {
    // 2026-01-05 is a Monday
    expect(weekdayFromDate(new Date(2026, 0, 5))).toBe('mon');
  });

  it('maps a known Sunday to "sun"', () => {
    // 2026-01-04 is a Sunday
    expect(weekdayFromDate(new Date(2026, 0, 4))).toBe('sun');
  });
});

describe('formatDateOnly', () => {
  it('formats using local date parts, not UTC', () => {
    expect(formatDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('pads single-digit month and day', () => {
    expect(formatDateOnly(new Date(2026, 2, 4))).toBe('2026-03-04');
  });
});

describe('resolveTodayDayId', () => {
  it('returns the plain day id for a simple weekday mapping', () => {
    const schedule = { mon: 'day-a-uuid', tue: 'core-uuid' };
    expect(resolveTodayDayId(schedule, 'mon', 1)).toBe('day-a-uuid');
  });

  it('returns null when the weekday has no entry (rest day)', () => {
    const schedule = { mon: 'day-a-uuid' };
    expect(resolveTodayDayId(schedule, 'wed', 1)).toBeNull();
  });

  it('resolves the odd-week template on an odd week number', () => {
    const schedule = { fri: { even_week: 'day-a-uuid', odd_week: 'day-b-uuid' } };
    expect(resolveTodayDayId(schedule, 'fri', 1)).toBe('day-b-uuid');
    expect(resolveTodayDayId(schedule, 'fri', 3)).toBe('day-b-uuid');
  });

  it('resolves the even-week template on an even week number', () => {
    const schedule = { fri: { even_week: 'day-a-uuid', odd_week: 'day-b-uuid' } };
    expect(resolveTodayDayId(schedule, 'fri', 2)).toBe('day-a-uuid');
    expect(resolveTodayDayId(schedule, 'fri', 4)).toBe('day-a-uuid');
  });

  it('returns null for a malformed entry', () => {
    const schedule = { mon: 42 };
    expect(resolveTodayDayId(schedule, 'mon', 1)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest tests/lib/sessions/weekResolution.test.ts`
Expected: FAIL — `Cannot find module '../../../src/lib/sessions/weekResolution'`

- [ ] **Step 4: Implement week/day resolution**

```typescript
// src/lib/sessions/weekResolution.ts
import { Weekday } from '../routines/types';

function toLocalDayNumber(date: Date): number {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(local.getTime() / 86400000);
}

export function computeWeekNumber(startedAt: string, today: Date = new Date()): number {
  const daysSince = toLocalDayNumber(today) - toLocalDayNumber(new Date(startedAt));
  return Math.floor(Math.max(daysSince, 0) / 7) + 1;
}

const WEEKDAY_BY_JS_DAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function weekdayFromDate(date: Date): Weekday {
  return WEEKDAY_BY_JS_DAY[date.getDay()];
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveTodayDayId(
  weekdaySchedule: Record<string, unknown>,
  weekday: Weekday,
  weekNumber: number
): string | null {
  const entry = weekdaySchedule[weekday];
  if (typeof entry === 'string') return entry;
  if (
    entry !== null &&
    typeof entry === 'object' &&
    'even_week' in entry &&
    'odd_week' in entry
  ) {
    const alt = entry as { even_week: unknown; odd_week: unknown };
    const chosen = weekNumber % 2 === 0 ? alt.even_week : alt.odd_week;
    return typeof chosen === 'string' ? chosen : null;
  }
  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/lib/sessions/weekResolution.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 6: Write the failing tests for prescribed sets**

```typescript
// tests/lib/sessions/prescribedSets.test.ts
import { buildPrescribedSets, formatTargetScheme } from '../../../src/lib/sessions/prescribedSets';
import { RoutineExerciseWithName } from '../../../src/lib/routines/types';

function baseExercise(overrides: Partial<RoutineExerciseWithName>): RoutineExerciseWithName {
  return {
    id: 'ex-1',
    routine_day_id: 'day-1',
    exercise_id: 'catalog-1',
    exercise_name: 'Press banca',
    order_index: 0,
    role: 'main',
    scheme_type: 'normal',
    rep_unit: 'reps',
    sets: null,
    rep_min: null,
    rep_max: null,
    rir_min: null,
    rir_max: null,
    top_set_reps: null,
    backoff_sets: null,
    backoff_rep_min: null,
    backoff_rep_max: null,
    is_deleted: false,
    ...overrides,
  };
}

describe('buildPrescribedSets', () => {
  it('builds N working sets for a normal scheme', () => {
    const exercise = baseExercise({ scheme_type: 'normal', sets: 3 });
    expect(buildPrescribedSets(exercise)).toEqual([
      { setIndex: 1, setType: 'working' },
      { setIndex: 2, setType: 'working' },
      { setIndex: 3, setType: 'working' },
    ]);
  });

  it('returns an empty array when sets is null for a normal scheme', () => {
    const exercise = baseExercise({ scheme_type: 'normal', sets: null });
    expect(buildPrescribedSets(exercise)).toEqual([]);
  });

  it('builds a top set followed by N back-off sets', () => {
    const exercise = baseExercise({ scheme_type: 'top_set_backoff', backoff_sets: 2 });
    expect(buildPrescribedSets(exercise)).toEqual([
      { setIndex: 1, setType: 'top_set' },
      { setIndex: 2, setType: 'back_off' },
      { setIndex: 3, setType: 'back_off' },
    ]);
  });

  it('builds just the top set when backoff_sets is null', () => {
    const exercise = baseExercise({ scheme_type: 'top_set_backoff', backoff_sets: null });
    expect(buildPrescribedSets(exercise)).toEqual([{ setIndex: 1, setType: 'top_set' }]);
  });
});

describe('formatTargetScheme', () => {
  it('formats a normal reps scheme with RIR', () => {
    const exercise = baseExercise({
      scheme_type: 'normal',
      sets: 3,
      rep_min: 8,
      rep_max: 10,
      rir_min: 2,
      rir_max: 3,
    });
    expect(formatTargetScheme(exercise)).toBe('3×8-10 @ RIR 2-3');
  });

  it('formats a normal seconds scheme without RIR (core)', () => {
    const exercise = baseExercise({
      scheme_type: 'normal',
      rep_unit: 'seconds',
      sets: 3,
      rep_min: 30,
      rep_max: 40,
      rir_min: null,
      rir_max: null,
    });
    expect(formatTargetScheme(exercise)).toBe('3×30-40s');
  });

  it('formats a top-set/back-off scheme', () => {
    const exercise = baseExercise({
      scheme_type: 'top_set_backoff',
      top_set_reps: 5,
      backoff_sets: 2,
      backoff_rep_min: 8,
      backoff_rep_max: 10,
      rir_min: 1,
      rir_max: 2,
    });
    expect(formatTargetScheme(exercise)).toBe('Top set 1×5 + Back-off 2×8-10 @ RIR 1-2');
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx jest tests/lib/sessions/prescribedSets.test.ts`
Expected: FAIL — `Cannot find module '../../../src/lib/sessions/prescribedSets'`

- [ ] **Step 8: Implement prescribed-set logic**

```typescript
// src/lib/sessions/prescribedSets.ts
import { RoutineExerciseWithName } from '../routines/types';
import { SetType } from './types';

export interface PrescribedSet {
  setIndex: number;
  setType: SetType;
}

export function buildPrescribedSets(exercise: {
  scheme_type: 'normal' | 'top_set_backoff';
  sets: number | null;
  backoff_sets: number | null;
}): PrescribedSet[] {
  if (exercise.scheme_type === 'top_set_backoff') {
    const backoffCount = exercise.backoff_sets ?? 0;
    const result: PrescribedSet[] = [{ setIndex: 1, setType: 'top_set' }];
    for (let i = 0; i < backoffCount; i++) {
      result.push({ setIndex: i + 2, setType: 'back_off' });
    }
    return result;
  }
  const setCount = exercise.sets ?? 0;
  const result: PrescribedSet[] = [];
  for (let i = 0; i < setCount; i++) {
    result.push({ setIndex: i + 1, setType: 'working' });
  }
  return result;
}

export function formatTargetScheme(exercise: RoutineExerciseWithName): string {
  const unit = exercise.rep_unit === 'seconds' ? 's' : '';
  const rir =
    exercise.rir_min !== null && exercise.rir_max !== null
      ? ` @ RIR ${exercise.rir_min}-${exercise.rir_max}`
      : '';
  if (exercise.scheme_type === 'top_set_backoff') {
    return `Top set 1×${exercise.top_set_reps} + Back-off ${exercise.backoff_sets}×${exercise.backoff_rep_min}-${exercise.backoff_rep_max}${unit}${rir}`;
  }
  return `${exercise.sets}×${exercise.rep_min}-${exercise.rep_max}${unit}${rir}`;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx jest tests/lib/sessions/prescribedSets.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 10: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors

```bash
git add src/lib/sessions/types.ts src/lib/sessions/weekResolution.ts src/lib/sessions/prescribedSets.ts tests/lib/sessions/weekResolution.test.ts tests/lib/sessions/prescribedSets.test.ts
git commit -m "feat: add pure session domain logic (day resolution, prescribed sets)"
```

---

## Task 2: Session/set Supabase queries

**Files:**
- Create: `src/lib/sessions/queries.ts`
- Create: `tests/helpers/seedActiveRoutine.ts`
- Test: `tests/lib/sessions/queries.test.ts`

**Interfaces:**
- Consumes: `WorkoutSession`, `LoggedSet` from `src/lib/sessions/types.ts` (Task 1); `Routine` from `src/lib/routines/types.ts`; `seedTestRoutine` from `tests/helpers/seedTestRoutine.ts`; `activateRoutine` from `src/lib/routines/mutations.ts`; `createAdminClient` from `tests/helpers/supabaseAdmin.ts`.
- Produces (used by later tasks):
  - `getActiveRoutine(supabase: SupabaseClient, userId: string): Promise<Routine | null>`
  - `getSessionForDate(supabase: SupabaseClient, userId: string, dayId: string, sessionDate: string): Promise<WorkoutSession | null>`
  - `listSessionSets(supabase: SupabaseClient, sessionId: string): Promise<LoggedSet[]>`
  - `seedActiveRoutine(supabase: SupabaseClient, userId: string): Promise<{ exercise: Exercise; routine: Routine; day: RoutineDay; routineExercise: RoutineExercise }>` (test helper — same shape as `seedTestRoutine`, but the returned routine is active with `started_at` set)

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/sessions/queries.test.ts
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedActiveRoutine } from '../../helpers/seedActiveRoutine';
import { getActiveRoutine, getSessionForDate, listSessionSets } from '../../../src/lib/sessions/queries';

const supabase = createAdminClient();
const testEmail = `session-queries-${Date.now()}@example.com`;
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

describe('getActiveRoutine', () => {
  it('returns the user\'s active routine', async () => {
    const { routine } = await seedActiveRoutine(supabase, userId);
    const active = await getActiveRoutine(supabase, userId);
    expect(active?.id).toBe(routine.id);
    expect(active?.is_active).toBe(true);
  });

  it('returns null when the user has no active routine', async () => {
    const { data, error } = await supabase.auth.admin.createUser({
      email: `no-active-routine-${Date.now()}@example.com`,
      password: 'testpassword123',
      email_confirm: true,
    });
    if (error) throw error;
    try {
      const active = await getActiveRoutine(supabase, data.user.id);
      expect(active).toBeNull();
    } finally {
      await supabase.auth.admin.deleteUser(data.user.id);
    }
  });
});

describe('getSessionForDate / listSessionSets', () => {
  it('returns null when no session exists for that day/date yet', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);
    const session = await getSessionForDate(supabase, userId, day.id, '2026-01-01');
    expect(session).toBeNull();
  });

  it('finds an existing session for the day/date and lists its sets', async () => {
    const { day, routineExercise } = await seedActiveRoutine(supabase, userId);

    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: userId,
        routine_day_id: day.id,
        session_date: '2026-02-02',
        week_number: 1,
        status: 'in_progress',
      })
      .select()
      .single();
    if (sessionError) throw sessionError;

    const { error: setError } = await supabase.from('logged_sets').insert({
      session_id: session.id,
      routine_exercise_id: routineExercise.id,
      set_index: 1,
      set_type: 'working',
      weight: 60,
      reps: 8,
      rir: 2,
    });
    if (setError) throw setError;

    const found = await getSessionForDate(supabase, userId, day.id, '2026-02-02');
    expect(found?.id).toBe(session.id);

    const sets = await listSessionSets(supabase, session.id);
    expect(sets).toHaveLength(1);
    expect(sets[0].weight).toBe(60);
    expect(sets[0].reps).toBe(8);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/sessions/queries.test.ts`
Expected: FAIL — `Cannot find module '../../../src/lib/sessions/queries'` and `'../../helpers/seedActiveRoutine'`

- [ ] **Step 3: Create the `seedActiveRoutine` test helper**

```typescript
// tests/helpers/seedActiveRoutine.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { seedTestRoutine } from './seedTestRoutine';
import { activateRoutine } from '../../src/lib/routines/mutations';

export async function seedActiveRoutine(supabase: SupabaseClient, userId: string) {
  const seeded = await seedTestRoutine(supabase, userId);
  await activateRoutine(supabase, userId, seeded.routine.id);
  const { data: routine, error } = await supabase
    .from('routines')
    .select('*')
    .eq('id', seeded.routine.id)
    .single();
  if (error) throw error;
  return { ...seeded, routine };
}
```

- [ ] **Step 4: Implement the queries**

```typescript
// src/lib/sessions/queries.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { Routine } from '../routines/types';
import { WorkoutSession, LoggedSet } from './types';

export async function getActiveRoutine(supabase: SupabaseClient, userId: string): Promise<Routine | null> {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getSessionForDate(
  supabase: SupabaseClient,
  userId: string,
  dayId: string,
  sessionDate: string
): Promise<WorkoutSession | null> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('routine_day_id', dayId)
    .eq('session_date', sessionDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listSessionSets(supabase: SupabaseClient, sessionId: string): Promise<LoggedSet[]> {
  const { data, error } = await supabase
    .from('logged_sets')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at');
  if (error) throw error;
  return data;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/lib/sessions/queries.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Type-check, run the full suite, and commit**

Run: `npx tsc --noEmit && npx jest`
Expected: no type errors; all suites pass

```bash
git add src/lib/sessions/queries.ts tests/helpers/seedActiveRoutine.ts tests/lib/sessions/queries.test.ts
git commit -m "feat: add session/set Supabase queries"
```

---

## Task 3: AsyncStorage current-session pointer

**Files:**
- Create: `src/lib/sessions/currentSessionStorage.ts`
- Test: `tests/lib/sessions/currentSessionStorage.test.ts`

**Interfaces:**
- Consumes: `@react-native-async-storage/async-storage` (already a dependency).
- Produces (used by Task 6 and Task 7): `CurrentSessionPointer { sessionId: string; dayId: string; sessionDate: string; weekNumber: number }`, `saveCurrentSession(pointer: CurrentSessionPointer): Promise<void>`, `loadCurrentSession(): Promise<CurrentSessionPointer | null>`, `clearCurrentSession(): Promise<void>`

This module exists to survive an app restart while offline: without it, relaunching the app mid-workout with no connectivity would have no way to know a session is already in progress, and could create a duplicate `workout_sessions` row for the same day once it eventually syncs. It stores only the pointer (ids/date/week), not the logged sets themselves — resuming the *set list* still depends on reading Supabase when online (Task 2's `listSessionSets`); if the app is killed while fully offline mid-session, sets logged before the kill won't visually reappear as checked off until connectivity returns and the cache/session data is refetched, but re-logging them offline is harmless (sets are append-only, no dedup) and can be manually cleaned up later. This is a documented simplification, not a bug.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/sessions/currentSessionStorage.test.ts
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import {
  saveCurrentSession,
  loadCurrentSession,
  clearCurrentSession,
} from '../../../src/lib/sessions/currentSessionStorage';

describe('current session storage', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await loadCurrentSession()).toBeNull();
  });

  it('round-trips a saved pointer', async () => {
    const pointer = { sessionId: 'session-1', dayId: 'day-1', sessionDate: '2026-01-05', weekNumber: 2 };
    await saveCurrentSession(pointer);
    expect(await loadCurrentSession()).toEqual(pointer);
  });

  it('overwrites a previously saved pointer', async () => {
    await saveCurrentSession({ sessionId: 'a', dayId: 'd1', sessionDate: '2026-01-05', weekNumber: 1 });
    await saveCurrentSession({ sessionId: 'b', dayId: 'd2', sessionDate: '2026-01-06', weekNumber: 1 });
    expect(await loadCurrentSession()).toEqual({
      sessionId: 'b',
      dayId: 'd2',
      sessionDate: '2026-01-06',
      weekNumber: 1,
    });
  });

  it('clears the pointer', async () => {
    await saveCurrentSession({ sessionId: 'a', dayId: 'd1', sessionDate: '2026-01-05', weekNumber: 1 });
    await clearCurrentSession();
    expect(await loadCurrentSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/lib/sessions/currentSessionStorage.test.ts`
Expected: FAIL — `Cannot find module '../../../src/lib/sessions/currentSessionStorage'`

- [ ] **Step 3: Implement the module**

```typescript
// src/lib/sessions/currentSessionStorage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fit-tracker:current-session';

export interface CurrentSessionPointer {
  sessionId: string;
  dayId: string;
  sessionDate: string;
  weekNumber: number;
}

export async function saveCurrentSession(pointer: CurrentSessionPointer): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(pointer));
}

export async function loadCurrentSession(): Promise<CurrentSessionPointer | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearCurrentSession(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/lib/sessions/currentSessionStorage.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/sessions/currentSessionStorage.ts tests/lib/sessions/currentSessionStorage.test.ts
git commit -m "feat: persist the in-progress session pointer across app restarts"
```

---

## Task 4: Offline write queue — pure flush logic

**Files:**
- Create: `src/lib/sync/flushQueue.ts`
- Test: `tests/lib/sync/flushQueue.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (deliberately decoupled from `expo-sqlite` so it's unit-testable — see Global Constraints).
- Produces (used by Task 5): `PendingWrite { id: string; entity: 'workout_sessions' | 'logged_sets'; payload: Record<string, unknown> }`, `FlushResult { succeededIds: string[]; failedIds: string[] }`, `flushPendingWrites(supabase: SupabaseClient, writes: PendingWrite[]): Promise<FlushResult>`

Every write (a new session, a completed session, a logged set) is applied as a Postgres `upsert` keyed by the row's own `id` — including completing a session, which re-upserts the same `workout_sessions` row with `status: 'completed'`. This keeps one code path for "create" and "update" and makes retries safe: re-applying an already-synced write is a no-op change, not a duplicate row (spec §10: "no merge logic beyond retry until it lands").

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/sync/flushQueue.test.ts
import { flushPendingWrites, PendingWrite } from '../../../src/lib/sync/flushQueue';

function fakeSupabase(behavior: (table: string, payload: Record<string, unknown>) => { error: unknown } ) {
  const calls: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>) {
          calls.push({ table, payload });
          return Promise.resolve(behavior(table, payload));
        },
      };
    },
  };
  return { client, calls };
}

describe('flushPendingWrites', () => {
  it('returns empty results for an empty queue', async () => {
    const { client } = fakeSupabase(() => ({ error: null }));
    const result = await flushPendingWrites(client as any, []);
    expect(result).toEqual({ succeededIds: [], failedIds: [] });
  });

  it('upserts every write in order and reports all as succeeded', async () => {
    const { client, calls } = fakeSupabase(() => ({ error: null }));
    const writes: PendingWrite[] = [
      { id: 'w1', entity: 'workout_sessions', payload: { id: 'w1', status: 'in_progress' } },
      { id: 'w2', entity: 'logged_sets', payload: { id: 'w2', weight: 60 } },
    ];
    const result = await flushPendingWrites(client as any, writes);
    expect(result).toEqual({ succeededIds: ['w1', 'w2'], failedIds: [] });
    expect(calls.map((c) => c.table)).toEqual(['workout_sessions', 'logged_sets']);
    expect(calls[0].payload).toEqual({ id: 'w1', status: 'in_progress' });
  });

  it('keeps a failed write out of succeededIds but still attempts the rest', async () => {
    const { client } = fakeSupabase((table) => ({ error: table === 'workout_sessions' ? { message: 'network' } : null }));
    const writes: PendingWrite[] = [
      { id: 'w1', entity: 'workout_sessions', payload: { id: 'w1' } },
      { id: 'w2', entity: 'logged_sets', payload: { id: 'w2' } },
    ];
    const result = await flushPendingWrites(client as any, writes);
    expect(result.failedIds).toEqual(['w1']);
    expect(result.succeededIds).toEqual(['w2']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/sync/flushQueue.test.ts`
Expected: FAIL — `Cannot find module '../../../src/lib/sync/flushQueue'`

- [ ] **Step 3: Implement the flush logic**

```typescript
// src/lib/sync/flushQueue.ts
import { SupabaseClient } from '@supabase/supabase-js';

export interface PendingWrite {
  id: string;
  entity: 'workout_sessions' | 'logged_sets';
  payload: Record<string, unknown>;
}

export interface FlushResult {
  succeededIds: string[];
  failedIds: string[];
}

export async function flushPendingWrites(supabase: SupabaseClient, writes: PendingWrite[]): Promise<FlushResult> {
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  for (const write of writes) {
    const { error } = await supabase.from(write.entity).upsert(write.payload);
    if (error) {
      failedIds.push(write.id);
    } else {
      succeededIds.push(write.id);
    }
  }
  return { succeededIds, failedIds };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/sync/flushQueue.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/sync/flushQueue.ts tests/lib/sync/flushQueue.test.ts
git commit -m "feat: add pure offline-queue flush logic"
```

---

## Task 5: SQLite pending-writes queue, local cache, and sync orchestrator

**Files:**
- Create: `src/lib/sqlite/pendingWrites.ts`
- Create: `src/lib/sqlite/cache.ts`
- Create: `src/lib/sync/syncService.ts`
- Modify: `package.json` (new dependencies, added via `expo install`)

**Interfaces:**
- Consumes: `SQLiteDatabase` from `expo-sqlite` (already a dependency, see `src/lib/sqlite/db.ts` for `getDatabase()`); `pending_writes` / `routines_cache` / `routine_days_cache` / `routine_exercises_cache` / `user_exercise_state_cache` tables from `src/lib/sqlite/schema.ts` (already exist, unchanged by this task); `getActiveRoutine` from `src/lib/sessions/queries.ts` (Task 2); `PendingWrite`, `flushPendingWrites` from `src/lib/sync/flushQueue.ts` (Task 4); `listRoutineDays`, `listDayExercises` from `src/lib/routines/queries.ts` (already exist); `computeWeekNumber`, `weekdayFromDate`, `resolveTodayDayId` from `src/lib/sessions/weekResolution.ts` (Task 1).
- Produces (used by Task 6 and Task 7):
  - `enqueueWrite(db: SQLiteDatabase, id: string, entity: 'workout_sessions' | 'logged_sets', payload: Record<string, unknown>): void`
  - `removePendingWrite(db: SQLiteDatabase, id: string): void`
  - `incrementAttempts(db: SQLiteDatabase, id: string): void`
  - `listPendingWrites(db: SQLiteDatabase): PendingWrite[]`
  - `CachedRoutine { id: string; name: string; uses_top_set_backoff: boolean; suggested_duration_weeks: number | null; next_routine_id: string | null; weekday_schedule: Record<string, unknown>; is_active: boolean; started_at: string | null }`
  - `CachedRoutineDay { id: string; routine_id: string; name: string; order_index: number; is_rest_day: boolean }`
  - `CachedRoutineExercise` — same shape as `RoutineExerciseWithName` from `src/lib/routines/types.ts`
  - `CachedUserExerciseState { exercise_id: string; current_weight: number | null; suggested_next_weight: number | null }`
  - `refreshLocalCache(db: SQLiteDatabase, supabase: SupabaseClient, userId: string): Promise<void>`
  - `getCachedActiveRoutine(db: SQLiteDatabase): CachedRoutine | null`
  - `getCachedRoutineDays(db: SQLiteDatabase, routineId: string): CachedRoutineDay[]`
  - `getCachedDayExercises(db: SQLiteDatabase, dayId: string): CachedRoutineExercise[]`
  - `getCachedExerciseState(db: SQLiteDatabase, exerciseId: string): CachedUserExerciseState | null`
  - `ResolvedToday { routine: CachedRoutine; weekNumber: number; day: CachedRoutineDay | null }`
  - `resolveToday(db: SQLiteDatabase, today?: Date): ResolvedToday | null` — combines the cached active routine with Task 1's pure week/day resolution so Task 6 and Task 7 share one implementation instead of each re-deriving "today's day" themselves; returns `null` only when there's no active routine cached (a resolved routine with no trainable day today still returns `{ routine, weekNumber, day: null }`)
  - `syncNow(db: SQLiteDatabase, supabase: SupabaseClient, userId: string): Promise<void>`
  - `startSyncListener(db: SQLiteDatabase, supabase: SupabaseClient, userId: string): () => void`

**This task's `pendingWrites.ts`, `cache.ts`, and `syncService.ts` all call `expo-sqlite` directly and cannot run under Jest (see Global Constraints). There is no test step for them — they're verified manually in Task 8's end-to-end check.**

- [ ] **Step 1: Add the new dependencies**

Run: `npx expo install @react-native-community/netinfo expo-crypto`
Expected: `package.json` gains `@react-native-community/netinfo` and `expo-crypto` at the versions Expo resolves for this SDK.

- [ ] **Step 2: Implement the pending-writes SQLite wrapper**

```typescript
// src/lib/sqlite/pendingWrites.ts
import { SQLiteDatabase } from 'expo-sqlite';
import { PendingWrite } from '../sync/flushQueue';

export function enqueueWrite(
  db: SQLiteDatabase,
  id: string,
  entity: 'workout_sessions' | 'logged_sets',
  payload: Record<string, unknown>
): void {
  db.runSync(
    'insert into pending_writes (id, entity, payload_json, created_at, attempts) values (?, ?, ?, ?, 0)',
    [id, entity, JSON.stringify(payload), new Date().toISOString()]
  );
}

export function removePendingWrite(db: SQLiteDatabase, id: string): void {
  db.runSync('delete from pending_writes where id = ?', [id]);
}

export function incrementAttempts(db: SQLiteDatabase, id: string): void {
  db.runSync('update pending_writes set attempts = attempts + 1 where id = ?', [id]);
}

interface PendingWriteRow {
  id: string;
  entity: string;
  payload_json: string;
  created_at: string;
  attempts: number;
}

export function listPendingWrites(db: SQLiteDatabase): PendingWrite[] {
  const rows = db.getAllSync<PendingWriteRow>('select * from pending_writes order by created_at asc');
  return rows.map((row) => ({
    id: row.id,
    entity: row.entity as 'workout_sessions' | 'logged_sets',
    payload: JSON.parse(row.payload_json),
  }));
}
```

- [ ] **Step 3: Implement the local cache module**

```typescript
// src/lib/sqlite/cache.ts
import { SQLiteDatabase } from 'expo-sqlite';
import { SupabaseClient } from '@supabase/supabase-js';
import { getActiveRoutine } from '../sessions/queries';
import { listRoutineDays, listDayExercises } from '../routines/queries';
import { RoutineExerciseWithName } from '../routines/types';
import { computeWeekNumber, weekdayFromDate, resolveTodayDayId } from '../sessions/weekResolution';

export interface CachedRoutine {
  id: string;
  name: string;
  uses_top_set_backoff: boolean;
  suggested_duration_weeks: number | null;
  next_routine_id: string | null;
  weekday_schedule: Record<string, unknown>;
  is_active: boolean;
  started_at: string | null;
}

export interface CachedRoutineDay {
  id: string;
  routine_id: string;
  name: string;
  order_index: number;
  is_rest_day: boolean;
}

export type CachedRoutineExercise = RoutineExerciseWithName;

export interface CachedUserExerciseState {
  exercise_id: string;
  current_weight: number | null;
  suggested_next_weight: number | null;
}

export async function refreshLocalCache(
  db: SQLiteDatabase,
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const routine = await getActiveRoutine(supabase, userId);
  const days = routine ? await listRoutineDays(supabase, routine.id) : [];
  const exercisesByDay = await Promise.all(days.map((day) => listDayExercises(supabase, day.id)));
  const { data: states, error: statesError } = await supabase
    .from('user_exercise_state')
    .select('exercise_id, current_weight, suggested_next_weight')
    .eq('user_id', userId);
  if (statesError) throw statesError;

  db.withTransactionSync(() => {
    db.runSync('delete from routines_cache');
    db.runSync('delete from routine_days_cache');
    db.runSync('delete from routine_exercises_cache');
    db.runSync('delete from user_exercise_state_cache');

    if (!routine) return;

    db.runSync(
      `insert into routines_cache
         (id, name, uses_top_set_backoff, suggested_duration_weeks, next_routine_id, weekday_schedule, is_active, started_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        routine.id,
        routine.name,
        routine.uses_top_set_backoff ? 1 : 0,
        routine.suggested_duration_weeks,
        routine.next_routine_id,
        JSON.stringify(routine.weekday_schedule),
        routine.is_active ? 1 : 0,
        routine.started_at,
      ]
    );

    days.forEach((day) => {
      db.runSync(
        'insert into routine_days_cache (id, routine_id, name, order_index, is_rest_day) values (?, ?, ?, ?, ?)',
        [day.id, day.routine_id, day.name, day.order_index, day.is_rest_day ? 1 : 0]
      );
    });

    exercisesByDay.flat().forEach((exercise) => {
      db.runSync(
        `insert into routine_exercises_cache
           (id, routine_day_id, exercise_id, exercise_name, order_index, role, scheme_type, rep_unit,
            sets, rep_min, rep_max, rir_min, rir_max, top_set_reps, backoff_sets, backoff_rep_min, backoff_rep_max)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ]
      );
    });

    (states ?? []).forEach((state) => {
      db.runSync(
        'insert into user_exercise_state_cache (exercise_id, current_weight, suggested_next_weight) values (?, ?, ?)',
        [state.exercise_id, state.current_weight, state.suggested_next_weight]
      );
    });
  });
}

export function getCachedActiveRoutine(db: SQLiteDatabase): CachedRoutine | null {
  const row = db.getAllSync<{
    id: string;
    name: string;
    uses_top_set_backoff: number;
    suggested_duration_weeks: number | null;
    next_routine_id: string | null;
    weekday_schedule: string;
    is_active: number;
    started_at: string | null;
  }>('select * from routines_cache limit 1')[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    uses_top_set_backoff: row.uses_top_set_backoff === 1,
    suggested_duration_weeks: row.suggested_duration_weeks,
    next_routine_id: row.next_routine_id,
    weekday_schedule: JSON.parse(row.weekday_schedule),
    is_active: row.is_active === 1,
    started_at: row.started_at,
  };
}

export function getCachedRoutineDays(db: SQLiteDatabase, routineId: string): CachedRoutineDay[] {
  const rows = db.getAllSync<{
    id: string;
    routine_id: string;
    name: string;
    order_index: number;
    is_rest_day: number;
  }>('select * from routine_days_cache where routine_id = ? order by order_index', [routineId]);
  return rows.map((row) => ({ ...row, is_rest_day: row.is_rest_day === 1 }));
}

export function getCachedDayExercises(db: SQLiteDatabase, dayId: string): CachedRoutineExercise[] {
  return db.getAllSync<CachedRoutineExercise>(
    'select * from routine_exercises_cache where routine_day_id = ? order by order_index',
    [dayId]
  );
}

export function getCachedExerciseState(db: SQLiteDatabase, exerciseId: string): CachedUserExerciseState | null {
  const rows = db.getAllSync<CachedUserExerciseState>(
    'select * from user_exercise_state_cache where exercise_id = ?',
    [exerciseId]
  );
  return rows[0] ?? null;
}

export interface ResolvedToday {
  routine: CachedRoutine;
  weekNumber: number;
  day: CachedRoutineDay | null;
}

export function resolveToday(db: SQLiteDatabase, today: Date = new Date()): ResolvedToday | null {
  const routine = getCachedActiveRoutine(db);
  if (!routine || !routine.started_at) return null;

  const weekNumber = computeWeekNumber(routine.started_at, today);
  const dayId = resolveTodayDayId(routine.weekday_schedule, weekdayFromDate(today), weekNumber);
  if (!dayId) return { routine, weekNumber, day: null };

  const days = getCachedRoutineDays(db, routine.id);
  const day = days.find((d) => d.id === dayId) ?? null;
  return { routine, weekNumber, day };
}
```

- [ ] **Step 4: Implement the sync orchestrator**

```typescript
// src/lib/sync/syncService.ts
import { SQLiteDatabase } from 'expo-sqlite';
import { SupabaseClient } from '@supabase/supabase-js';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { listPendingWrites, removePendingWrite, incrementAttempts } from '../sqlite/pendingWrites';
import { refreshLocalCache } from '../sqlite/cache';
import { flushPendingWrites } from './flushQueue';

export async function syncNow(db: SQLiteDatabase, supabase: SupabaseClient, userId: string): Promise<void> {
  const writes = listPendingWrites(db);
  if (writes.length > 0) {
    const { succeededIds, failedIds } = await flushPendingWrites(supabase, writes);
    succeededIds.forEach((id) => removePendingWrite(db, id));
    failedIds.forEach((id) => incrementAttempts(db, id));
  }
  await refreshLocalCache(db, supabase, userId);
}

export function startSyncListener(db: SQLiteDatabase, supabase: SupabaseClient, userId: string): () => void {
  const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      syncNow(db, supabase, userId).catch(() => {});
    }
  });

  const appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      syncNow(db, supabase, userId).catch(() => {});
    }
  });

  return () => {
    unsubscribeNetInfo();
    appStateSubscription.remove();
  };
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Run the full Jest suite to confirm no regressions**

Run: `npx jest`
Expected: all existing suites still pass (this task adds no new Jest tests, per the Global Constraints note above)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/sqlite/pendingWrites.ts src/lib/sqlite/cache.ts src/lib/sync/syncService.ts
git commit -m "feat: add local cache refresh and offline sync orchestrator"
```

---

## Task 6: Home screen — active routine, today's day, start/resume/complete

**Files:**
- Create: `src/hooks/useHomeData.ts`
- Modify: `app/(app)/index.tsx`

**Interfaces:**
- Consumes: `resolveToday` from `src/lib/sqlite/cache.ts` (Task 5); `formatDateOnly` from `src/lib/sessions/weekResolution.ts` (Task 1); `getSessionForDate` from `src/lib/sessions/queries.ts` (Task 2); `saveCurrentSession`, `loadCurrentSession` from `src/lib/sessions/currentSessionStorage.ts` (Task 3); `enqueueWrite` from `src/lib/sqlite/pendingWrites.ts` (Task 5); `syncNow` from `src/lib/sync/syncService.ts` (Task 5); `getDatabase` from `src/lib/sqlite/db.ts` (already exists); `randomUUID` from `expo-crypto`; `supabase` from `src/lib/supabase.ts`; `useAuthSession` from `src/hooks/useAuthSession.ts`.
- Produces (used by Task 8's manual walkthrough and by the Session screen's navigation): `useHomeData()` returns `{ loading: boolean; error: string | null; routineName: string | null; weekNumber: number | null; todayDayName: string | null; todayIsRestDay: boolean; sessionStatus: 'none' | 'in_progress' | 'completed'; startOrResumeSession: () => Promise<string | null> }` where `startOrResumeSession` returns the session id to navigate to, or `null` if there's no trainable day today.

- [ ] **Step 1: Implement the Home data hook**

```typescript
// src/hooks/useHomeData.ts
import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { useAuthSession } from './useAuthSession';
import { getDatabase } from '../lib/sqlite/db';
import { resolveToday } from '../lib/sqlite/cache';
import { formatDateOnly } from '../lib/sessions/weekResolution';
import { getSessionForDate } from '../lib/sessions/queries';
import { saveCurrentSession, loadCurrentSession } from '../lib/sessions/currentSessionStorage';
import { enqueueWrite } from '../lib/sqlite/pendingWrites';
import { syncNow } from '../lib/sync/syncService';

type SessionStatus = 'none' | 'in_progress' | 'completed';

export function useHomeData() {
  const { session } = useAuthSession();
  const userId = session?.user.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [routineName, setRoutineName] = useState<string | null>(null);
  const [weekNumber, setWeekNumber] = useState<number | null>(null);
  const [todayDayId, setTodayDayId] = useState<string | null>(null);
  const [todayDayName, setTodayDayName] = useState<string | null>(null);
  const [todayIsRestDay, setTodayIsRestDay] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('none');

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      await syncNow(getDatabase(), supabase, userId).catch(() => {
        // offline is expected; fall through to whatever the cache already has
      });

      const resolved = resolveToday(getDatabase());
      if (!resolved) {
        setRoutineName(null);
        setWeekNumber(null);
        setTodayDayId(null);
        setTodayDayName(null);
        setTodayIsRestDay(false);
        setSessionStatus('none');
        return;
      }
      setRoutineName(resolved.routine.name);
      setWeekNumber(resolved.weekNumber);

      const day = resolved.day;
      if (!day) {
        setTodayDayId(null);
        setTodayDayName(null);
        setTodayIsRestDay(false);
        setSessionStatus('none');
        return;
      }

      setTodayDayId(day.id);
      setTodayDayName(day.name);
      setTodayIsRestDay(day.is_rest_day);

      if (!day.is_rest_day) {
        const today = new Date();
        const existing = await getSessionForDate(supabase, userId, day.id, formatDateOnly(today)).catch(() => null);
        setSessionStatus(existing ? (existing.status === 'completed' ? 'completed' : 'in_progress') : 'none');
      } else {
        setSessionStatus('none');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el inicio.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const startOrResumeSession = useCallback(async (): Promise<string | null> => {
    if (!userId || !todayDayId) return null;

    const pointer = await loadCurrentSession();
    if (pointer && pointer.dayId === todayDayId && pointer.sessionDate === formatDateOnly(new Date())) {
      return pointer.sessionId;
    }

    const today = new Date();
    const sessionDate = formatDateOnly(today);
    const week = weekNumber ?? 1;

    const existing = await getSessionForDate(supabase, userId, todayDayId, sessionDate).catch(() => null);
    if (existing) {
      await saveCurrentSession({ sessionId: existing.id, dayId: todayDayId, sessionDate, weekNumber: week });
      return existing.id;
    }

    const sessionId = Crypto.randomUUID();
    const payload = {
      id: sessionId,
      user_id: userId,
      routine_day_id: todayDayId,
      session_date: sessionDate,
      week_number: week,
      status: 'in_progress' as const,
    };
    enqueueWrite(getDatabase(), sessionId, 'workout_sessions', payload);
    await saveCurrentSession({ sessionId, dayId: todayDayId, sessionDate, weekNumber: week });
    syncNow(getDatabase(), supabase, userId).catch(() => {});
    return sessionId;
  }, [userId, todayDayId, weekNumber]);

  return {
    loading,
    error,
    routineName,
    weekNumber,
    todayDayName,
    todayIsRestDay,
    sessionStatus,
    startOrResumeSession,
  };
}
```

- [ ] **Step 2: Rewrite the Home screen**

```tsx
// app/(app)/index.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuthSession } from '../../src/hooks/useAuthSession';
import { useHomeData } from '../../src/hooks/useHomeData';

export default function Home() {
  const { session } = useAuthSession();
  const {
    loading,
    error,
    routineName,
    weekNumber,
    todayDayName,
    todayIsRestDay,
    sessionStatus,
    startOrResumeSession,
  } = useHomeData();

  async function handleStart() {
    const sessionId = await startOrResumeSession();
    if (sessionId) {
      router.push(`/(app)/session/${sessionId}` as any);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fit Tracker</Text>
      <Text>Sesión iniciada como {session?.user.email}</Text>

      {loading && <Text>Cargando...</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && !error && (
        <View style={styles.card}>
          {routineName ? (
            <>
              <Text style={styles.routineName}>{routineName}</Text>
              <Text style={styles.weekLabel}>Semana {weekNumber}</Text>
              {todayDayName ? (
                todayIsRestDay ? (
                  <Text>Hoy: {todayDayName} (descanso)</Text>
                ) : (
                  <>
                    <Text>Hoy: {todayDayName}</Text>
                    {sessionStatus === 'completed' ? (
                      <Text style={styles.doneLabel}>✓ Entrenamiento completado hoy</Text>
                    ) : (
                      <Pressable style={styles.button} onPress={handleStart}>
                        <Text style={styles.buttonText}>
                          {sessionStatus === 'in_progress' ? 'Continuar entrenamiento' : 'Empezar entrenamiento'}
                        </Text>
                      </Pressable>
                    )}
                  </>
                )
              ) : (
                <Text>No hay entrenamiento programado para hoy.</Text>
              )}
            </>
          ) : (
            <Text>No tenés una rutina activa. Activá una desde "Ver rutinas".</Text>
          )}
        </View>
      )}

      <Pressable style={styles.button} onPress={() => router.push('/(app)/routines' as any)}>
        <Text style={styles.buttonText}>Ver rutinas</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.buttonText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  card: { width: '100%', gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 16 },
  routineName: { fontSize: 20, fontWeight: '700' },
  weekLabel: { color: '#666' },
  doneLabel: { color: '#16a34a', fontWeight: '600' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification (this screen calls `expo-sqlite` — no Jest test)**

Run the app on a device/simulator with a user that has an active routine (from Plan 1/2's import or manual creation): confirm the routine name, week number, and today's resolved day name show correctly; confirm a rest day shows "(descanso)" with no start button; confirm "Empezar entrenamiento" appears for a trainable day.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useHomeData.ts "app/(app)/index.tsx"
git commit -m "feat: build out Home screen with active routine and today's session state"
```

---

## Task 7: Session screen — log sets

**Files:**
- Create: `src/components/WeightStepper.tsx`
- Create: `src/components/SessionExerciseCard.tsx`
- Create: `src/hooks/useSessionSets.ts`
- Create: `app/(app)/session/_layout.tsx`
- Create: `app/(app)/session/[sessionId].tsx`

**Interfaces:**
- Consumes: `getCachedDayExercises`, `getCachedExerciseState`, `resolveToday` from `src/lib/sqlite/cache.ts` (Task 5); `buildPrescribedSets`, `formatTargetScheme`, `PrescribedSet` from `src/lib/sessions/prescribedSets.ts` (Task 1); `LoggedSet`, `SetType` from `src/lib/sessions/types.ts` (Task 1); `listSessionSets` from `src/lib/sessions/queries.ts` (Task 2); `enqueueWrite` from `src/lib/sqlite/pendingWrites.ts` (Task 5); `syncNow` from `src/lib/sync/syncService.ts` (Task 5); `loadCurrentSession`, `clearCurrentSession` from `src/lib/sessions/currentSessionStorage.ts` (Task 3); `getDatabase` from `src/lib/sqlite/db.ts`; `randomUUID` from `expo-crypto`; `StepperInput` from `src/components/StepperInput.tsx` (already exists — reused here for reps/seconds with `step={exercise.rep_unit === 'seconds' ? 5 : 1}`).
- Produces: nothing consumed by a later task — this is the last screen-level task before Task 8's wiring/verification.

- [ ] **Step 1: Implement the weight stepper (±1.25/2.5/5kg per spec §7.2)**

```tsx
// src/components/WeightStepper.tsx
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

interface WeightStepperProps {
  value: string;
  onChange: (value: string) => void;
}

const STEPS = [5, 2.5, 1.25];

export function WeightStepper({ value, onChange }: WeightStepperProps) {
  function bump(delta: number) {
    const current = value === '' ? 0 : Number(value);
    if (Number.isNaN(current)) return;
    const next = Math.max(0, current + delta);
    onChange(String(next));
  }

  return (
    <View style={styles.row}>
      {[...STEPS].reverse().map((step) => (
        <Pressable key={`minus-${step}`} style={styles.button} onPress={() => bump(-step)}>
          <Text style={styles.buttonText}>-{step}</Text>
        </Pressable>
      ))}
      <TextInput style={styles.input} keyboardType="numeric" value={value} onChangeText={onChange} />
      {STEPS.map((step) => (
        <Pressable key={`plus-${step}`} style={styles.button} onPress={() => bump(step)}>
          <Text style={styles.buttonText}>+{step}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  button: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
  },
  buttonText: { fontSize: 12, fontWeight: '600' },
  input: {
    width: 60,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    textAlign: 'center',
  },
});
```

- [ ] **Step 2: Implement the session-sets data hook**

```typescript
// src/hooks/useSessionSets.ts
import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { getDatabase } from '../lib/sqlite/db';
import { getCachedDayExercises, getCachedExerciseState, CachedRoutineExercise } from '../lib/sqlite/cache';
import { listSessionSets } from '../lib/sessions/queries';
import { LoggedSet, SetType } from '../lib/sessions/types';
import { enqueueWrite } from '../lib/sqlite/pendingWrites';
import { syncNow } from '../lib/sync/syncService';
import { useAuthSession } from './useAuthSession';

export function useSessionSets(sessionId: string | undefined) {
  const { session } = useAuthSession();
  const userId = session?.user.id;

  const [dayName, setDayName] = useState<string | null>(null);
  const [exercises, setExercises] = useState<CachedRoutineExercise[]>([]);
  const [loggedSets, setLoggedSets] = useState<LoggedSet[]>([]);
  const [weightByExercise, setWeightByExercise] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const sets = await listSessionSets(supabase, sessionId);
      setLoggedSets(sets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la sesión.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadForDay = useCallback((dayId: string, resolvedDayName: string) => {
    const dayExercises = getCachedDayExercises(getDatabase(), dayId);
    setExercises(dayExercises);
    setDayName(resolvedDayName);
    const weights: Record<string, number | null> = {};
    dayExercises.forEach((exercise) => {
      const state = getCachedExerciseState(getDatabase(), exercise.exercise_id);
      weights[exercise.id] = state?.current_weight ?? null;
    });
    setWeightByExercise(weights);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function logSet(
    routineExerciseId: string,
    setIndex: number,
    setType: SetType,
    weight: number,
    reps: number,
    rir: number | null
  ) {
    if (!sessionId) return;
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
    setLoggedSets((prev) => [...prev, payload as LoggedSet]);
    if (userId) syncNow(getDatabase(), supabase, userId).catch(() => {});
  }

  async function completeSession() {
    if (!sessionId) return;
    const id = Crypto.randomUUID();
    enqueueWrite(getDatabase(), id, 'workout_sessions', { id: sessionId, status: 'completed' });
    if (userId) await syncNow(getDatabase(), supabase, userId).catch(() => {});
  }

  return { dayName, exercises, loggedSets, weightByExercise, loading, error, loadForDay, logSet, completeSession };
}
```

- [ ] **Step 3: Implement the per-exercise card**

```tsx
// src/components/SessionExerciseCard.tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CachedRoutineExercise } from '../lib/sqlite/cache';
import { LoggedSet, SetType } from '../lib/sessions/types';
import { buildPrescribedSets, formatTargetScheme } from '../lib/sessions/prescribedSets';
import { WeightStepper } from './WeightStepper';
import { StepperInput } from './StepperInput';

interface SessionExerciseCardProps {
  exercise: CachedRoutineExercise;
  initialWeight: number | null;
  loggedSets: LoggedSet[];
  onLogSet: (setIndex: number, setType: SetType, weight: number, reps: number, rir: number | null) => Promise<void>;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4];

export function SessionExerciseCard({ exercise, initialWeight, loggedSets, onLogSet }: SessionExerciseCardProps) {
  const [weight, setWeight] = useState(initialWeight !== null ? String(initialWeight) : '');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState<number | null>(exercise.rir_min !== null ? exercise.rir_min : null);
  const [saving, setSaving] = useState(false);

  const prescribed = buildPrescribedSets(exercise);
  const showRir = exercise.rir_min !== null;

  async function handleLog(setIndex: number, setType: SetType) {
    if (!weight || !reps) return;
    setSaving(true);
    try {
      await onLogSet(setIndex, setType, Number(weight), Number(reps), showRir ? rir : null);
      setReps('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{exercise.exercise_name}</Text>
      <Text style={styles.target}>{formatTargetScheme(exercise)}</Text>

      <Text style={styles.label}>Peso (kg)</Text>
      <WeightStepper value={weight} onChange={setWeight} />

      <Text style={styles.label}>{exercise.rep_unit === 'seconds' ? 'Segundos' : 'Reps'}</Text>
      <StepperInput value={reps} onChange={setReps} min={0} max={200} step={exercise.rep_unit === 'seconds' ? 5 : 1} />

      {showRir && (
        <>
          <Text style={styles.label}>RIR</Text>
          <View style={styles.rirRow}>
            {RIR_OPTIONS.map((option) => (
              <Pressable
                key={option}
                style={[styles.rirOption, rir === option && styles.rirOptionSelected]}
                onPress={() => setRir(option)}
              >
                <Text style={rir === option ? styles.rirTextSelected : styles.rirText}>{option}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {prescribed.map((set) => {
        const done = loggedSets.some(
          (logged) => logged.routine_exercise_id === exercise.id && logged.set_index === set.setIndex
        );
        return (
          <Pressable
            key={set.setIndex}
            style={[styles.setRow, done && styles.setRowDone]}
            disabled={done || saving}
            onPress={() => handleLog(set.setIndex, set.setType)}
          >
            <Text>
              {done ? '✓ ' : ''}Serie {set.setIndex} ({set.setType})
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  name: { fontSize: 16, fontWeight: '700' },
  target: { color: '#666' },
  label: { fontWeight: '600', marginTop: 4 },
  rirRow: { flexDirection: 'row', gap: 6 },
  rirOption: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  rirOptionSelected: { backgroundColor: '#111', borderColor: '#111' },
  rirText: { color: '#111' },
  rirTextSelected: { color: '#fff' },
  setRow: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  setRowDone: { backgroundColor: '#f0fdf4', borderColor: '#16a34a' },
});
```

- [ ] **Step 4: Create the session route layout and screen**

```tsx
// app/(app)/session/_layout.tsx
import { Stack } from 'expo-router';

export default function SessionLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

```tsx
// app/(app)/session/[sessionId].tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getDatabase } from '../../../src/lib/sqlite/db';
import { resolveToday } from '../../../src/lib/sqlite/cache';
import { clearCurrentSession } from '../../../src/lib/sessions/currentSessionStorage';
import { useSessionSets } from '../../../src/hooks/useSessionSets';
import { SessionExerciseCard } from '../../../src/components/SessionExerciseCard';

export default function SessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { dayName, exercises, loggedSets, weightByExercise, loading, error, loadForDay, logSet, completeSession } =
    useSessionSets(sessionId);
  const [resolvedDayName, setResolvedDayName] = useState<string | null>(null);

  useEffect(() => {
    const resolved = resolveToday(getDatabase());
    if (!resolved || !resolved.day) return;
    setResolvedDayName(resolved.day.name);
    loadForDay(resolved.day.id, resolved.day.name);
  }, [loadForDay]);

  async function handleFinish() {
    await completeSession();
    await clearCurrentSession();
    router.replace('/(app)' as any);
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{resolvedDayName ?? dayName ?? 'Entrenamiento'}</Text>

      {exercises.map((exercise) => (
        <SessionExerciseCard
          key={exercise.id}
          exercise={exercise}
          initialWeight={weightByExercise[exercise.id] ?? null}
          loggedSets={loggedSets}
          onLogSet={(setIndex, setType, weight, reps, rir) =>
            logSet(exercise.id, setIndex, setType, weight, reps, rir)
          }
        />
      ))}

      <Pressable
        style={styles.finishButton}
        onPress={() =>
          Alert.alert('Terminar entrenamiento', '¿Marcar esta sesión como completada?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Terminar', onPress: handleFinish },
          ])
        }
      >
        <Text style={styles.finishButtonText}>Terminar entrenamiento</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  error: { color: '#dc2626' },
  finishButton: { backgroundColor: '#16a34a', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  finishButtonText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Manual verification (this screen calls `expo-sqlite` — no Jest test)**

From Home, tap "Empezar entrenamiento": confirm the day's exercises appear with their target scheme text, weight prefilled from `current_weight` (or empty if never trained), and that tapping a set row after entering weight/reps marks it done (✓) and disables it. Confirm the RIR selector is hidden for a core exercise (`rir_min === null`). Tap "Terminar entrenamiento" and confirm it navigates back to Home.

- [ ] **Step 7: Commit**

```bash
git add src/components/WeightStepper.tsx src/components/SessionExerciseCard.tsx src/hooks/useSessionSets.ts "app/(app)/session"
git commit -m "feat: add session screen for logging sets"
```

---

## Task 8: Wire the sync listener and verify end-to-end

**Files:**
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `startSyncListener` from `src/lib/sync/syncService.ts` (Task 5); `getDatabase` from `src/lib/sqlite/db.ts`; `supabase` from `src/lib/supabase.ts`; `useAuthSession` from `src/hooks/useAuthSession.ts` (already used in this file).
- Produces: nothing — this is the final integration task.

- [ ] **Step 1: Read the current file**

Read `app/_layout.tsx` before editing — it currently calls `initDatabase()` at module scope and renders `<SafeAreaProvider>` / `<SafeAreaView>` / `<Slot>` around auth-gated routing. Preserve all of that; only add the sync listener lifecycle.

- [ ] **Step 2: Add the sync listener, scoped to a signed-in session**

Add these imports alongside the existing ones:

```typescript
import { useEffect } from 'react';
import { supabase } from '../src/lib/supabase';
import { getDatabase } from '../src/lib/sqlite/db';
import { startSyncListener } from '../src/lib/sync/syncService';
```

Inside `RootLayout`, after the existing `session`/`isLoading` destructuring and the existing navigation `useEffect`, add a second effect that starts the listener whenever there's a signed-in user and tears it down on sign-out/unmount:

```typescript
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    const stop = startSyncListener(getDatabase(), supabase, userId);
    return stop;
  }, [session?.user.id]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run the full Jest suite**

Run: `npx jest`
Expected: all suites pass (Task 1-4's new tests plus every pre-existing suite)

- [ ] **Step 5: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: start the offline sync listener for signed-in users"
```

- [ ] **Step 6: Manual end-to-end verification on a real device**

This is the check for everything Tasks 5-7 couldn't cover with Jest (per Global Constraints):

1. Sign in with a user that has an active routine covering today's weekday (activate one from "Ver rutinas" if needed).
2. Open Home: confirm the routine name, week number, and today's day show correctly.
3. Tap "Empezar entrenamiento", log a couple of sets with different weights/reps/RIR, confirm they mark done.
4. Turn on airplane mode. Log another set. Confirm the app doesn't crash or hang (it queues locally).
5. Turn airplane mode back off. Wait a few seconds (or background/foreground the app once to trigger the `AppState` listener). Check the Supabase dashboard's `logged_sets` table for the queued set — confirm it landed.
6. Kill the app entirely (not just background) while a session is still `in_progress`, then relaunch it. Confirm Home shows "Continuar entrenamiento" (not a fresh "Empezar entrenamiento" that would create a duplicate session) and tapping it returns to the same session.
7. Tap "Terminar entrenamiento". Confirm the session's `status` becomes `completed` in Supabase and Home now shows "✓ Entrenamiento completado hoy".

Report the outcome of this walkthrough — if any step fails, fix it before considering the plan done.

---

## Self-Review Notes

**Spec coverage:** §3 (client/offline architecture) → Tasks 5, 8. §4 (local SQLite mirror) → Task 5 (`cache.ts`, `pendingWrites.ts`, reusing the already-existing `schema.ts`/`db.ts`). §7 (client logging flow) → Tasks 1 (day resolution, prescribed sets), 6 (Home: steps 1, 4b), 7 (Session: steps 2-4, 5b). §9 (auth) → already implemented in Plan 1, only consumed here (`useAuthSession`). §10 (offline sync) → Tasks 4, 5, 8. §11.3 (offline queue tests) → Task 4. §8 (progression/deload/routine-switch) → explicitly excluded, deferred to Plan 4.

**Documented simplifications (spec is silent on these; ruled here, matching the spec's own "Simplification (documented, not solved)" pattern in §6):**
- Session completion goes through the same offline queue as set logging (upsert-by-id), even though spec §10 only literally names "new sessions, logged sets" as queued — completing a session is just another `workout_sessions` write, so reusing the identical mechanism was simpler and more consistent than inventing a second, always-online path for it.
- Resuming an in-progress session after the app is fully killed while offline recovers the *session id* (via the `currentSessionStorage` AsyncStorage pointer, avoiding a duplicate session) but not necessarily the exact list of already-logged sets if some of them hadn't synced yet — re-logging a set in that narrow scenario creates a harmless duplicate row rather than being silently blocked or crashing.
