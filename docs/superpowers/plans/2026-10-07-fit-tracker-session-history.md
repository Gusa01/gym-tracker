# Session History & Set Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Historial section (paged list of completed sessions + set-by-set detail) and set corrections (edit weight/reps/RIR or soft-delete a set) from both the history detail and the in-progress session.

**Architecture:** `logged_sets` gains `is_deleted`; every reader filters it and the progress view is recreated with the filter (keeping `security_invoker`). Corrections are full-row upserts of the same set id through the existing offline queue (`enqueueWrite` → flush), with optimistic local state and a `syncNow` afterwards so the records cache rebuilds. Pure logic lives in `src/lib/history/`; one shared `SetEditor` bottom sheet serves both screens.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / expo-router (drawer + stack), Supabase (Postgres + supabase-js v2), expo-sqlite, expo-crypto, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-10-07-fit-tracker-session-history-design.md`

## Global Constraints

- Work in `B:\Gusa\Dev\fit-tracker` on branch `session-history`. Do not switch branches or push.
- All user-facing copy is Spanish (rioplatense), exactly as written in this plan.
- App code never hard-deletes rows (`.delete()`); deleting a set = upsert with `is_deleted: true`.
- Correcting a set never writes `user_exercise_state` (no progression recompute).
- `exercise_set_history` must be recreated `with (security_invoker = true)`.
- Every correction is a FULL-row upsert of the set (`id`, `session_id`, `routine_exercise_id`, `set_index`, `set_type`, `weight`, `reps`, `rir`, `created_at`, `is_deleted`) queued with a fresh `pending_writes` id (never the set's id).
- Modules under `src/lib/history/` named `types.ts`, `logic.ts`, `format.ts` must not import React, React Native, Expo, expo-sqlite or Supabase.
- Unit tests in `tests/lib/history/*.test.ts`; anything touching Supabase is `*.integration.test.ts`.
- Relative imports (`../../../src/...` from `app/(app)/<dir>/`); `router.push` to dynamic routes uses a fully-qualified path cast `as any`.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verification: `npm run typecheck`, `npm run test:unit`, `npx jest <path>`. Integration tests run in CI (`integration` job, throwaway local Supabase); do NOT run them locally against the hosted project and do NOT run `npx supabase db push`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261007120000_logged_sets_soft_delete.sql` (create) | `is_deleted` column + recreated view |
| `src/lib/sessions/types.ts` (modify) | `LoggedSet.is_deleted?` |
| `src/lib/sessions/queries.ts` (modify) | filter `listSessionSets`; `listRecentCompletedSessions` returns `sessionId` |
| `src/lib/progression/queries.ts` (modify) | filter `listRecentTopSets` |
| `src/lib/history/types.ts` (create) | shared types |
| `src/lib/history/logic.ts` (create) | summarize, group, validate, build/apply corrections |
| `src/lib/history/format.ts` (create) | session title, set label, set values text |
| `src/lib/history/queries.ts` (create) | `listCompletedSessions`, `getSessionDetail` |
| `src/lib/history/submitCorrection.ts` (create) | queue a correction in SQLite |
| `src/components/SetEditor.tsx` (create) | shared bottom-sheet editor |
| `src/hooks/useSessionSets.ts`, `src/components/SessionExerciseCard.tsx`, `app/(app)/session/[sessionId].tsx` (modify) | corrections in the live session |
| `src/hooks/useSessionHistory.ts` (create) | list + detail hooks |
| `app/(app)/history/_layout.tsx`, `index.tsx`, `[sessionId].tsx` (create) | screens |
| `app/(app)/_layout.tsx`, `app/(app)/index.tsx`, `src/hooks/useHomeData.ts` (modify) | drawer entry, tappable recent activity |

---

### Task 1: Soft-delete column, filtered readers, recreated view

**Files:**
- Create: `supabase/migrations/20261007120000_logged_sets_soft_delete.sql`
- Modify: `src/lib/sessions/types.ts`, `src/lib/sessions/queries.ts`, `src/lib/progression/queries.ts`, `src/hooks/useHomeData.ts`
- Test: `tests/lib/history/softDelete.integration.test.ts` (create), `tests/lib/sessions/queries.integration.test.ts` (modify)

**Interfaces:**
- Produces: `LoggedSet.is_deleted?: boolean`; `listRecentCompletedSessions(...)` returns `{ sessionId: string; sessionDate: string; dayName: string }[]`; `listSessionSets` and `listRecentTopSets` exclude `is_deleted = true`; the view excludes them.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20261007120000_logged_sets_soft_delete.sql`:

```sql
-- Corrections soft-delete a set (never a hard DELETE) so a delete is just another upsert
-- through the app's offline queue.
alter table public.logged_sets
  add column is_deleted boolean not null default false;

-- Same view as 20261001120000, plus the is_deleted filter. security_invoker MUST stay: without it
-- the view runs as its owner and bypasses RLS on logged_sets / workout_sessions.
create or replace view public.exercise_set_history
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
  and ls.set_type <> 'warmup'
  and ls.is_deleted = false;
```

- [ ] **Step 2: Write the failing integration tests**

`tests/lib/history/softDelete.integration.test.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import { listSessionSets } from '../../../src/lib/sessions/queries';
import { listRecentTopSets } from '../../../src/lib/progression/queries';
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

async function seedCompletedSessionWithSets(userId: string) {
  const seeded = await seedTestRoutine(admin, userId);
  const { data: session, error: sessionError } = await admin
    .from('workout_sessions')
    .insert({ user_id: userId, routine_day_id: seeded.day.id, session_date: '2026-02-02', status: 'completed' })
    .select('id')
    .single();
  if (sessionError) throw sessionError;
  const { data: sets, error: setsError } = await admin
    .from('logged_sets')
    .insert([
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 1, set_type: 'top_set', weight: 80, reps: 5 },
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 2, set_type: 'top_set', weight: 70, reps: 8 },
    ])
    .select('*')
    .order('set_index');
  if (setsError) throw setsError;
  return { sessionId: session.id as string, routineExerciseId: seeded.routineExercise.id as string, sets: sets! };
}

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe('logged_sets soft delete', () => {
  let userId: string;
  let seeded: Awaited<ReturnType<typeof seedCompletedSessionWithSets>>;

  beforeAll(async () => {
    ({ userId } = await createUser('soft-delete'));
    seeded = await seedCompletedSessionWithSets(userId);
    const deleted = seeded.sets.find((s) => s.set_index === 2)!;
    const { error } = await admin.from('logged_sets').upsert({ ...deleted, is_deleted: true });
    if (error) throw error;
  });

  it('defaults new sets to not deleted', () => {
    expect(seeded.sets.every((s) => s.is_deleted === false)).toBe(true);
  });

  it('hides a deleted set from listSessionSets', async () => {
    const sets = await listSessionSets(admin, seeded.sessionId);
    expect(sets.map((s) => s.set_index)).toEqual([1]);
  });

  it('hides a deleted set from the deload top-set lookup', async () => {
    const sets = await listRecentTopSets(admin, seeded.routineExerciseId, 5);
    expect(sets.map((s) => s.set_index)).toEqual([1]);
  });

  it('hides a deleted set from exercise_set_history', async () => {
    const rows = await listExerciseSetHistory(admin, userId);
    expect(rows.map((r) => r.set_index)).toEqual([1]);
  });

  it('edits a set in place when upserting the full row with the same id', async () => {
    const original = seeded.sets.find((s) => s.set_index === 1)!;
    const { error } = await admin.from('logged_sets').upsert({ ...original, weight: 82.5, reps: 4 });
    expect(error).toBeNull();
    const { data } = await admin.from('logged_sets').select('*').eq('session_id', seeded.sessionId);
    expect(data).toHaveLength(2);
    expect(data!.find((s) => s.id === original.id)).toMatchObject({ weight: 82.5, reps: 4, is_deleted: false });
  });
});

describe('recreated exercise_set_history keeps row level security', () => {
  it("never shows another user's sets", async () => {
    const owner = await createUser('soft-delete-owner');
    const other = await createUser('soft-delete-other');
    await seedCompletedSessionWithSets(owner.userId);

    const otherClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await otherClient.auth.signInWithPassword({ email: other.email, password: PASSWORD });
    if (signInError) throw signInError;

    const { data, error } = await otherClient.from('exercise_set_history').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
```

In `tests/lib/sessions/queries.integration.test.ts`, inside the test `'returns only completed sessions, newest first, with the day name joined in'`, add after the existing `expect(result.every(...))` line:

```typescript
    expect(result.every((r) => typeof r.sessionId === 'string' && r.sessionId.length > 0)).toBe(true);
```

- [ ] **Step 3: Confirm they fail to compile or fail**

Run: `npm run typecheck`
Expected: FAIL — `sessionId` does not exist on the `listRecentCompletedSessions` result type. (The integration file itself runs in CI only.)

- [ ] **Step 4: Implement the reader changes**

In `src/lib/sessions/types.ts`, add a last field to `LoggedSet`:

```typescript
  is_deleted?: boolean;
```

In `src/lib/sessions/queries.ts`, `listSessionSets`: add `.eq('is_deleted', false)` after `.eq('session_id', sessionId)`.

In `src/lib/sessions/queries.ts`, replace `listRecentCompletedSessions` with:

```typescript
export async function listRecentCompletedSessions(
  supabase: SupabaseClient,
  userId: string,
  limit = 30
): Promise<{ sessionId: string; sessionDate: string; dayName: string }[]> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id, session_date, routine_days(name)')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('session_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as any[]).map((row) => ({
    sessionId: row.id,
    sessionDate: row.session_date,
    dayName: row.routine_days?.name ?? '',
  }));
}
```

In `src/lib/progression/queries.ts`, `listRecentTopSets`: add `.eq('is_deleted', false)` after `.eq('set_type', 'top_set')`.

In `src/hooks/useHomeData.ts`, change the `recentActivity` state type to:

```typescript
  const [recentActivity, setRecentActivity] = useState<{ sessionId: string; sessionDate: string; dayName: string }[]>([]);
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck` (expected: exit 0)
Run: `npm run test:unit` (expected: all pass)
Run: `npx jest --selectProjects integration --listTests` (expected: lists `tests/lib/history/softDelete.integration.test.ts`)

```bash
git add supabase/migrations/20261007120000_logged_sets_soft_delete.sql src/lib/sessions/types.ts src/lib/sessions/queries.ts src/lib/progression/queries.ts src/hooks/useHomeData.ts tests/lib/history/softDelete.integration.test.ts tests/lib/sessions/queries.integration.test.ts
git commit -m "feat: soft-delete logged sets and hide deleted sets from every reader"
```

---

### Task 2: Pure history logic and formatting

**Files:**
- Create: `src/lib/history/types.ts`, `src/lib/history/logic.ts`, `src/lib/history/format.ts`
- Test: `tests/lib/history/logic.test.ts`, `tests/lib/history/format.test.ts`

**Interfaces:**
- Consumes: `LoggedSet` (with `is_deleted?`) from `src/lib/sessions/types.ts`; `RoutineExerciseRepUnit`, `RoutineExerciseSchemeType` from `src/lib/routines/types.ts`; `formatNumber` from `src/lib/progress/format.ts`.
- Produces (exact):
  - types: `SetCorrection`, `HistoryExercise`, `HistorySessionRow`, `SessionDetail`, `ExerciseSetGroup`, `SetEditValues` (code below)
  - `summarizeSession(sets: Array<{ routine_exercise_id: string; is_deleted?: boolean }>): { exerciseCount: number; setCount: number }`
  - `groupSessionSets(sets: LoggedSet[], exercises: HistoryExercise[]): ExerciseSetGroup[]`
  - `validateSetEdit(values: SetEditValues, exercise: { rep_unit: RoutineExerciseRepUnit; rir_min: number | null }): string | null`
  - `editFromValues(values: SetEditValues, exercise: { rep_unit: RoutineExerciseRepUnit; rir_min: number | null }, original: LoggedSet): SetCorrection`
  - `buildCorrectionPayload(set: LoggedSet, change: SetCorrection): Record<string, unknown>`
  - `applyCorrection(sets: LoggedSet[], setId: string, change: SetCorrection): LoggedSet[]`
  - `formatSessionTitle(date: string, dayName: string): string`
  - `formatSetLabel(set: LoggedSet): string`
  - `formatSetValues(set: LoggedSet, repUnit: RoutineExerciseRepUnit): string`

- [ ] **Step 1: Create the types**

`src/lib/history/types.ts`:

```typescript
import { RoutineExerciseRepUnit, RoutineExerciseSchemeType } from '../routines/types';
import { LoggedSet } from '../sessions/types';

export type SetCorrection =
  | { kind: 'edit'; weight: number; reps: number; rir: number | null }
  | { kind: 'delete' };

/** The routine exercise a historical set points to (soft-deleted ones included). */
export interface HistoryExercise {
  id: string;
  exercise_name: string;
  order_index: number;
  scheme_type: RoutineExerciseSchemeType;
  rep_unit: RoutineExerciseRepUnit;
  rir_min: number | null;
}

export interface HistorySessionRow {
  id: string;
  sessionDate: string;
  dayName: string;
  exerciseCount: number;
  setCount: number;
}

export interface SessionDetail {
  id: string;
  sessionDate: string;
  dayName: string;
  sets: LoggedSet[];
  exercises: HistoryExercise[];
}

export interface ExerciseSetGroup {
  exercise: HistoryExercise;
  sets: LoggedSet[];
}

/** Raw editor input: the steppers hold strings. */
export interface SetEditValues {
  weight: string;
  reps: string;
  rir: number | null;
}
```

- [ ] **Step 2: Write the failing logic tests**

`tests/lib/history/logic.test.ts`:

```typescript
import {
  summarizeSession,
  groupSessionSets,
  validateSetEdit,
  editFromValues,
  buildCorrectionPayload,
  applyCorrection,
} from '../../../src/lib/history/logic';
import { HistoryExercise } from '../../../src/lib/history/types';
import { LoggedSet } from '../../../src/lib/sessions/types';

function set(overrides: Partial<LoggedSet>): LoggedSet {
  return {
    id: 's1',
    session_id: 'sess',
    routine_exercise_id: 're-bench',
    set_index: 1,
    set_type: 'working',
    weight: 80,
    reps: 8,
    rir: 2,
    created_at: '2026-10-01T18:00:00Z',
    is_deleted: false,
    ...overrides,
  };
}

function exercise(overrides: Partial<HistoryExercise>): HistoryExercise {
  return {
    id: 're-bench',
    exercise_name: 'Press banca',
    order_index: 0,
    scheme_type: 'normal',
    rep_unit: 'reps',
    rir_min: 1,
    ...overrides,
  };
}

describe('summarizeSession', () => {
  it('counts distinct exercises and sets, ignoring deleted sets', () => {
    expect(
      summarizeSession([
        { routine_exercise_id: 'a' },
        { routine_exercise_id: 'a' },
        { routine_exercise_id: 'b', is_deleted: false },
        { routine_exercise_id: 'c', is_deleted: true },
      ])
    ).toEqual({ exerciseCount: 2, setCount: 3 });
  });

  it('returns zeros for a session with no sets', () => {
    expect(summarizeSession([])).toEqual({ exerciseCount: 0, setCount: 0 });
  });
});

describe('groupSessionSets', () => {
  const bench = exercise({ id: 're-bench', order_index: 1 });
  const squat = exercise({ id: 're-squat', exercise_name: 'Sentadilla', order_index: 0 });
  const curl = exercise({ id: 're-curl', exercise_name: 'Curl', order_index: 2 });

  it('orders exercises by routine order and sets by set index, dropping deleted sets', () => {
    const groups = groupSessionSets(
      [
        set({ id: 'b2', routine_exercise_id: 're-bench', set_index: 2 }),
        set({ id: 'b1', routine_exercise_id: 're-bench', set_index: 1 }),
        set({ id: 's1', routine_exercise_id: 're-squat', set_index: 1 }),
        set({ id: 'c1', routine_exercise_id: 're-curl', set_index: 1, is_deleted: true }),
      ],
      [bench, curl, squat]
    );
    expect(groups.map((g) => [g.exercise.id, g.sets.map((s) => s.id)])).toEqual([
      ['re-squat', ['s1']],
      ['re-bench', ['b1', 'b2']],
    ]);
  });

  it('skips sets whose exercise is unknown', () => {
    expect(groupSessionSets([set({ routine_exercise_id: 'gone' })], [bench])).toEqual([]);
  });
});

describe('validateSetEdit', () => {
  const weighted = { rep_unit: 'reps' as const, rir_min: 1 };
  const plank = { rep_unit: 'seconds' as const, rir_min: null };
  const noRir = { rep_unit: 'reps' as const, rir_min: null };

  it('accepts valid values', () => {
    expect(validateSetEdit({ weight: '82.5', reps: '6', rir: 2 }, weighted)).toBeNull();
    expect(validateSetEdit({ weight: '0', reps: '12', rir: 0 }, weighted)).toBeNull();
  });

  it('rejects an empty or non-numeric weight', () => {
    expect(validateSetEdit({ weight: '', reps: '6', rir: 2 }, weighted)).toBe('Ingresá un peso válido.');
    expect(validateSetEdit({ weight: 'abc', reps: '6', rir: 2 }, weighted)).toBe('Ingresá un peso válido.');
  });

  it('rejects a negative weight', () => {
    expect(validateSetEdit({ weight: '-5', reps: '6', rir: 2 }, weighted)).toBe('El peso no puede ser negativo.');
  });

  it('requires whole reps of at least 1', () => {
    expect(validateSetEdit({ weight: '80', reps: '0', rir: 2 }, weighted)).toBe(
      'Las reps tienen que ser un número entero mayor a 0.'
    );
    expect(validateSetEdit({ weight: '80', reps: '6.5', rir: 2 }, weighted)).toBe(
      'Las reps tienen que ser un número entero mayor a 0.'
    );
  });

  it('talks about seconds and ignores weight for time-based exercises', () => {
    expect(validateSetEdit({ weight: '', reps: '45', rir: null }, plank)).toBeNull();
    expect(validateSetEdit({ weight: '', reps: '0', rir: null }, plank)).toBe(
      'Los segundos tienen que ser un número entero mayor a 0.'
    );
  });

  it('requires an RIR in 0-10 only when the exercise has an RIR target', () => {
    expect(validateSetEdit({ weight: '80', reps: '6', rir: null }, weighted)).toBe('Elegí el RIR.');
    expect(validateSetEdit({ weight: '80', reps: '6', rir: 11 }, weighted)).toBe('El RIR tiene que estar entre 0 y 10.');
    expect(validateSetEdit({ weight: '80', reps: '6', rir: null }, noRir)).toBeNull();
  });
});

describe('editFromValues', () => {
  it('parses the values into an edit', () => {
    expect(editFromValues({ weight: '82.5', reps: '6', rir: 1 }, { rep_unit: 'reps', rir_min: 1 }, set({}))).toEqual({
      kind: 'edit',
      weight: 82.5,
      reps: 6,
      rir: 1,
    });
  });

  it('keeps the original weight for time-based exercises and the original RIR when none is shown', () => {
    expect(
      editFromValues({ weight: '999', reps: '50', rir: 3 }, { rep_unit: 'seconds', rir_min: null }, set({ weight: 0, rir: null }))
    ).toEqual({ kind: 'edit', weight: 0, reps: 50, rir: null });
  });
});

describe('buildCorrectionPayload', () => {
  const original = set({});

  it('sends the full row with the new values for an edit', () => {
    expect(buildCorrectionPayload(original, { kind: 'edit', weight: 70, reps: 10, rir: 3 })).toEqual({
      id: 's1',
      session_id: 'sess',
      routine_exercise_id: 're-bench',
      set_index: 1,
      set_type: 'working',
      weight: 70,
      reps: 10,
      rir: 3,
      created_at: '2026-10-01T18:00:00Z',
      is_deleted: false,
    });
  });

  it('sends the full row flagged deleted for a delete', () => {
    expect(buildCorrectionPayload(original, { kind: 'delete' })).toEqual({
      id: 's1',
      session_id: 'sess',
      routine_exercise_id: 're-bench',
      set_index: 1,
      set_type: 'working',
      weight: 80,
      reps: 8,
      rir: 2,
      created_at: '2026-10-01T18:00:00Z',
      is_deleted: true,
    });
  });
});

describe('applyCorrection', () => {
  const sets = [set({ id: 'a' }), set({ id: 'b', set_index: 2 })];

  it('updates the edited set in place without mutating the input', () => {
    const result = applyCorrection(sets, 'b', { kind: 'edit', weight: 60, reps: 12, rir: 1 });
    expect(result.find((s) => s.id === 'b')).toMatchObject({ weight: 60, reps: 12, rir: 1 });
    expect(sets.find((s) => s.id === 'b')).toMatchObject({ weight: 80, reps: 8, rir: 2 });
  });

  it('removes a deleted set', () => {
    expect(applyCorrection(sets, 'a', { kind: 'delete' }).map((s) => s.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 3: Write the failing format tests**

`tests/lib/history/format.test.ts`:

```typescript
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
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx jest tests/lib/history/logic.test.ts tests/lib/history/format.test.ts`
Expected: FAIL, cannot find modules `logic` / `format`.

- [ ] **Step 5: Implement the logic**

`src/lib/history/logic.ts`:

```typescript
import { RoutineExerciseRepUnit } from '../routines/types';
import { LoggedSet } from '../sessions/types';
import { ExerciseSetGroup, HistoryExercise, SetCorrection, SetEditValues } from './types';

const MAX_RIR = 10;

export function summarizeSession(
  sets: Array<{ routine_exercise_id: string; is_deleted?: boolean }>
): { exerciseCount: number; setCount: number } {
  const live = sets.filter((s) => !s.is_deleted);
  return { exerciseCount: new Set(live.map((s) => s.routine_exercise_id)).size, setCount: live.length };
}

export function groupSessionSets(sets: LoggedSet[], exercises: HistoryExercise[]): ExerciseSetGroup[] {
  return [...exercises]
    .sort((a, b) => a.order_index - b.order_index)
    .map((exercise) => ({
      exercise,
      sets: sets
        .filter((s) => s.routine_exercise_id === exercise.id && !s.is_deleted)
        .sort((a, b) => a.set_index - b.set_index),
    }))
    .filter((group) => group.sets.length > 0);
}

/** The first problem with the editor's values, in Spanish, or null when they are valid. */
export function validateSetEdit(
  values: SetEditValues,
  exercise: { rep_unit: RoutineExerciseRepUnit; rir_min: number | null }
): string | null {
  const timeBased = exercise.rep_unit === 'seconds';
  if (!timeBased) {
    const weight = Number(values.weight);
    if (values.weight.trim() === '' || Number.isNaN(weight)) return 'Ingresá un peso válido.';
    if (weight < 0) return 'El peso no puede ser negativo.';
  }
  const reps = Number(values.reps);
  if (values.reps.trim() === '' || !Number.isInteger(reps) || reps < 1) {
    return timeBased
      ? 'Los segundos tienen que ser un número entero mayor a 0.'
      : 'Las reps tienen que ser un número entero mayor a 0.';
  }
  if (exercise.rir_min !== null) {
    if (values.rir === null) return 'Elegí el RIR.';
    if (!Number.isInteger(values.rir) || values.rir < 0 || values.rir > MAX_RIR) {
      return 'El RIR tiene que estar entre 0 y 10.';
    }
  }
  return null;
}

/** Turns valid editor values into an edit; fields the editor doesn't show keep the original value. */
export function editFromValues(
  values: SetEditValues,
  exercise: { rep_unit: RoutineExerciseRepUnit; rir_min: number | null },
  original: LoggedSet
): SetCorrection {
  return {
    kind: 'edit',
    weight: exercise.rep_unit === 'seconds' ? original.weight : Number(values.weight),
    reps: Number(values.reps),
    rir: exercise.rir_min !== null ? values.rir : original.rir,
  };
}

/** Full-row upsert payload: the insert half of an upsert must satisfy every NOT NULL column. */
export function buildCorrectionPayload(set: LoggedSet, change: SetCorrection): Record<string, unknown> {
  const values = change.kind === 'edit' ? change : set;
  return {
    id: set.id,
    session_id: set.session_id,
    routine_exercise_id: set.routine_exercise_id,
    set_index: set.set_index,
    set_type: set.set_type,
    weight: values.weight,
    reps: values.reps,
    rir: values.rir,
    created_at: set.created_at,
    is_deleted: change.kind === 'delete',
  };
}

export function applyCorrection(sets: LoggedSet[], setId: string, change: SetCorrection): LoggedSet[] {
  if (change.kind === 'delete') return sets.filter((s) => s.id !== setId);
  return sets.map((s) => (s.id === setId ? { ...s, weight: change.weight, reps: change.reps, rir: change.rir } : s));
}
```

- [ ] **Step 6: Implement the formatting**

`src/lib/history/format.ts`:

```typescript
import { RoutineExerciseRepUnit } from '../routines/types';
import { LoggedSet } from '../sessions/types';
import { formatNumber } from '../progress/format';

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function formatSessionTitle(date: string, dayName: string): string {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const [, month, day] = date.split('-');
  const base = `${weekday} ${day}/${month}`;
  return dayName ? `${base} · ${dayName}` : base;
}

export function formatSetLabel(set: LoggedSet): string {
  switch (set.set_type) {
    case 'top_set':
      return 'Top set';
    case 'back_off':
      return 'Back-off';
    case 'warmup':
      return 'Entrada en calor';
    case 'working':
      return `Serie ${set.set_index}`;
  }
}

export function formatSetValues(set: LoggedSet, repUnit: RoutineExerciseRepUnit): string {
  if (repUnit === 'seconds') return `${set.reps} s`;
  const main = set.weight > 0 ? `${formatNumber(set.weight)} kg × ${set.reps}` : `${set.reps} reps`;
  return set.rir !== null ? `${main} · RIR ${set.rir}` : main;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest tests/lib/history/logic.test.ts tests/lib/history/format.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck` (expected: exit 0); `npm run test:unit` (expected: all pass)

```bash
git add src/lib/history/types.ts src/lib/history/logic.ts src/lib/history/format.ts tests/lib/history/logic.test.ts tests/lib/history/format.test.ts
git commit -m "feat: add pure logic for session history and set corrections"
```

---

### Task 3: History queries

**Files:**
- Create: `src/lib/history/queries.ts`
- Test: `tests/lib/history/queries.integration.test.ts`

**Interfaces:**
- Consumes (Task 2): `HistorySessionRow`, `SessionDetail`, `HistoryExercise`, `summarizeSession`. `LoggedSet` from `src/lib/sessions/types.ts`.
- Produces: `HISTORY_PAGE_SIZE = 30`; `listCompletedSessions(supabase: SupabaseClient, userId: string, page: number): Promise<{ sessions: HistorySessionRow[]; hasMore: boolean }>`; `getSessionDetail(supabase: SupabaseClient, sessionId: string): Promise<SessionDetail>`.

- [ ] **Step 1: Write the failing integration tests**

`tests/lib/history/queries.integration.test.ts`:

```typescript
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import { listCompletedSessions, getSessionDetail, HISTORY_PAGE_SIZE } from '../../../src/lib/history/queries';

const admin = createAdminClient();
const createdUserIds: string[] = [];

async function createUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'testpassword123', email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return data.user.id;
}

function dateOffset(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe('listCompletedSessions', () => {
  let userId: string;
  let countedSessionId: string;

  beforeAll(async () => {
    userId = await createUser('history-list');
    const first = await seedTestRoutine(admin, userId);
    const second = await seedTestRoutine(admin, userId);

    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, i) => ({
      user_id: userId,
      routine_day_id: first.day.id,
      session_date: dateOffset('2026-01-01', i),
      status: 'completed',
    }));
    rows.push({ user_id: userId, routine_day_id: first.day.id, session_date: '2027-01-01', status: 'in_progress' });
    const { data: sessions, error } = await admin.from('workout_sessions').insert(rows).select('id, session_date');
    if (error) throw error;

    // The newest completed session gets 3 sets on 2 exercises, plus 1 deleted set on a third count.
    countedSessionId = sessions!.find((s) => s.session_date === dateOffset('2026-01-01', HISTORY_PAGE_SIZE))!.id;
    const { error: setsError } = await admin.from('logged_sets').insert([
      { session_id: countedSessionId, routine_exercise_id: first.routineExercise.id, set_index: 1, set_type: 'working', weight: 50, reps: 10 },
      { session_id: countedSessionId, routine_exercise_id: first.routineExercise.id, set_index: 2, set_type: 'working', weight: 50, reps: 10 },
      { session_id: countedSessionId, routine_exercise_id: second.routineExercise.id, set_index: 1, set_type: 'working', weight: 20, reps: 12 },
      { session_id: countedSessionId, routine_exercise_id: second.routineExercise.id, set_index: 2, set_type: 'working', weight: 20, reps: 12, is_deleted: true },
    ]);
    if (setsError) throw setsError;
  });

  it('pages completed sessions newest first and reports whether more remain', async () => {
    const page0 = await listCompletedSessions(admin, userId, 0);
    expect(page0.sessions).toHaveLength(HISTORY_PAGE_SIZE);
    expect(page0.hasMore).toBe(true);
    expect(page0.sessions[0].sessionDate).toBe(dateOffset('2026-01-01', HISTORY_PAGE_SIZE));

    const page1 = await listCompletedSessions(admin, userId, 1);
    expect(page1.sessions.map((s) => s.sessionDate)).toEqual(['2026-01-01']);
    expect(page1.hasMore).toBe(false);
  });

  it('never includes unfinished sessions', async () => {
    const page0 = await listCompletedSessions(admin, userId, 0);
    expect(page0.sessions.some((s) => s.sessionDate === '2027-01-01')).toBe(false);
  });

  it('counts exercises and sets without deleted sets, with the day name', async () => {
    const page0 = await listCompletedSessions(admin, userId, 0);
    expect(page0.sessions[0]).toEqual({
      id: countedSessionId,
      sessionDate: dateOffset('2026-01-01', HISTORY_PAGE_SIZE),
      dayName: 'Día Test',
      exerciseCount: 2,
      setCount: 3,
    });
  });
});

describe('getSessionDetail', () => {
  it('returns the session, its live sets and their exercises, including a removed exercise', async () => {
    const userId = await createUser('history-detail');
    const seeded = await seedTestRoutine(admin, userId);
    const { data: session, error } = await admin
      .from('workout_sessions')
      .insert({ user_id: userId, routine_day_id: seeded.day.id, session_date: '2026-02-03', status: 'completed' })
      .select('id')
      .single();
    if (error) throw error;
    const { error: setsError } = await admin.from('logged_sets').insert([
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 2, set_type: 'working', weight: 40, reps: 9 },
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 1, set_type: 'working', weight: 40, reps: 10 },
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 3, set_type: 'working', weight: 40, reps: 7, is_deleted: true },
    ]);
    if (setsError) throw setsError;
    const { error: removeError } = await admin
      .from('routine_exercises')
      .update({ is_deleted: true })
      .eq('id', seeded.routineExercise.id);
    if (removeError) throw removeError;

    const detail = await getSessionDetail(admin, session.id);

    expect(detail).toMatchObject({ id: session.id, sessionDate: '2026-02-03', dayName: 'Día Test' });
    expect(detail.sets.map((s) => s.set_index)).toEqual([1, 2]);
    expect(detail.exercises).toEqual([
      {
        id: seeded.routineExercise.id,
        exercise_name: '[test-fixture] Shared Exercise',
        order_index: 0,
        scheme_type: 'normal',
        rep_unit: 'reps',
        rir_min: 2,
      },
    ]);
  });
});
```

- [ ] **Step 2: Implement the queries**

`src/lib/history/queries.ts`:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { LoggedSet } from '../sessions/types';
import { HistoryExercise, HistorySessionRow, SessionDetail } from './types';
import { summarizeSession } from './logic';

export const HISTORY_PAGE_SIZE = 30;

export async function listCompletedSessions(
  supabase: SupabaseClient,
  userId: string,
  page: number
): Promise<{ sessions: HistorySessionRow[]; hasMore: boolean }> {
  const from = page * HISTORY_PAGE_SIZE;
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id, session_date, routine_days(name), logged_sets(routine_exercise_id, is_deleted)')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('session_date', { ascending: false })
    .order('id')
    .range(from, from + HISTORY_PAGE_SIZE - 1);
  if (error) throw error;

  const sessions = (data as any[]).map((row): HistorySessionRow => ({
    id: row.id,
    sessionDate: row.session_date,
    dayName: row.routine_days?.name ?? '',
    ...summarizeSession(row.logged_sets ?? []),
  }));
  return { sessions, hasMore: sessions.length === HISTORY_PAGE_SIZE };
}

export async function getSessionDetail(supabase: SupabaseClient, sessionId: string): Promise<SessionDetail> {
  const { data: session, error: sessionError } = await supabase
    .from('workout_sessions')
    .select('id, session_date, routine_days(name)')
    .eq('id', sessionId)
    .single();
  if (sessionError) throw sessionError;

  const { data: sets, error: setsError } = await supabase
    .from('logged_sets')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_deleted', false)
    .order('set_index');
  if (setsError) throw setsError;

  const exerciseIds = [...new Set((sets ?? []).map((s) => s.routine_exercise_id as string))];
  let exercises: HistoryExercise[] = [];
  if (exerciseIds.length > 0) {
    // No is_deleted filter: the history shows exercises later removed from the routine.
    const { data, error } = await supabase
      .from('routine_exercises')
      .select('id, order_index, scheme_type, rep_unit, rir_min, exercises(name)')
      .in('id', exerciseIds);
    if (error) throw error;
    exercises = (data as any[]).map((e) => ({
      id: e.id,
      exercise_name: e.exercises?.name ?? '',
      order_index: e.order_index,
      scheme_type: e.scheme_type,
      rep_unit: e.rep_unit,
      rir_min: e.rir_min,
    }));
  }

  return {
    id: session.id,
    sessionDate: session.session_date,
    dayName: (session as any).routine_days?.name ?? '',
    sets: (sets ?? []).map((s) => ({ ...s, weight: Number(s.weight), reps: Number(s.reps) }) as LoggedSet),
    exercises,
  };
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck` (expected: exit 0); `npm run test:unit` (expected: pass); `npx jest --selectProjects unit --listTests` must NOT list `queries.integration.test.ts`.

```bash
git add src/lib/history/queries.ts tests/lib/history/queries.integration.test.ts
git commit -m "feat: add paged completed-session and session-detail queries"
```

---

### Task 4: Correction queueing and the shared SetEditor

**Files:**
- Create: `src/lib/history/submitCorrection.ts`, `src/components/SetEditor.tsx`

**Interfaces:**
- Consumes (Task 2): `SetCorrection`, `SetEditValues`, `validateSetEdit`, `editFromValues`, `buildCorrectionPayload`. Existing: `enqueueWrite(db, id, entity, payload)` from `src/lib/sqlite/pendingWrites.ts`; `WeightStepper({ value, onChange })`; `StepperInput({ value, onChange, min, max, step })`.
- Produces: `queueSetCorrection(db: SQLiteDatabase, set: LoggedSet, change: SetCorrection): void`; `SetEditor(props: { set: LoggedSet | null; exercise: { exercise_name: string; rep_unit: RoutineExerciseRepUnit; rir_min: number | null } | null; onSave: (change: SetCorrection) => Promise<void>; onDelete: () => Promise<void>; onClose: () => void })` — visible whenever `set` is non-null.

No unit test: the decisions live in `logic.ts` (tested in Task 2); this is wiring and UI.

- [ ] **Step 1: Create the queue helper**

`src/lib/history/submitCorrection.ts`:

```typescript
import * as Crypto from 'expo-crypto';
import { SQLiteDatabase } from 'expo-sqlite';
import { enqueueWrite } from '../sqlite/pendingWrites';
import { LoggedSet } from '../sessions/types';
import { SetCorrection } from './types';
import { buildCorrectionPayload } from './logic';

/** Queues a correction as a full-row upsert. The queue id is fresh, so repeated corrections never collide. */
export function queueSetCorrection(db: SQLiteDatabase, set: LoggedSet, change: SetCorrection): void {
  enqueueWrite(db, Crypto.randomUUID(), 'logged_sets', buildCorrectionPayload(set, change));
}
```

- [ ] **Step 2: Create the editor**

`src/components/SetEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Alert } from 'react-native';
import { RoutineExerciseRepUnit } from '../lib/routines/types';
import { LoggedSet } from '../lib/sessions/types';
import { SetCorrection, SetEditValues } from '../lib/history/types';
import { editFromValues, validateSetEdit } from '../lib/history/logic';
import { formatSetLabel } from '../lib/history/format';
import { WeightStepper } from './WeightStepper';
import { StepperInput } from './StepperInput';

const RIR_OPTIONS = [0, 1, 2, 3, 4];

interface SetEditorProps {
  set: LoggedSet | null;
  exercise: { exercise_name: string; rep_unit: RoutineExerciseRepUnit; rir_min: number | null } | null;
  onSave: (change: SetCorrection) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

function valuesFrom(set: LoggedSet): SetEditValues {
  return { weight: String(set.weight), reps: String(set.reps), rir: set.rir };
}

export function SetEditor({ set, exercise, onSave, onDelete, onClose }: SetEditorProps) {
  const [values, setValues] = useState<SetEditValues>({ weight: '', reps: '', rir: null });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (set) setValues(valuesFrom(set));
  }, [set]);

  if (!set || !exercise) return null;

  const timeBased = exercise.rep_unit === 'seconds';
  const showRir = exercise.rir_min !== null;
  const problem = validateSetEdit(values, exercise);

  async function handleSave() {
    if (!set || !exercise || problem) return;
    setSaving(true);
    try {
      await onSave(editFromValues(values, exercise, set));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    Alert.alert('Borrar serie', '¿Borrar esta serie?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await onDelete();
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>{exercise.exercise_name}</Text>
        <Text style={styles.subtitle}>{formatSetLabel(set)}</Text>

        {!timeBased && (
          <>
            <Text style={styles.label}>Peso (kg)</Text>
            <WeightStepper value={values.weight} onChange={(weight) => setValues((v) => ({ ...v, weight }))} />
          </>
        )}

        <Text style={styles.label}>{timeBased ? 'Segundos' : 'Reps'}</Text>
        <StepperInput
          value={values.reps}
          onChange={(reps) => setValues((v) => ({ ...v, reps }))}
          min={0}
          max={200}
          step={timeBased ? 5 : 1}
        />

        {showRir && (
          <>
            <Text style={styles.label}>RIR</Text>
            <View style={styles.rirRow}>
              {RIR_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.rirOption, values.rir === option && styles.rirOptionSelected]}
                  onPress={() => setValues((v) => ({ ...v, rir: option }))}
                >
                  <Text style={values.rir === option ? styles.rirTextSelected : styles.rirText}>{option}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {problem && <Text style={styles.problem}>{problem}</Text>}

        <Pressable
          style={[styles.saveButton, (problem !== null || saving) && styles.disabled]}
          disabled={problem !== null || saving}
          onPress={handleSave}
        >
          <Text style={styles.saveText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
        </Pressable>
        <View style={styles.secondaryRow}>
          <Pressable style={[styles.deleteButton, saving && styles.disabled]} disabled={saving} onPress={handleDelete}>
            <Text style={styles.deleteText}>Borrar serie</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} disabled={saving} onPress={onClose}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { color: '#666' },
  label: { fontWeight: '600', marginTop: 4 },
  rirRow: { flexDirection: 'row', gap: 6 },
  rirOption: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  rirOptionSelected: { backgroundColor: '#111', borderColor: '#111' },
  rirText: { color: '#111' },
  rirTextSelected: { color: '#fff' },
  problem: { color: '#dc2626' },
  saveButton: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  saveText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  secondaryRow: { flexDirection: 'row', gap: 8 },
  deleteButton: { flex: 1, borderWidth: 1, borderColor: '#dc2626', borderRadius: 8, padding: 12, alignItems: 'center' },
  deleteText: { color: '#dc2626', fontWeight: '600' },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, alignItems: 'center' },
  cancelText: { color: '#111', fontWeight: '600' },
});
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck` (expected: exit 0); `npm run test:unit` (expected: pass)

```bash
git add src/lib/history/submitCorrection.ts src/components/SetEditor.tsx
git commit -m "feat: add the shared set editor and correction queueing"
```

---

### Task 5: Corrections in the live session

**Files:**
- Modify: `src/hooks/useSessionSets.ts`, `src/components/SessionExerciseCard.tsx`, `app/(app)/session/[sessionId].tsx`

**Interfaces:**
- Consumes: `SetCorrection` (Task 2), `applyCorrection` (Task 2), `queueSetCorrection` (Task 4), `SetEditor` (Task 4). Existing `syncNow(db, supabase, userId)` from `src/lib/sync/syncService.ts`.
- Produces: `useSessionSets(...)` also returns `correctSet: (setId: string, change: SetCorrection) => Promise<void>`; `SessionExerciseCard` takes a new required prop `onCorrectSet: (setId: string, change: SetCorrection) => Promise<void>`.

- [ ] **Step 1: Add `correctSet` to the hook**

In `src/hooks/useSessionSets.ts`:

1. Change the sync import to `import { flushOnly, syncNow } from '../lib/sync/syncService';`
2. Add imports:

```typescript
import { applyCorrection } from '../lib/history/logic';
import { queueSetCorrection } from '../lib/history/submitCorrection';
import { SetCorrection } from '../lib/history/types';
```

3. Add this function right after `completeSession`:

```typescript
  /**
   * Edits or soft-deletes an already-logged set. Never recomputes progression (spec §2); a deleted
   * set's index becomes the next one to log again. Sync afterwards rebuilds the records cache.
   */
  async function correctSet(setId: string, change: SetCorrection) {
    if (!userId) return;
    const set = loggedSets.find((s) => s.id === setId);
    if (!set) return;
    queueSetCorrection(getDatabase(), set, change);
    setLoggedSets((current) => applyCorrection(current, setId, change));
    syncNow(getDatabase(), supabase, userId).catch(() => {});
  }
```

4. Add `correctSet,` to the returned object, after `completeSession,`.

- [ ] **Step 2: Add the ✎ button and editor to the card**

In `src/components/SessionExerciseCard.tsx`:

1. Add imports:

```typescript
import { SetEditor } from './SetEditor';
import { SetCorrection } from '../lib/history/types';
```

2. Add to `SessionExerciseCardProps`:

```typescript
  onCorrectSet: (setId: string, change: SetCorrection) => Promise<void>;
```

3. Destructure it: `export function SessionExerciseCard({ exercise, initialWeight, loggedSets, onLogSet, onCorrectSet }: SessionExerciseCardProps) {`
4. Below the existing `useState` calls add:

```typescript
  const [editingSet, setEditingSet] = useState<LoggedSet | null>(null);
```

5. Replace the logged-row `<View key={set.setIndex} style={styles.loggedRow}>…</View>` with:

```tsx
          <View key={set.setIndex} style={styles.loggedRow}>
            <Text style={[styles.loggedText, styles.loggedTextFlex]}>
              ✓ Serie {set.setIndex} ({SET_TYPE_LABELS[set.setType]}): {logged.weight}kg × {logged.reps}
              {exercise.rep_unit === 'seconds' ? 's' : ' reps'}
              {logged.rir !== null ? ` · RIR ${logged.rir}` : ''}
            </Text>
            <Pressable onPress={() => setEditingSet(logged)} hitSlop={8} accessibilityLabel="Corregir serie">
              <Text style={styles.editIcon}>✎</Text>
            </Pressable>
          </View>
```

6. Just before the closing `</View>` of the card (after the `nextSet ? … : …` block) add:

```tsx
      <SetEditor
        set={editingSet}
        exercise={exercise}
        onClose={() => setEditingSet(null)}
        onSave={async (change) => {
          if (!editingSet) return;
          await onCorrectSet(editingSet.id, change);
          setEditingSet(null);
        }}
        onDelete={async () => {
          if (!editingSet) return;
          await onCorrectSet(editingSet.id, { kind: 'delete' });
          setEditingSet(null);
        }}
      />
```

7. In `styles`, change `loggedRow` to add `flexDirection: 'row', alignItems: 'center', gap: 8,` and add:

```typescript
  loggedTextFlex: { flex: 1 },
  editIcon: { fontSize: 18, color: '#166534', paddingHorizontal: 4 },
```

- [ ] **Step 3: Wire the screen**

In `app/(app)/session/[sessionId].tsx`: add `correctSet,` to the destructured `useSessionSets(sessionId)` result, and pass `onCorrectSet={correctSet}` to `<SessionExerciseCard …/>`.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck` (expected: exit 0); `npm run test:unit` (expected: pass)

```bash
git add src/hooks/useSessionSets.ts src/components/SessionExerciseCard.tsx "app/(app)/session/[sessionId].tsx"
git commit -m "feat: correct or delete logged sets during a session"
```

---

### Task 6: History hooks, list screen, drawer entry, tappable recent activity

**Files:**
- Create: `src/hooks/useSessionHistory.ts`, `app/(app)/history/_layout.tsx`, `app/(app)/history/index.tsx`
- Modify: `app/(app)/_layout.tsx`, `app/(app)/index.tsx`

**Interfaces:**
- Consumes: `listCompletedSessions`, `getSessionDetail` (Task 3); `applyCorrection` (Task 2); `queueSetCorrection` (Task 4); `formatSessionTitle` (Task 2); `HistorySessionRow`, `SessionDetail`, `SetCorrection` (Task 2). Existing `useAuthSession`, `syncNow`, `getDatabase`, `supabase`.
- Produces: `HISTORY_OFFLINE_MESSAGE`; `useSessionHistory(userId: string | undefined): { sessions: HistorySessionRow[]; isLoading: boolean; error: string | null; hasMore: boolean; isLoadingMore: boolean; loadMoreError: boolean; loadMore: () => Promise<void>; refetch: () => Promise<void> }`; `useSessionDetail(sessionId: string | undefined): { detail: SessionDetail | null; isLoading: boolean; error: string | null; refetch: () => Promise<void>; correctSet: (setId: string, change: SetCorrection) => Promise<void> }`.

- [ ] **Step 1: Create the hooks**

`src/hooks/useSessionHistory.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getDatabase } from '../lib/sqlite/db';
import { syncNow } from '../lib/sync/syncService';
import { getSessionDetail, listCompletedSessions } from '../lib/history/queries';
import { applyCorrection } from '../lib/history/logic';
import { queueSetCorrection } from '../lib/history/submitCorrection';
import { HistorySessionRow, SessionDetail, SetCorrection } from '../lib/history/types';
import { useAuthSession } from './useAuthSession';

export const HISTORY_OFFLINE_MESSAGE = 'Conectate para ver tu historial';

// Refetch on focus; a request counter keeps an older in-flight response from overwriting newer state.
export function useSessionHistory(userId: string | undefined) {
  const [sessions, setSessions] = useState<HistorySessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const latestRequest = useRef(0);
  const nextPage = useRef(0);

  const refetch = useCallback(async () => {
    if (!userId) return;
    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setError(null);
    setLoadMoreError(false);
    try {
      const result = await listCompletedSessions(supabase, userId, 0);
      if (requestId !== latestRequest.current) return;
      setSessions(result.sessions);
      setHasMore(result.hasMore);
      nextPage.current = 1;
    } catch {
      if (requestId === latestRequest.current) setError(HISTORY_OFFLINE_MESSAGE);
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, [userId]);

  const loadMore = useCallback(async () => {
    if (!userId || !hasMore || isLoadingMore || isLoading) return;
    const requestId = latestRequest.current;
    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      const result = await listCompletedSessions(supabase, userId, nextPage.current);
      if (requestId !== latestRequest.current) return;
      setSessions((current) => [...current, ...result.sessions]);
      setHasMore(result.hasMore);
      nextPage.current += 1;
    } catch {
      // Keep the rows already shown; the list offers a retry row at the end (spec §5.2).
      if (requestId === latestRequest.current) setLoadMoreError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [userId, hasMore, isLoadingMore, isLoading]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { sessions, isLoading, error, hasMore, isLoadingMore, loadMoreError, loadMore, refetch };
}

export function useSessionDetail(sessionId: string | undefined) {
  const { session } = useAuthSession();
  const userId = session?.user.id;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refetch = useCallback(async () => {
    if (!sessionId) return;
    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await getSessionDetail(supabase, sessionId);
      if (requestId === latestRequest.current) setDetail(result);
    } catch {
      if (requestId === latestRequest.current) setError(HISTORY_OFFLINE_MESSAGE);
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  /** Queues the correction, updates the screen immediately, then syncs (rebuilds the records cache). */
  const correctSet = useCallback(
    async (setId: string, change: SetCorrection) => {
      const set = detail?.sets.find((s) => s.id === setId);
      if (!set || !userId) return;
      queueSetCorrection(getDatabase(), set, change);
      setDetail((current) => (current ? { ...current, sets: applyCorrection(current.sets, setId, change) } : current));
      syncNow(getDatabase(), supabase, userId).catch(() => {});
    },
    [detail, userId]
  );

  return { detail, isLoading, error, refetch, correctSet };
}
```

- [ ] **Step 2: Create the stack layout**

`app/(app)/history/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function HistoryLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 3: Create the list screen**

`app/(app)/history/index.tsx`:

```tsx
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useSessionHistory } from '../../../src/hooks/useSessionHistory';
import { formatSessionTitle } from '../../../src/lib/history/format';

export default function HistoryList() {
  const { session } = useAuthSession();
  const { sessions, isLoading, error, isLoadingMore, loadMoreError, loadMore, refetch } = useSessionHistory(
    session?.user.id
  );

  if (isLoading && sessions.length === 0) {
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

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={sessions}
      keyExtractor={(item) => item.id}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <Text style={styles.message}>Todavía no hay sesiones. Completá tu primera sesión para verla acá.</Text>
      }
      ListFooterComponent={
        isLoadingMore ? (
          <ActivityIndicator style={styles.footer} />
        ) : loadMoreError ? (
          <Pressable style={styles.footerRetry} onPress={loadMore}>
            <Text style={styles.footerRetryText}>No se pudieron cargar más sesiones. Reintentar</Text>
          </Pressable>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => router.push(`/(app)/history/${item.id}` as any)}>
          <View style={styles.rowMain}>
            <Text style={styles.title}>{formatSessionTitle(item.sessionDate, item.dayName)}</Text>
            <Text style={styles.subtitle}>
              {item.exerciseCount} {item.exerciseCount === 1 ? 'ejercicio' : 'ejercicios'} · {item.setCount}{' '}
              {item.setCount === 1 ? 'serie' : 'series'}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
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
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#666', marginTop: 2, fontSize: 12 },
  chevron: { fontSize: 22, color: '#999', marginLeft: 8 },
  footer: { marginVertical: 16 },
  footerRetry: { padding: 16, alignItems: 'center' },
  footerRetryText: { color: '#111', fontWeight: '600' },
});
```

- [ ] **Step 4: Add the drawer entry**

In `app/(app)/_layout.tsx`, directly after the `progress` `Drawer.Screen`, add:

```tsx
      <Drawer.Screen name="history" options={{ title: 'Historial', swipeEnabled: false }} />
```

- [ ] **Step 5: Make Home's recent activity tappable**

In `app/(app)/index.tsx`, replace the recent-activity map:

```tsx
                  {recentActivity.map((entry, index) => (
                    <Text key={index} style={styles.activityRow}>
                      {entry.dayName} — {formatShortDate(entry.sessionDate)}
                    </Text>
                  ))}
```

with:

```tsx
                  {recentActivity.map((entry) => (
                    <Pressable
                      key={entry.sessionId}
                      style={styles.activityPressable}
                      onPress={() => router.push(`/(app)/history/${entry.sessionId}` as any)}
                    >
                      <Text style={styles.activityRow}>
                        {entry.dayName} — {formatShortDate(entry.sessionDate)}
                      </Text>
                      <Text style={styles.activityChevron}>›</Text>
                    </Pressable>
                  ))}
```

and add to `styles`:

```typescript
  activityPressable: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  activityChevron: { fontSize: 18, color: '#999' },
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck` (expected: exit 0); `npm run test:unit` (expected: pass)

```bash
git add src/hooks/useSessionHistory.ts "app/(app)/history/_layout.tsx" "app/(app)/history/index.tsx" "app/(app)/_layout.tsx" "app/(app)/index.tsx"
git commit -m "feat: add Historial list, drawer entry, and tappable recent activity"
```

---

### Task 7: Session detail screen

**Files:**
- Create: `app/(app)/history/[sessionId].tsx`

**Interfaces:**
- Consumes: `useSessionDetail` (Task 6); `groupSessionSets` (Task 2); `formatSessionTitle`, `formatSetLabel`, `formatSetValues` (Task 2); `SetEditor` (Task 4); `HistoryExercise` (Task 2); `LoggedSet`.

- [ ] **Step 1: Create the screen**

`app/(app)/history/[sessionId].tsx`:

```tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSessionDetail } from '../../../src/hooks/useSessionHistory';
import { groupSessionSets } from '../../../src/lib/history/logic';
import { formatSessionTitle, formatSetLabel, formatSetValues } from '../../../src/lib/history/format';
import { HistoryExercise } from '../../../src/lib/history/types';
import { LoggedSet } from '../../../src/lib/sessions/types';
import { SetEditor } from '../../../src/components/SetEditor';

export default function SessionHistoryDetail() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { detail, isLoading, error, refetch, correctSet } = useSessionDetail(sessionId);
  const [editing, setEditing] = useState<{ set: LoggedSet; exercise: HistoryExercise } | null>(null);
  const [corrected, setCorrected] = useState(false);

  const groups = useMemo(() => (detail ? groupSessionSets(detail.sets, detail.exercises) : []), [detail]);

  if (isLoading && !detail) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{error ?? 'Conectate para ver tu historial'}</Text>
        <Pressable style={styles.retryButton} onPress={refetch}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  async function finish(change: Parameters<typeof correctSet>[1]) {
    if (!editing) return;
    await correctSet(editing.set.id, change);
    setEditing(null);
    setCorrected(true);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.backRow}>
        <Text style={styles.back}>←</Text>
        <Text style={styles.title}>{formatSessionTitle(detail.sessionDate, detail.dayName)}</Text>
      </Pressable>

      {corrected && (
        <Text style={styles.note}>Corregido. El peso sugerido no cambia; si quedó mal, ajustalo en tu próxima sesión.</Text>
      )}

      {groups.length === 0 && <Text style={styles.message}>Esta sesión no tiene series.</Text>}

      {groups.map(({ exercise, sets }) => (
        <View key={exercise.id} style={styles.card}>
          <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
          {sets.map((set) => (
            <View key={set.id} style={styles.setRow}>
              <Text style={styles.setLabel}>{formatSetLabel(set)}</Text>
              <Text style={styles.setValues}>{formatSetValues(set, exercise.rep_unit)}</Text>
              <Pressable onPress={() => setEditing({ set, exercise })} hitSlop={8} accessibilityLabel="Corregir serie">
                <Text style={styles.editIcon}>✎</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}

      <SetEditor
        set={editing?.set ?? null}
        exercise={editing?.exercise ?? null}
        onClose={() => setEditing(null)}
        onSave={finish}
        onDelete={() => finish({ kind: 'delete' })}
      />
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
  title: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  note: { color: '#166534', backgroundColor: '#f0fdf4', borderRadius: 8, padding: 10 },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, gap: 6 },
  exerciseName: { fontSize: 16, fontWeight: '700' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setLabel: { width: 84, color: '#666' },
  setValues: { flex: 1, fontWeight: '600' },
  editIcon: { fontSize: 18, color: '#111', paddingHorizontal: 4 },
});
```

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck` (expected: exit 0); `npm run test:unit` (expected: pass)

```bash
git add "app/(app)/history/[sessionId].tsx"
git commit -m "feat: add the session detail screen with set corrections"
```

---

### Task 8: Final verification and device checklist

**Files:** none new; fix-ups only.

- [ ] **Step 1: Run every automated check**

Run: `npm run typecheck` (expected: exit 0)
Run: `npm run test:unit` (expected: all pass, including `tests/lib/history/logic.test.ts` and `format.test.ts`)
Run: `npx jest --selectProjects integration --listTests` (expected: lists `tests/lib/history/softDelete.integration.test.ts` and `tests/lib/history/queries.integration.test.ts`; they run in CI)

- [ ] **Step 2: Hand the device checklist to the user (verbatim)**

1. Historial (menú lateral) lista tus sesiones y abre el detalle; una fila de "Actividad reciente" en el Inicio abre el mismo detalle.
2. Corregir el peso de una serie cambia el gráfico de Progreso de ese ejercicio.
3. Borrar la serie que tenía un récord hace que el récord baje.
4. En una sesión en curso, borrar una serie la vuelve a dejar como la próxima para cargar.
5. En modo avión, una corrección se ve al instante y se sincroniza al volver la conexión.

- [ ] **Step 3: Commit any fix-ups** with a failing test first when the problem is in `src/lib/history/`.
