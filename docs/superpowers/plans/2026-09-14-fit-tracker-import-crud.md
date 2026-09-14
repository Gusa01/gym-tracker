# Fit Tracker — Import + Routine CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the two routines defined in `rutina_gym_top_set_back_off.md` into the database, and give the user full create/edit/delete control over routines, days, and exercises from the app.

**Architecture:** A pure Markdown parser (`scripts/parseRoutineMarkdown.ts`) turns the routine document into structured data; a one-time import script (`scripts/import-routine.ts`) runs it against a real user with the service-role key. A data-access layer (`src/lib/routines/queries.ts`, `src/lib/routines/mutations.ts`) wraps the routine tables from the Foundation plan's schema. Four Expo Router screens (routines list, create routine, routine editor, day editor) plus one reusable exercise-form component give the user CRUD over everything the parser can produce, using the same soft-delete semantics the schema already enforces.

**Tech Stack:** Same as the Foundation plan (Expo Router, `@supabase/supabase-js`, Jest + `ts-jest`) — no new dependencies. No drag-and-drop or picker library: reordering is a pair of up/down buttons that swap `order_index`; picking an existing routine or exercise is an inline filtered list within the same screen.

**Spec:** `docs/superpowers/specs/2026-09-13-fit-tracker-design.md` (§4 Data model, §5 Import flow, §6 Routine management)

**Prior plan (already implemented and merged to `main`):** `docs/superpowers/plans/2026-09-13-fit-tracker-foundation.md` — this plan builds on its schema (`supabase/migrations/`), Supabase client (`src/lib/supabase.ts`), and auth (`src/hooks/useAuthSession.ts`, `app/(app)/`).

## Global Constraints

- `routines`, `routine_days`, `routine_exercises` are soft-deleted only (`is_deleted = true` via UPDATE) — never a hard DELETE. Every read filters `is_deleted = false` (spec §6).
- `user_exercise_state` is keyed by `(user_id, exercise_id)` — this plan does not touch that table, but nothing it adds may reintroduce a `routine_exercise_id`-keyed shortcut for weight tracking (spec §4).
- Exactly one `routines` row may have `is_active = true` per user at a time (spec §4) — enforced at the database level by this plan's Task 1 (a gap discovered during the Foundation plan's final review).
- `exercises` is a shared catalog: any authenticated user may read and insert; RLS from the Foundation plan already allows this, nothing new is needed for it.
- No automated E2E/UI test suite (spec §11, unchanged from the Foundation plan) — screens in this plan are verified manually; only the parser and the data-access layer (both non-UI) get automated tests.
- The `.md` file is read only by the one-time import script, never by the running app (spec §1).
- `.env.local` holds real secrets for the live hosted Supabase project from the Foundation plan — no task in this plan should ever print, echo, or log its contents.

---

### Task 1: Migration — routine invariants and indexes

**Files:**
- Create: `supabase/migrations/<timestamp>_routine_invariants_and_indexes.sql`
- Create: `tests/db/routine-invariants.test.ts`

**Interfaces:**
- Consumes: the 8 tables and `createAdminClient`/`seedTestRoutine` helpers from the Foundation plan (`tests/helpers/supabaseAdmin.ts`, `tests/helpers/seedTestRoutine.ts`)
- Produces: a partial unique index enforcing "at most one active routine per user"; indexes on every foreign-key column used by this plan's queries — no new exported TypeScript symbols

This closes two gaps the Foundation plan's final review flagged and deferred: no DB-level enforcement of "one active routine," and no indexes on FK columns (this plan's screens query `routine_days`/`routine_exercises` by their parent id constantly, so it's worth doing before those queries exist).

- [ ] **Step 1: Write the failing test**

Create `tests/db/routine-invariants.test.ts`:

```ts
import { createAdminClient } from '../helpers/supabaseAdmin';
import { seedTestRoutine } from '../helpers/seedTestRoutine';

const supabase = createAdminClient();
const testEmail = `routine-invariants-${Date.now()}@example.com`;
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

describe('routine invariants', () => {
  it('rejects a second active routine for the same user', async () => {
    const { routine: routineA } = await seedTestRoutine(supabase, userId);
    await supabase.from('routines').update({ is_active: true }).eq('id', routineA.id);

    const { data: routineB, error: createError } = await supabase
      .from('routines')
      .insert({ user_id: userId, name: `Second Routine ${Date.now()}`, uses_top_set_backoff: false })
      .select()
      .single();
    expect(createError).toBeNull();

    const { error: activateError } = await supabase
      .from('routines')
      .update({ is_active: true })
      .eq('id', routineB!.id);
    expect(activateError).not.toBeNull();
  });

  it('allows a second active routine once the first is deactivated', async () => {
    const { routine: routineA } = await seedTestRoutine(supabase, userId);
    await supabase.from('routines').update({ is_active: true }).eq('id', routineA.id);

    const { data: routineB } = await supabase
      .from('routines')
      .insert({ user_id: userId, name: `Third Routine ${Date.now()}`, uses_top_set_backoff: false })
      .select()
      .single();

    await supabase.from('routines').update({ is_active: false }).eq('id', routineA.id);
    const { error: activateError } = await supabase
      .from('routines')
      .update({ is_active: true })
      .eq('id', routineB!.id);
    expect(activateError).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/db/routine-invariants.test.ts`
Expected: FAIL on the first test — without the invariant, activating a second routine succeeds when it should be rejected.

- [ ] **Step 3: Generate and write the migration**

```bash
npx supabase migration new routine_invariants_and_indexes
```

Replace the generated file's contents with:

```sql
-- One active routine per user at a time (spec §4).
create unique index routines_one_active_per_user
  on public.routines (user_id)
  where is_active and not is_deleted;

-- FK indexes: none of these are automatic in Postgres, and this plan's
-- screens query every one of them by its parent id.
create index routines_user_id_idx on public.routines (user_id);
create index routine_days_routine_id_idx on public.routine_days (routine_id);
create index routine_exercises_routine_day_id_idx on public.routine_exercises (routine_day_id);
create index routine_exercises_exercise_id_idx on public.routine_exercises (exercise_id);
create index user_exercise_state_user_id_idx on public.user_exercise_state (user_id);
create index workout_sessions_user_id_idx on public.workout_sessions (user_id);
create index workout_sessions_routine_day_id_idx on public.workout_sessions (routine_day_id);
create index logged_sets_session_id_idx on public.logged_sets (session_id);
create index logged_sets_routine_exercise_id_idx on public.logged_sets (routine_exercise_id);
create index routine_history_user_id_idx on public.routine_history (user_id);
create index routine_history_routine_id_idx on public.routine_history (routine_id);
```

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db push
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/db/routine-invariants.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full test suite to confirm nothing regressed**

Run: `npx jest`
Expected: all pre-existing tests plus this task's 2 new ones pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/db/routine-invariants.test.ts
git commit -m "feat: enforce one active routine per user and add FK indexes"
```

---

### Task 2: Markdown parser

**Files:**
- Create: `scripts/parseRoutineMarkdown.ts`
- Create: `scripts/parseRoutineMarkdown.test.ts`

**Interfaces:**
- Consumes: nothing (pure function over a markdown string)
- Produces:
  ```ts
  export interface ParsedExercise {
    name: string;
    role: 'main' | 'accessory' | 'core';
    schemeType: 'normal' | 'top_set_backoff';
    repUnit: 'reps' | 'seconds';
    sets: number | null;
    repMin: number | null;
    repMax: number | null;
    rirMin: number | null;
    rirMax: number | null;
    topSetReps: number | null;
    backoffSets: number | null;
    backoffRepMin: number | null;
    backoffRepMax: number | null;
  }
  export interface ParsedDay {
    name: string;
    isRestDay: boolean;
    exercises: ParsedExercise[];
  }
  export type WeekdayScheduleEntry = string | { evenWeek: string; oddWeek: string };
  export interface ParsedRoutine {
    name: string;
    usesTopSetBackoff: boolean;
    suggestedDurationWeeks: number | null;
    nextRoutineName: string | null;
    days: ParsedDay[];
    weekdayScheduleByDayName: Record<string, WeekdayScheduleEntry>;
  }
  export function parseRoutineMarkdown(markdown: string): ParsedRoutine[];
  ```
  `weekdayScheduleByDayName` and `nextRoutineName` use **names**, not ids — the parser never touches the database. Task 3's import script resolves names to real ids after inserting rows.

This is the highest-risk file in the plan — the source document mixes several row shapes across two phases. Read the whole task before writing code; the regexes below are exact, not illustrative.

- [ ] **Step 1: Write the failing tests**

Create `scripts/parseRoutineMarkdown.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { parseRoutineMarkdown } from './parseRoutineMarkdown';

const fixture = fs.readFileSync(
  path.join(__dirname, '..', 'rutina_gym_top_set_back_off.md'),
  'utf-8'
);

describe('parseRoutineMarkdown', () => {
  const routines = parseRoutineMarkdown(fixture);

  it('parses exactly two routines: Full Body and Split 5 días', () => {
    expect(routines.map((r) => r.name)).toEqual(['Full Body', 'Split 5 días']);
  });

  describe('Full Body routine', () => {
    const fullBody = routines[0];

    it('has suggestedDurationWeeks 4 and points to the Split routine', () => {
      expect(fullBody.usesTopSetBackoff).toBe(false);
      expect(fullBody.suggestedDurationWeeks).toBe(4);
      expect(fullBody.nextRoutineName).toBe('Split 5 días');
    });

    it('has Día A, Día B, and Core days — no Día C', () => {
      expect(fullBody.days.map((d) => d.name)).toEqual(['Día A', 'Día B', 'Core']);
    });

    it('maps weekdays including the Friday alternation, with no Saturday/Sunday', () => {
      expect(fullBody.weekdayScheduleByDayName).toEqual({
        mon: 'Día A',
        tue: 'Core',
        wed: 'Día B',
        thu: 'Core',
        fri: { evenWeek: 'Día A', oddWeek: 'Día B' },
      });
    });

    it('parses Día A exercises with roles and a normal scheme', () => {
      const diaA = fullBody.days.find((d) => d.name === 'Día A')!;
      expect(diaA.isRestDay).toBe(false);
      expect(diaA.exercises).toHaveLength(6);

      const sentadilla = diaA.exercises[0];
      expect(sentadilla.name).toBe('Sentadilla (o Prensa)');
      expect(sentadilla.role).toBe('main');
      expect(sentadilla.schemeType).toBe('normal');
      expect(sentadilla.repUnit).toBe('reps');
      expect(sentadilla.sets).toBe(3);
      expect(sentadilla.repMin).toBe(8);
      expect(sentadilla.repMax).toBe(10);
      expect(sentadilla.rirMin).toBe(2);
      expect(sentadilla.rirMax).toBe(3);

      const curlBiceps = diaA.exercises[4];
      expect(curlBiceps.name).toBe('Curl bíceps');
      expect(curlBiceps.role).toBe('accessory');
      expect(curlBiceps.sets).toBe(2);
      expect(curlBiceps.repMin).toBe(12);
      expect(curlBiceps.repMax).toBe(12);
    });

    it('strips a per-side suffix like "/pierna" from the rep range', () => {
      const diaB = fullBody.days.find((d) => d.name === 'Día B')!;
      const zancadas = diaB.exercises.find((e) => e.name === 'Zancadas')!;
      expect(zancadas.role).toBe('accessory');
      expect(zancadas.sets).toBe(2);
      expect(zancadas.repMin).toBe(10);
      expect(zancadas.repMax).toBe(10);
    });

    it('parses the Core day as seconds-based and reps-based exercises with no RIR', () => {
      const core = fullBody.days.find((d) => d.name === 'Core')!;
      expect(core.isRestDay).toBe(false);
      expect(core.exercises).toHaveLength(4);

      const plancha = core.exercises[0];
      expect(plancha.name).toBe('Plancha');
      expect(plancha.role).toBe('core');
      expect(plancha.repUnit).toBe('seconds');
      expect(plancha.sets).toBe(3);
      expect(plancha.repMin).toBe(30);
      expect(plancha.repMax).toBe(40);
      expect(plancha.rirMin).toBeNull();
      expect(plancha.rirMax).toBeNull();

      const antiRotacion = core.exercises[3];
      expect(antiRotacion.name).toBe('Anti-rotación (Pallof press o similar)');
      expect(antiRotacion.repUnit).toBe('reps');
      expect(antiRotacion.repMin).toBe(10);
      expect(antiRotacion.repMax).toBe(12);
    });
  });

  describe('Split 5 días routine', () => {
    const split = routines[1];

    it('has no suggestedDurationWeeks and no next routine', () => {
      expect(split.usesTopSetBackoff).toBe(true);
      expect(split.suggestedDurationWeeks).toBeNull();
      expect(split.nextRoutineName).toBeNull();
    });

    it('has six days including a genuine rest day', () => {
      expect(split.days.map((d) => d.name)).toEqual([
        'Upper',
        'Lower',
        'Descanso',
        'Push',
        'Pull',
        'Legs',
      ]);
      const descanso = split.days.find((d) => d.name === 'Descanso')!;
      expect(descanso.isRestDay).toBe(true);
      expect(descanso.exercises).toEqual([]);
    });

    it('maps all six weekdays with no alternation', () => {
      expect(split.weekdayScheduleByDayName).toEqual({
        mon: 'Upper',
        tue: 'Lower',
        wed: 'Descanso',
        thu: 'Push',
        fri: 'Pull',
        sat: 'Legs',
      });
    });

    it('parses a top_set_backoff row, taking the low end of a top-set range and the first RIR pair', () => {
      const upper = split.days.find((d) => d.name === 'Upper')!;
      const pressBanca = upper.exercises[0];
      expect(pressBanca.name).toBe('Press banca');
      expect(pressBanca.role).toBe('main');
      expect(pressBanca.schemeType).toBe('top_set_backoff');
      expect(pressBanca.topSetReps).toBe(5);
      expect(pressBanca.backoffSets).toBe(2);
      expect(pressBanca.backoffRepMin).toBe(8);
      expect(pressBanca.backoffRepMax).toBe(10);
      expect(pressBanca.rirMin).toBe(1);
      expect(pressBanca.rirMax).toBe(2);
      expect(pressBanca.sets).toBeNull();
      expect(pressBanca.repMin).toBeNull();
      expect(pressBanca.repMax).toBeNull();
    });

    it('parses a top_set_backoff row with a single-number top set', () => {
      const upper = split.days.find((d) => d.name === 'Upper')!;
      const remo = upper.exercises[1];
      expect(remo.name).toBe('Remo con barra o mancuerna');
      expect(remo.topSetReps).toBe(6);
    });

    it('treats a normal-scheme row in a top_set_backoff routine as an accessory', () => {
      const upper = split.days.find((d) => d.name === 'Upper')!;
      const pressMilitar = upper.exercises[2];
      expect(pressMilitar.name).toBe('Press militar');
      expect(pressMilitar.role).toBe('accessory');
      expect(pressMilitar.schemeType).toBe('normal');
      expect(pressMilitar.sets).toBe(2);
      expect(pressMilitar.repMin).toBe(8);
      expect(pressMilitar.repMax).toBe(10);
    });

    it('splits a compound "**Core:**" row into two separate core exercises', () => {
      const lower = split.days.find((d) => d.name === 'Lower')!;
      const coreExercises = lower.exercises.filter((e) => e.role === 'core');
      expect(coreExercises).toHaveLength(2);

      expect(coreExercises[0].name).toBe('Plancha');
      expect(coreExercises[0].repUnit).toBe('seconds');
      expect(coreExercises[0].repMin).toBe(30);
      expect(coreExercises[0].repMax).toBe(40);
      expect(coreExercises[0].rirMin).toBeNull();

      expect(coreExercises[1].name).toBe('Elevación de piernas');
      expect(coreExercises[1].repUnit).toBe('reps');
      expect(coreExercises[1].repMin).toBe(12);
      expect(coreExercises[1].repMax).toBe(12);
    });

    it('splits the Pull day compound Core row too', () => {
      const pull = split.days.find((d) => d.name === 'Pull')!;
      const coreExercises = pull.exercises.filter((e) => e.role === 'core');
      expect(coreExercises).toHaveLength(2);
      expect(coreExercises[0].name).toBe('Rueda abdominal o Pallof press');
      expect(coreExercises[0].repMin).toBe(10);
      expect(coreExercises[0].repMax).toBe(12);
      expect(coreExercises[1].name).toBe('Anti-rotación');
      expect(coreExercises[1].repMin).toBe(10);
      expect(coreExercises[1].repMax).toBe(12);
    });

    it('parses the optional Legs day', () => {
      const legs = split.days.find((d) => d.name === 'Legs')!;
      expect(legs.exercises).toHaveLength(3);
      expect(legs.exercises[0].name).toBe('Prensa o Sentadilla');
      expect(legs.exercises[0].schemeType).toBe('top_set_backoff');
      expect(legs.exercises[0].topSetReps).toBe(8);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest scripts/parseRoutineMarkdown.test.ts`
Expected: FAIL — `scripts/parseRoutineMarkdown.ts` doesn't exist.

- [ ] **Step 3: Implement the parser**

Create `scripts/parseRoutineMarkdown.ts`:

```ts
export interface ParsedExercise {
  name: string;
  role: 'main' | 'accessory' | 'core';
  schemeType: 'normal' | 'top_set_backoff';
  repUnit: 'reps' | 'seconds';
  sets: number | null;
  repMin: number | null;
  repMax: number | null;
  rirMin: number | null;
  rirMax: number | null;
  topSetReps: number | null;
  backoffSets: number | null;
  backoffRepMin: number | null;
  backoffRepMax: number | null;
}

export interface ParsedDay {
  name: string;
  isRestDay: boolean;
  exercises: ParsedExercise[];
}

export type WeekdayScheduleEntry = string | { evenWeek: string; oddWeek: string };

export interface ParsedRoutine {
  name: string;
  usesTopSetBackoff: boolean;
  suggestedDurationWeeks: number | null;
  nextRoutineName: string | null;
  days: ParsedDay[];
  weekdayScheduleByDayName: Record<string, WeekdayScheduleEntry>;
}

// Matches "3×8-10", "2×12", "2×10/pierna", "3×30-40s", "2×10-12/lado".
const REPS_CELL = /^(\d+)×(\d+)(?:-(\d+))?(s)?(?:\/\w+)?$/;

// Matches a plain RIR cell like "2-3".
const RIR_CELL = /^(\d+)-(\d+)$/;

// Matches a two-part RIR cell like "1-2 / 2-3" (top set / back-off).
const SPLIT_RIR_CELL = /^(\d+)-(\d+)\s*\/\s*\d+-\d+$/;

// Matches "Top set 1×5-6 + Back-off 2×8-10" or "Top set 1×6 + Back-off 2×8-10".
const TOP_SET_BACKOFF_CELL =
  /^Top set (\d+)×(\d+)(?:-(\d+))?\s*\+\s*Back-off (\d+)×(\d+)-(\d+)$/;

function parseRepsCell(cell: string): {
  sets: number;
  repMin: number;
  repMax: number;
  repUnit: 'reps' | 'seconds';
} {
  const match = REPS_CELL.exec(cell.trim());
  if (!match) {
    throw new Error(`Unrecognized reps cell: "${cell}"`);
  }
  const [, sets, min, max, seconds] = match;
  return {
    sets: Number(sets),
    repMin: Number(min),
    repMax: max ? Number(max) : Number(min),
    repUnit: seconds ? 'seconds' : 'reps',
  };
}

function parseRir(cell: string): { rirMin: number | null; rirMax: number | null } {
  const trimmed = cell.trim();
  const split = SPLIT_RIR_CELL.exec(trimmed);
  if (split) {
    return { rirMin: Number(split[1]), rirMax: Number(split[2]) };
  }
  const plain = RIR_CELL.exec(trimmed);
  if (plain) {
    return { rirMin: Number(plain[1]), rirMax: Number(plain[2]) };
  }
  return { rirMin: null, rirMax: null };
}

function inferPhase1Role(exerciseCell: string): 'main' | 'accessory' {
  return exerciseCell.includes('movimiento completo') ? 'main' : 'accessory';
}

function stripPhase1RoleSuffix(exerciseCell: string): string {
  return exerciseCell
    .replace(/\s*—\s*movimiento completo$/, '')
    .replace(/\s*\(accesorio[^)]*\)$/, '')
    .trim();
}

function parseCoreCompoundRow(exerciseCell: string): ParsedExercise[] {
  const body = exerciseCell.replace(/^\*\*Core:\*\*\s*/, '');
  return body.split(' + ').map((part) => {
    const match = /^(.+?)\s+(\d+×\d+(?:-\d+)?s?(?:\/\w+)?)$/.exec(part.trim());
    if (!match) {
      throw new Error(`Unrecognized compound core entry: "${part}"`);
    }
    const [, name, repsCell] = match;
    const { sets, repMin, repMax, repUnit } = parseRepsCell(repsCell);
    return {
      name: name.trim(),
      role: 'core',
      schemeType: 'normal',
      repUnit,
      sets,
      repMin,
      repMax,
      rirMin: null,
      rirMax: null,
      topSetReps: null,
      backoffSets: null,
      backoffRepMin: null,
      backoffRepMax: null,
    };
  });
}

function splitTableRows(tableBlock: string): string[][] {
  return tableBlock
    .trim()
    .split('\n')
    .slice(2) // drop the header row and the |---|---| separator
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
    );
}

function parsePhase1Day(name: string, tableBlock: string): ParsedDay {
  const rows = splitTableRows(tableBlock);
  const hasRirColumn = rows.length === 0 || rows[0].length === 3;
  const exercises: ParsedExercise[] = rows.map((row) => {
    const exerciseCell = row[0];
    const repsCell = row[1];
    const rirCell = hasRirColumn ? row[2] : null;
    const { sets, repMin, repMax, repUnit } = parseRepsCell(repsCell);
    const { rirMin, rirMax } = rirCell ? parseRir(rirCell) : { rirMin: null, rirMax: null };
    const role = hasRirColumn ? inferPhase1Role(exerciseCell) : 'core';
    return {
      name: hasRirColumn ? stripPhase1RoleSuffix(exerciseCell) : exerciseCell.trim(),
      role,
      schemeType: 'normal',
      repUnit,
      sets,
      repMin,
      repMax,
      rirMin,
      rirMax,
      topSetReps: null,
      backoffSets: null,
      backoffRepMin: null,
      backoffRepMax: null,
    };
  });
  return { name, isRestDay: false, exercises };
}

function parsePhase2Day(name: string, tableBlock: string | null): ParsedDay {
  if (tableBlock === null) {
    return { name, isRestDay: true, exercises: [] };
  }
  const rows = splitTableRows(tableBlock);
  const exercises: ParsedExercise[] = rows.flatMap((row) => {
    const [exerciseCell, schemeCell, rirCell] = row;

    if (exerciseCell.startsWith('**Core:**')) {
      return parseCoreCompoundRow(exerciseCell);
    }

    const topSetMatch = TOP_SET_BACKOFF_CELL.exec(schemeCell.trim());
    if (topSetMatch) {
      const [, , topMin, , backoffSets, backoffMin, backoffMax] = topSetMatch;
      const { rirMin, rirMax } = parseRir(rirCell);
      return [
        {
          name: exerciseCell.trim(),
          role: 'main',
          schemeType: 'top_set_backoff',
          repUnit: 'reps',
          sets: null,
          repMin: null,
          repMax: null,
          rirMin,
          rirMax,
          topSetReps: Number(topMin),
          backoffSets: Number(backoffSets),
          backoffRepMin: Number(backoffMin),
          backoffRepMax: Number(backoffMax),
        },
      ];
    }

    const { sets, repMin, repMax, repUnit } = parseRepsCell(schemeCell);
    const { rirMin, rirMax } = parseRir(rirCell);
    return [
      {
        name: exerciseCell.trim(),
        role: 'accessory',
        schemeType: 'normal',
        repUnit,
        sets,
        repMin,
        repMax,
        rirMin,
        rirMax,
        topSetReps: null,
        backoffSets: null,
        backoffRepMin: null,
        backoffRepMax: null,
      },
    ];
  });
  return { name, isRestDay: false, exercises };
}

function extractTableBlock(afterHeading: string): string | null {
  const lines = afterHeading.split('\n');
  const tableLines: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      tableLines.push(line);
    } else if (tableLines.length > 0) {
      break;
    } else if (line.trim().startsWith('###') || line.trim().startsWith('##')) {
      break;
    }
  }
  return tableLines.length > 0 ? tableLines.join('\n') : null;
}

function sectionBody(markdown: string, headingPattern: RegExp): string {
  const match = headingPattern.exec(markdown);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextHeading = /\n#{2,3}\s/.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

function parseFullBody(markdown: string): ParsedRoutine {
  const phaseBody = sectionBody(markdown, /## FASE 1 — Full Body[^\n]*\n/);

  const diaABody = sectionBody(phaseBody, /### Día A \(Lun\)\n/);
  const diaBBody = sectionBody(phaseBody, /### Día B \(Mié\)\n/);
  const coreBody = sectionBody(phaseBody, /### Martes y Jueves — Core[^\n]*\n/);

  const diaA = parsePhase1Day('Día A', extractTableBlock(diaABody)!);
  const diaB = parsePhase1Day('Día B', extractTableBlock(diaBBody)!);
  const core = parsePhase1Day('Core', extractTableBlock(coreBody)!);

  return {
    name: 'Full Body',
    usesTopSetBackoff: false,
    suggestedDurationWeeks: 4,
    nextRoutineName: 'Split 5 días',
    days: [diaA, diaB, core],
    weekdayScheduleByDayName: {
      mon: 'Día A',
      tue: 'Core',
      wed: 'Día B',
      thu: 'Core',
      fri: { evenWeek: 'Día A', oddWeek: 'Día B' },
    },
  };
}

function parseSplit(markdown: string): ParsedRoutine {
  const phaseBody = sectionBody(markdown, /## FASE 2 — Split 5 días[^\n]*\n/);

  const dayHeadings: Array<{ name: string; pattern: RegExp; weekday: string }> = [
    { name: 'Upper', pattern: /### Lunes — Upper[^\n]*\n/, weekday: 'mon' },
    { name: 'Lower', pattern: /### Martes — Lower[^\n]*\n/, weekday: 'tue' },
    { name: 'Descanso', pattern: /### Miércoles — Descanso\n/, weekday: 'wed' },
    { name: 'Push', pattern: /### Jueves — Push[^\n]*\n/, weekday: 'thu' },
    { name: 'Pull', pattern: /### Viernes — Pull[^\n]*\n/, weekday: 'fri' },
    { name: 'Legs', pattern: /### Sábado — Legs[^\n]*\n/, weekday: 'sat' },
  ];

  const days: ParsedDay[] = [];
  const weekdayScheduleByDayName: Record<string, WeekdayScheduleEntry> = {};

  for (const { name, pattern, weekday } of dayHeadings) {
    const body = sectionBody(phaseBody, pattern);
    const tableBlock = extractTableBlock(body);
    days.push(parsePhase2Day(name, tableBlock));
    weekdayScheduleByDayName[weekday] = name;
  }

  return {
    name: 'Split 5 días',
    usesTopSetBackoff: true,
    suggestedDurationWeeks: null,
    nextRoutineName: null,
    days,
    weekdayScheduleByDayName,
  };
}

export function parseRoutineMarkdown(markdown: string): ParsedRoutine[] {
  return [parseFullBody(markdown), parseSplit(markdown)];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest scripts/parseRoutineMarkdown.test.ts`
Expected: PASS (all cases in the file). If a specific case fails, the mismatch is almost always in `extractTableBlock`/`sectionBody`'s heading regex not matching the fixture's exact punctuation — read the failing assertion's actual value and compare it character-by-character against `rutina_gym_top_set_back_off.md`, don't guess.

- [ ] **Step 5: Commit**

```bash
git add scripts/parseRoutineMarkdown.ts scripts/parseRoutineMarkdown.test.ts
git commit -m "feat: add pure parser for the routine markdown document"
```

---

### Task 3: Import script

**Files:**
- Create: `scripts/import-routine.ts`
- Create: `tests/scripts/import-routine.test.ts`
- Modify: `package.json` (add `tsx` devDependency and an `import-routine` script)

**Interfaces:**
- Consumes: `parseRoutineMarkdown` (Task 2); `createAdminClient` (Foundation plan, `tests/helpers/supabaseAdmin.ts`)
- Produces: `importRoutine(supabase: SupabaseClient, userId: string, markdown: string): Promise<{ imported: boolean; reason?: string; routineIds?: Record<string, string> }>` — exported for the test; the file's `if` guard at the bottom makes it also runnable directly as `npx tsx scripts/import-routine.ts <email>`

The parser has no idea what a muscle group is (the document doesn't label them in a regex-friendly way), so this task adds a small lookup table mapping every exact exercise name the parser produces to `'upper' | 'lower' | 'core'` — matching spec §8's own upper/lower increment split. An unmapped name throws immediately rather than guessing, since this script runs against one fixed, known document.

- [ ] **Step 1: Install `tsx`**

```bash
npm install --save-dev tsx
```

Add to `package.json` `scripts`:

```json
"import-routine": "tsx scripts/import-routine.ts"
```

- [ ] **Step 2: Write the failing test**

Create `tests/scripts/import-routine.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { createAdminClient } from '../helpers/supabaseAdmin';
import { importRoutine } from '../../scripts/import-routine';

const supabase = createAdminClient();
const fixture = fs.readFileSync(
  path.join(__dirname, '..', '..', 'rutina_gym_top_set_back_off.md'),
  'utf-8'
);
const testEmail = `import-routine-${Date.now()}@example.com`;
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

// The two `it` blocks below depend on running in file order (Jest runs a
// describe block's tests sequentially) — the second exercises idempotency
// against the first's already-imported data, deliberately.
describe('importRoutine', () => {
  it('creates both routines with their days, exercises, and weekday schedule', async () => {
    const result = await importRoutine(supabase, userId, fixture);
    expect(result.imported).toBe(true);
    expect(Object.keys(result.routineIds!)).toEqual(['Full Body', 'Split 5 días']);

    const { data: fullBody } = await supabase
      .from('routines')
      .select('*')
      .eq('id', result.routineIds!['Full Body'])
      .single();
    expect(fullBody.suggested_duration_weeks).toBe(4);
    expect(fullBody.next_routine_id).toBe(result.routineIds!['Split 5 días']);
    expect(fullBody.weekday_schedule.fri).toEqual({
      even_week: expect.any(String),
      odd_week: expect.any(String),
    });

    const { data: fullBodyDays } = await supabase
      .from('routine_days')
      .select('*')
      .eq('routine_id', result.routineIds!['Full Body'])
      .order('order_index');
    expect(fullBodyDays!.map((d) => d.name)).toEqual(['Día A', 'Día B', 'Core']);

    const { data: split } = await supabase
      .from('routines')
      .select('*')
      .eq('id', result.routineIds!['Split 5 días'])
      .single();
    expect(split.next_routine_id).toBeNull();
    expect(split.uses_top_set_backoff).toBe(true);

    const { data: splitDays } = await supabase
      .from('routine_days')
      .select('*')
      .eq('routine_id', result.routineIds!['Split 5 días'])
      .order('order_index');
    const descanso = splitDays!.find((d) => d.name === 'Descanso');
    expect(descanso!.is_rest_day).toBe(true);

    const upperDay = splitDays!.find((d) => d.name === 'Upper')!;
    const { data: upperExercises } = await supabase
      .from('routine_exercises')
      .select('*, exercises(name)')
      .eq('routine_day_id', upperDay.id)
      .order('order_index');
    const pressBanca = upperExercises!.find((e: any) => e.exercises.name === 'Press banca');
    expect(pressBanca.scheme_type).toBe('top_set_backoff');
    expect(pressBanca.top_set_reps).toBe(5);
  });

  it('is idempotent: refuses to re-import for the same user', async () => {
    const result = await importRoutine(supabase, userId, fixture);
    expect(result.imported).toBe(false);
    expect(result.reason).toContain('already exists');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest tests/scripts/import-routine.test.ts`
Expected: FAIL — `scripts/import-routine.ts` doesn't exist.

- [ ] **Step 4: Implement the import script**

Create `scripts/import-routine.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseRoutineMarkdown } from './parseRoutineMarkdown';

export interface ImportResult {
  imported: boolean;
  reason?: string;
  routineIds?: Record<string, string>;
}

const MUSCLE_GROUP_BY_EXERCISE: Record<string, 'upper' | 'lower' | 'core'> = {
  'Sentadilla (o Prensa)': 'lower',
  'Press banca': 'upper',
  'Remo en máquina o mancuerna': 'upper',
  'Press militar mancuernas': 'upper',
  'Curl bíceps': 'upper',
  'Extensión tríceps': 'upper',
  'Peso muerto rumano': 'lower',
  'Jalón al pecho o Dominada asistida': 'upper',
  'Press inclinado mancuernas': 'upper',
  Zancadas: 'lower',
  'Elevaciones laterales': 'upper',
  'Curl femoral o gemelos': 'lower',
  Plancha: 'core',
  'Elevación de piernas colgado o en banco': 'core',
  'Rueda abdominal o Pallof press': 'core',
  'Anti-rotación (Pallof press o similar)': 'core',
  'Remo con barra o mancuerna': 'upper',
  'Press militar': 'upper',
  'Dominadas o Jalón': 'upper',
  Sentadilla: 'lower',
  Prensa: 'lower',
  'Elevación de talón': 'lower',
  'Elevación de piernas': 'core',
  'Aperturas o Cruces en polea': 'upper',
  'Jalón al pecho': 'upper',
  'Remo en máquina': 'upper',
  'Face pulls': 'upper',
  'Curl martillo': 'upper',
  'Anti-rotación': 'core',
  'Prensa o Sentadilla': 'lower',
  'Curl femoral': 'lower',
  Gemelos: 'lower',
};

function muscleGroupForExercise(name: string): 'upper' | 'lower' | 'core' {
  const group = MUSCLE_GROUP_BY_EXERCISE[name];
  if (!group) {
    throw new Error(
      `No muscle_group mapping for exercise "${name}" — add it to MUSCLE_GROUP_BY_EXERCISE.`
    );
  }
  return group;
}

async function findOrCreateExercise(supabase: SupabaseClient, name: string): Promise<string> {
  const { data: existing, error: existingError } = await supabase
    .from('exercises')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing.id;

  const { data: created, error: createError } = await supabase
    .from('exercises')
    .insert({ name, muscle_group: muscleGroupForExercise(name) })
    .select()
    .single();
  if (createError) throw createError;
  return created.id;
}

export async function importRoutine(
  supabase: SupabaseClient,
  userId: string,
  markdown: string
): Promise<ImportResult> {
  const routines = parseRoutineMarkdown(markdown);

  for (const routine of routines) {
    const { data: existing, error: existingError } = await supabase
      .from('routines')
      .select('id')
      .eq('user_id', userId)
      .eq('name', routine.name)
      .eq('is_deleted', false)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return { imported: false, reason: `Routine "${routine.name}" already exists for this user.` };
    }
  }

  const routineIdsByName: Record<string, string> = {};

  for (const routine of routines) {
    const { data: routineRow, error: routineError } = await supabase
      .from('routines')
      .insert({
        user_id: userId,
        name: routine.name,
        uses_top_set_backoff: routine.usesTopSetBackoff,
        suggested_duration_weeks: routine.suggestedDurationWeeks,
      })
      .select()
      .single();
    if (routineError) throw routineError;
    routineIdsByName[routine.name] = routineRow.id;

    const dayIdsByName: Record<string, string> = {};

    for (const [dayIndex, day] of routine.days.entries()) {
      const { data: dayRow, error: dayError } = await supabase
        .from('routine_days')
        .insert({
          routine_id: routineRow.id,
          name: day.name,
          order_index: dayIndex,
          is_rest_day: day.isRestDay,
        })
        .select()
        .single();
      if (dayError) throw dayError;
      dayIdsByName[day.name] = dayRow.id;

      for (const [exerciseIndex, exercise] of day.exercises.entries()) {
        const exerciseId = await findOrCreateExercise(supabase, exercise.name);
        const { error: routineExerciseError } = await supabase.from('routine_exercises').insert({
          routine_day_id: dayRow.id,
          exercise_id: exerciseId,
          order_index: exerciseIndex,
          role: exercise.role,
          scheme_type: exercise.schemeType,
          rep_unit: exercise.repUnit,
          sets: exercise.sets,
          rep_min: exercise.repMin,
          rep_max: exercise.repMax,
          rir_min: exercise.rirMin,
          rir_max: exercise.rirMax,
          top_set_reps: exercise.topSetReps,
          backoff_sets: exercise.backoffSets,
          backoff_rep_min: exercise.backoffRepMin,
          backoff_rep_max: exercise.backoffRepMax,
        });
        if (routineExerciseError) throw routineExerciseError;
      }
    }

    const weekdaySchedule: Record<string, unknown> = {};
    for (const [weekday, entry] of Object.entries(routine.weekdayScheduleByDayName)) {
      weekdaySchedule[weekday] =
        typeof entry === 'string'
          ? dayIdsByName[entry]
          : { even_week: dayIdsByName[entry.evenWeek], odd_week: dayIdsByName[entry.oddWeek] };
    }

    const { error: scheduleError } = await supabase
      .from('routines')
      .update({ weekday_schedule: weekdaySchedule })
      .eq('id', routineRow.id);
    if (scheduleError) throw scheduleError;
  }

  for (const routine of routines) {
    if (!routine.nextRoutineName) continue;
    const { error } = await supabase
      .from('routines')
      .update({ next_routine_id: routineIdsByName[routine.nextRoutineName] })
      .eq('id', routineIdsByName[routine.name]);
    if (error) throw error;
  }

  return { imported: true, routineIds: routineIdsByName };
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/import-routine.ts <user-email>');
    process.exit(1);
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey);

  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  const user = users.users.find((u) => u.email === email);
  if (!user) {
    console.error(`No user found with email ${email}. Sign up in the app first.`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(
    path.join(__dirname, '..', 'rutina_gym_top_set_back_off.md'),
    'utf-8'
  );
  const result = await importRoutine(supabase, user.id, markdown);
  if (!result.imported) {
    console.log(`Import skipped: ${result.reason}`);
    return;
  }
  console.log('Imported routines:', result.routineIds);
}

const isMainModule = process.argv[1]?.endsWith('import-routine.ts') ?? false;
if (isMainModule) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/scripts/import-routine.test.ts`
Expected: PASS (2 tests). If it fails with "No muscle_group mapping for exercise", the parser produced a name not in `MUSCLE_GROUP_BY_EXERCISE` — check the exact string against the fixture and add it; don't loosen the throw into a silent default.

- [ ] **Step 6: Run the full test suite to confirm nothing regressed**

Run: `npx jest`

- [ ] **Step 7: Commit**

```bash
git add scripts/import-routine.ts tests/scripts package.json package-lock.json
git commit -m "feat: add routine import script"
```

---

### Task 4: Domain types and read queries

**Files:**
- Create: `src/lib/routines/types.ts`
- Create: `src/lib/routines/queries.ts`
- Create: `tests/lib/routines/queries.test.ts`

**Interfaces:**
- Consumes: `createAdminClient`, `seedTestRoutine` (Foundation plan)
- Produces:
  ```ts
  export interface Routine { id, user_id, name, uses_top_set_backoff, suggested_duration_weeks, next_routine_id, weekday_schedule, is_active, started_at, is_deleted, created_at }
  export interface RoutineDay { id, routine_id, name, order_index, is_rest_day, is_deleted }
  export interface Exercise { id, name, muscle_group }
  export interface RoutineExercise { id, routine_day_id, exercise_id, order_index, role, scheme_type, rep_unit, sets, rep_min, rep_max, rir_min, rir_max, top_set_reps, backoff_sets, backoff_rep_min, backoff_rep_max, is_deleted }
  export interface RoutineExerciseWithName extends RoutineExercise { exercise_name: string }
  export function listRoutines(supabase, userId): Promise<Routine[]>
  export function getRoutine(supabase, routineId): Promise<Routine | null>
  export function listRoutineDays(supabase, routineId): Promise<RoutineDay[]>
  export function getRoutineDay(supabase, dayId): Promise<RoutineDay | null>
  export function listDayExercises(supabase, dayId): Promise<RoutineExerciseWithName[]>
  export function listExercises(supabase): Promise<Exercise[]>
  ```
  Every function takes the Supabase client explicitly (not imported from `src/lib/supabase.ts` internally) — screens pass the real app client, tests pass the admin client, matching how the Foundation plan's own tests are structured.

- [ ] **Step 1: Write the types**

Create `src/lib/routines/types.ts`:

```ts
export interface Routine {
  id: string;
  user_id: string;
  name: string;
  uses_top_set_backoff: boolean;
  suggested_duration_weeks: number | null;
  next_routine_id: string | null;
  weekday_schedule: Record<string, unknown>;
  is_active: boolean;
  started_at: string | null;
  is_deleted: boolean;
  created_at: string;
}

export interface RoutineDay {
  id: string;
  routine_id: string;
  name: string;
  order_index: number;
  is_rest_day: boolean;
  is_deleted: boolean;
}

export interface Exercise {
  id: string;
  name: string;
  muscle_group: string;
}

export type RoutineExerciseRole = 'main' | 'accessory' | 'core';
export type RoutineExerciseSchemeType = 'normal' | 'top_set_backoff';
export type RoutineExerciseRepUnit = 'reps' | 'seconds';

export interface RoutineExercise {
  id: string;
  routine_day_id: string;
  exercise_id: string;
  order_index: number;
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
  is_deleted: boolean;
}

export interface RoutineExerciseWithName extends RoutineExercise {
  exercise_name: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/routines/queries.test.ts`:

```ts
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import {
  listRoutines,
  getRoutine,
  listRoutineDays,
  getRoutineDay,
  listDayExercises,
  listExercises,
} from '../../../src/lib/routines/queries';

const supabase = createAdminClient();
const testEmail = `routine-queries-${Date.now()}@example.com`;
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

describe('routine queries', () => {
  it('lists routines for a user and fetches one by id', async () => {
    const { routine } = await seedTestRoutine(supabase, userId);

    const routines = await listRoutines(supabase, userId);
    expect(routines.some((r) => r.id === routine.id)).toBe(true);

    const fetched = await getRoutine(supabase, routine.id);
    expect(fetched?.id).toBe(routine.id);
  });

  it('excludes soft-deleted routines from listRoutines and getRoutine', async () => {
    const { routine } = await seedTestRoutine(supabase, userId);
    await supabase.from('routines').update({ is_deleted: true }).eq('id', routine.id);

    const routines = await listRoutines(supabase, userId);
    expect(routines.some((r) => r.id === routine.id)).toBe(false);
    expect(await getRoutine(supabase, routine.id)).toBeNull();
  });

  it('lists days for a routine and excludes soft-deleted ones', async () => {
    const { routine, day } = await seedTestRoutine(supabase, userId);
    const days = await listRoutineDays(supabase, routine.id);
    expect(days.map((d) => d.id)).toContain(day.id);

    await supabase.from('routine_days').update({ is_deleted: true }).eq('id', day.id);
    const daysAfterDelete = await listRoutineDays(supabase, routine.id);
    expect(daysAfterDelete.map((d) => d.id)).not.toContain(day.id);
    expect(await getRoutineDay(supabase, day.id)).toBeNull();
  });

  it('lists exercises for a day joined with their catalog name, and excludes soft-deleted ones', async () => {
    const { day, routineExercise, exercise } = await seedTestRoutine(supabase, userId);
    const exercises = await listDayExercises(supabase, day.id);
    const found = exercises.find((e) => e.id === routineExercise.id);
    expect(found?.exercise_name).toBe(exercise.name);

    await supabase.from('routine_exercises').update({ is_deleted: true }).eq('id', routineExercise.id);
    const afterDelete = await listDayExercises(supabase, day.id);
    expect(afterDelete.map((e) => e.id)).not.toContain(routineExercise.id);
  });

  it('lists the shared exercise catalog', async () => {
    const { exercise } = await seedTestRoutine(supabase, userId);
    const exercises = await listExercises(supabase);
    expect(exercises.some((e) => e.id === exercise.id)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest tests/lib/routines/queries.test.ts`
Expected: FAIL — `src/lib/routines/queries.ts` doesn't exist.

- [ ] **Step 4: Implement the queries**

Create `src/lib/routines/queries.ts`:

```ts
import { SupabaseClient } from '@supabase/supabase-js';
import { Routine, RoutineDay, RoutineExerciseWithName, Exercise } from './types';

export async function listRoutines(supabase: SupabaseClient, userId: string): Promise<Routine[]> {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function getRoutine(
  supabase: SupabaseClient,
  routineId: string
): Promise<Routine | null> {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('id', routineId)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listRoutineDays(
  supabase: SupabaseClient,
  routineId: string
): Promise<RoutineDay[]> {
  const { data, error } = await supabase
    .from('routine_days')
    .select('*')
    .eq('routine_id', routineId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  return data;
}

export async function getRoutineDay(
  supabase: SupabaseClient,
  dayId: string
): Promise<RoutineDay | null> {
  const { data, error } = await supabase
    .from('routine_days')
    .select('*')
    .eq('id', dayId)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDayExercises(
  supabase: SupabaseClient,
  dayId: string
): Promise<RoutineExerciseWithName[]> {
  const { data, error } = await supabase
    .from('routine_exercises')
    .select('*, exercises(name)')
    .eq('routine_day_id', dayId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  return (data as any[]).map((row) => ({
    ...row,
    exercise_name: row.exercises.name,
  }));
}

export async function listExercises(supabase: SupabaseClient): Promise<Exercise[]> {
  const { data, error } = await supabase.from('exercises').select('*').order('name');
  if (error) throw error;
  return data;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/lib/routines/queries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full test suite to confirm nothing regressed**

Run: `npx jest`

- [ ] **Step 7: Commit**

```bash
git add src/lib/routines/types.ts src/lib/routines/queries.ts tests/lib/routines
git commit -m "feat: add routine domain types and read queries"
```

---

### Task 5: Write mutations

**Files:**
- Create: `src/lib/routines/mutations.ts`
- Create: `tests/lib/routines/mutations.test.ts`

**Interfaces:**
- Consumes: `Routine`, `RoutineDay`, `RoutineExercise`, `Exercise`, `RoutineExerciseRole`, `RoutineExerciseSchemeType`, `RoutineExerciseRepUnit` (Task 4, `src/lib/routines/types.ts`); the one-active-routine index (Task 1, enforced at the DB level — `activateRoutine` respects it by construction, deactivating before activating)
- Produces:
  ```ts
  export interface CreateRoutineInput { name, usesTopSetBackoff, suggestedDurationWeeks, nextRoutineId }
  export function createRoutine(supabase, userId, input: CreateRoutineInput): Promise<Routine>
  export function updateRoutine(supabase, routineId, patch: Partial<CreateRoutineInput>): Promise<Routine>
  export function softDeleteRoutine(supabase, routineId): Promise<void>
  export function activateRoutine(supabase, userId, routineId): Promise<void>
  export interface CreateDayInput { name, isRestDay }
  export function createDay(supabase, routineId, input: CreateDayInput): Promise<RoutineDay>
  export function updateDay(supabase, dayId, patch: Partial<CreateDayInput>): Promise<RoutineDay>
  export function softDeleteDay(supabase, dayId): Promise<void>
  export function moveDay(supabase, routineId, dayId, direction: 'up' | 'down'): Promise<void>
  export interface CreateRoutineExerciseInput { exerciseId, role, schemeType, repUnit, sets, repMin, repMax, rirMin, rirMax, topSetReps, backoffSets, backoffRepMin, backoffRepMax }
  export function createRoutineExercise(supabase, dayId, input: CreateRoutineExerciseInput): Promise<RoutineExercise>
  export function updateRoutineExercise(supabase, routineExerciseId, patch: Partial<CreateRoutineExerciseInput>): Promise<RoutineExercise>
  export function softDeleteRoutineExercise(supabase, routineExerciseId): Promise<void>
  export function moveRoutineExercise(supabase, dayId, routineExerciseId, direction: 'up' | 'down'): Promise<void>
  export function findOrCreateExercise(supabase, name, muscleGroup): Promise<Exercise>
  ```
  These are consumed directly by the screens in Tasks 6-8. `activateRoutine` inserting a `routine_history` "started" row and `softDeleteRoutine`/`softDeleteDay` cascading are spec §6/§8 requirements, not incidental — cover them in the tests below, not just the happy path.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/routines/mutations.test.ts`:

```ts
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import {
  createRoutine,
  softDeleteRoutine,
  activateRoutine,
  createDay,
  softDeleteDay,
  moveDay,
  createRoutineExercise,
  softDeleteRoutineExercise,
  moveRoutineExercise,
  findOrCreateExercise,
} from '../../../src/lib/routines/mutations';

const supabase = createAdminClient();
const testEmail = `routine-mutations-${Date.now()}@example.com`;
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

describe('routine mutations', () => {
  it('soft-deletes a routine, cascading to its days and exercises', async () => {
    const { routine, day, routineExercise } = await seedTestRoutine(supabase, userId);
    await softDeleteRoutine(supabase, routine.id);

    const { data: routineRow } = await supabase
      .from('routines')
      .select('is_deleted, is_active')
      .eq('id', routine.id)
      .single();
    expect(routineRow!.is_deleted).toBe(true);
    expect(routineRow!.is_active).toBe(false);

    const { data: dayRow } = await supabase
      .from('routine_days')
      .select('is_deleted')
      .eq('id', day.id)
      .single();
    expect(dayRow!.is_deleted).toBe(true);

    const { data: exerciseRow } = await supabase
      .from('routine_exercises')
      .select('is_deleted')
      .eq('id', routineExercise.id)
      .single();
    expect(exerciseRow!.is_deleted).toBe(true);
  });

  it('activating a routine deactivates the previous one and logs routine_history', async () => {
    const routineA = await createRoutine(supabase, userId, {
      name: `Routine A ${Date.now()}`,
      usesTopSetBackoff: false,
      suggestedDurationWeeks: null,
      nextRoutineId: null,
    });
    const routineB = await createRoutine(supabase, userId, {
      name: `Routine B ${Date.now()}`,
      usesTopSetBackoff: false,
      suggestedDurationWeeks: null,
      nextRoutineId: null,
    });

    await activateRoutine(supabase, userId, routineA.id);
    await activateRoutine(supabase, userId, routineB.id);

    const { data: rows } = await supabase
      .from('routines')
      .select('id, is_active')
      .in('id', [routineA.id, routineB.id]);
    expect(rows!.find((r) => r.id === routineA.id)!.is_active).toBe(false);
    expect(rows!.find((r) => r.id === routineB.id)!.is_active).toBe(true);

    const { data: history } = await supabase
      .from('routine_history')
      .select('*')
      .eq('routine_id', routineB.id)
      .eq('event_type', 'started');
    expect(history!.length).toBe(1);
  });

  it('creates and reorders days, and cascades soft-delete to their exercises', async () => {
    const { routine } = await seedTestRoutine(supabase, userId);
    const dayOne = await createDay(supabase, routine.id, { name: 'Day One', isRestDay: false });
    const dayTwo = await createDay(supabase, routine.id, { name: 'Day Two', isRestDay: false });
    expect(dayTwo.order_index).toBe(dayOne.order_index + 1);

    await moveDay(supabase, routine.id, dayTwo.id, 'up');
    const { data: reordered } = await supabase
      .from('routine_days')
      .select('id, order_index')
      .in('id', [dayOne.id, dayTwo.id])
      .order('order_index');
    expect(reordered![0].id).toBe(dayTwo.id);
    expect(reordered![1].id).toBe(dayOne.id);

    const exercise = await findOrCreateExercise(supabase, `Test Exercise ${Date.now()}`, 'upper');
    const routineExercise = await createRoutineExercise(supabase, dayOne.id, {
      exerciseId: exercise.id,
      role: 'main',
      schemeType: 'normal',
      repUnit: 'reps',
      sets: 3,
      repMin: 8,
      repMax: 10,
      rirMin: 2,
      rirMax: 3,
      topSetReps: null,
      backoffSets: null,
      backoffRepMin: null,
      backoffRepMax: null,
    });

    await softDeleteDay(supabase, dayOne.id);
    const { data: exerciseRow } = await supabase
      .from('routine_exercises')
      .select('is_deleted')
      .eq('id', routineExercise.id)
      .single();
    expect(exerciseRow!.is_deleted).toBe(true);
  });

  it('reorders and soft-deletes exercises within a day', async () => {
    const { day } = await seedTestRoutine(supabase, userId);
    const exerciseOne = await findOrCreateExercise(supabase, `Reorder Exercise A ${Date.now()}`, 'upper');
    const exerciseTwo = await findOrCreateExercise(supabase, `Reorder Exercise B ${Date.now()}`, 'upper');
    const input = {
      role: 'accessory' as const,
      schemeType: 'normal' as const,
      repUnit: 'reps' as const,
      sets: 2,
      repMin: 10,
      repMax: 12,
      rirMin: 2,
      rirMax: 3,
      topSetReps: null,
      backoffSets: null,
      backoffRepMin: null,
      backoffRepMax: null,
    };

    const routineExerciseOne = await createRoutineExercise(supabase, day.id, {
      ...input,
      exerciseId: exerciseOne.id,
    });
    const routineExerciseTwo = await createRoutineExercise(supabase, day.id, {
      ...input,
      exerciseId: exerciseTwo.id,
    });

    await moveRoutineExercise(supabase, day.id, routineExerciseTwo.id, 'up');
    const { data: reordered } = await supabase
      .from('routine_exercises')
      .select('id')
      .in('id', [routineExerciseOne.id, routineExerciseTwo.id])
      .order('order_index');
    expect(reordered![0].id).toBe(routineExerciseTwo.id);
    expect(reordered![1].id).toBe(routineExerciseOne.id);

    await softDeleteRoutineExercise(supabase, routineExerciseOne.id);
    const { data: deletedRow } = await supabase
      .from('routine_exercises')
      .select('is_deleted')
      .eq('id', routineExerciseOne.id)
      .single();
    expect(deletedRow!.is_deleted).toBe(true);
  });

  it('findOrCreateExercise deduplicates by name', async () => {
    const name = `Dedup Exercise ${Date.now()}`;
    const first = await findOrCreateExercise(supabase, name, 'core');
    const second = await findOrCreateExercise(supabase, name, 'core');
    expect(second.id).toBe(first.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/lib/routines/mutations.test.ts`
Expected: FAIL — `src/lib/routines/mutations.ts` doesn't exist.

- [ ] **Step 3: Implement the mutations**

Create `src/lib/routines/mutations.ts`:

```ts
import { SupabaseClient } from '@supabase/supabase-js';
import {
  Routine,
  RoutineDay,
  RoutineExercise,
  Exercise,
  RoutineExerciseRole,
  RoutineExerciseSchemeType,
  RoutineExerciseRepUnit,
} from './types';

export interface CreateRoutineInput {
  name: string;
  usesTopSetBackoff: boolean;
  suggestedDurationWeeks: number | null;
  nextRoutineId: string | null;
}

export async function createRoutine(
  supabase: SupabaseClient,
  userId: string,
  input: CreateRoutineInput
): Promise<Routine> {
  const { data, error } = await supabase
    .from('routines')
    .insert({
      user_id: userId,
      name: input.name,
      uses_top_set_backoff: input.usesTopSetBackoff,
      suggested_duration_weeks: input.suggestedDurationWeeks,
      next_routine_id: input.nextRoutineId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoutine(
  supabase: SupabaseClient,
  routineId: string,
  patch: Partial<CreateRoutineInput>
): Promise<Routine> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.usesTopSetBackoff !== undefined) update.uses_top_set_backoff = patch.usesTopSetBackoff;
  if (patch.suggestedDurationWeeks !== undefined)
    update.suggested_duration_weeks = patch.suggestedDurationWeeks;
  if (patch.nextRoutineId !== undefined) update.next_routine_id = patch.nextRoutineId;

  const { data, error } = await supabase
    .from('routines')
    .update(update)
    .eq('id', routineId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteRoutine(supabase: SupabaseClient, routineId: string): Promise<void> {
  const { data: days, error: daysFetchError } = await supabase
    .from('routine_days')
    .select('id')
    .eq('routine_id', routineId);
  if (daysFetchError) throw daysFetchError;

  const dayIds = (days ?? []).map((d: { id: string }) => d.id);
  if (dayIds.length > 0) {
    const { error: exercisesError } = await supabase
      .from('routine_exercises')
      .update({ is_deleted: true })
      .in('routine_day_id', dayIds);
    if (exercisesError) throw exercisesError;
  }

  const { error: daysError } = await supabase
    .from('routine_days')
    .update({ is_deleted: true })
    .eq('routine_id', routineId);
  if (daysError) throw daysError;

  const { error: routineError } = await supabase
    .from('routines')
    .update({ is_deleted: true, is_active: false })
    .eq('id', routineId);
  if (routineError) throw routineError;
}

export async function activateRoutine(
  supabase: SupabaseClient,
  userId: string,
  routineId: string
): Promise<void> {
  const { error: deactivateError } = await supabase
    .from('routines')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);
  if (deactivateError) throw deactivateError;

  const { error: activateError } = await supabase
    .from('routines')
    .update({ is_active: true, started_at: new Date().toISOString() })
    .eq('id', routineId);
  if (activateError) throw activateError;

  const { error: historyError } = await supabase
    .from('routine_history')
    .insert({ user_id: userId, routine_id: routineId, event_type: 'started' });
  if (historyError) throw historyError;
}

export interface CreateDayInput {
  name: string;
  isRestDay: boolean;
}

export async function createDay(
  supabase: SupabaseClient,
  routineId: string,
  input: CreateDayInput
): Promise<RoutineDay> {
  const { data: existing, error: fetchError } = await supabase
    .from('routine_days')
    .select('order_index')
    .eq('routine_id', routineId)
    .eq('is_deleted', false)
    .order('order_index', { ascending: false })
    .limit(1);
  if (fetchError) throw fetchError;
  const nextOrderIndex = existing && existing.length > 0 ? existing[0].order_index + 1 : 0;

  const { data, error } = await supabase
    .from('routine_days')
    .insert({
      routine_id: routineId,
      name: input.name,
      is_rest_day: input.isRestDay,
      order_index: nextOrderIndex,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDay(
  supabase: SupabaseClient,
  dayId: string,
  patch: Partial<CreateDayInput>
): Promise<RoutineDay> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.isRestDay !== undefined) update.is_rest_day = patch.isRestDay;

  const { data, error } = await supabase
    .from('routine_days')
    .update(update)
    .eq('id', dayId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteDay(supabase: SupabaseClient, dayId: string): Promise<void> {
  const { error: exercisesError } = await supabase
    .from('routine_exercises')
    .update({ is_deleted: true })
    .eq('routine_day_id', dayId);
  if (exercisesError) throw exercisesError;

  const { error: dayError } = await supabase
    .from('routine_days')
    .update({ is_deleted: true })
    .eq('id', dayId);
  if (dayError) throw dayError;
}

export async function moveDay(
  supabase: SupabaseClient,
  routineId: string,
  dayId: string,
  direction: 'up' | 'down'
): Promise<void> {
  const { data, error } = await supabase
    .from('routine_days')
    .select('id, order_index')
    .eq('routine_id', routineId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  const days = data ?? [];

  const index = days.findIndex((d: { id: string }) => d.id === dayId);
  const swapWithIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || swapWithIndex < 0 || swapWithIndex >= days.length) return;

  const current = days[index];
  const swapWith = days[swapWithIndex];

  const { error: error1 } = await supabase
    .from('routine_days')
    .update({ order_index: swapWith.order_index })
    .eq('id', current.id);
  if (error1) throw error1;

  const { error: error2 } = await supabase
    .from('routine_days')
    .update({ order_index: current.order_index })
    .eq('id', swapWith.id);
  if (error2) throw error2;
}

export interface CreateRoutineExerciseInput {
  exerciseId: string;
  role: RoutineExerciseRole;
  schemeType: RoutineExerciseSchemeType;
  repUnit: RoutineExerciseRepUnit;
  sets: number | null;
  repMin: number | null;
  repMax: number | null;
  rirMin: number | null;
  rirMax: number | null;
  topSetReps: number | null;
  backoffSets: number | null;
  backoffRepMin: number | null;
  backoffRepMax: number | null;
}

export async function createRoutineExercise(
  supabase: SupabaseClient,
  dayId: string,
  input: CreateRoutineExerciseInput
): Promise<RoutineExercise> {
  const { data: existing, error: fetchError } = await supabase
    .from('routine_exercises')
    .select('order_index')
    .eq('routine_day_id', dayId)
    .eq('is_deleted', false)
    .order('order_index', { ascending: false })
    .limit(1);
  if (fetchError) throw fetchError;
  const nextOrderIndex = existing && existing.length > 0 ? existing[0].order_index + 1 : 0;

  const { data, error } = await supabase
    .from('routine_exercises')
    .insert({
      routine_day_id: dayId,
      exercise_id: input.exerciseId,
      order_index: nextOrderIndex,
      role: input.role,
      scheme_type: input.schemeType,
      rep_unit: input.repUnit,
      sets: input.sets,
      rep_min: input.repMin,
      rep_max: input.repMax,
      rir_min: input.rirMin,
      rir_max: input.rirMax,
      top_set_reps: input.topSetReps,
      backoff_sets: input.backoffSets,
      backoff_rep_min: input.backoffRepMin,
      backoff_rep_max: input.backoffRepMax,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoutineExercise(
  supabase: SupabaseClient,
  routineExerciseId: string,
  patch: Partial<CreateRoutineExerciseInput>
): Promise<RoutineExercise> {
  const update: Record<string, unknown> = {};
  if (patch.exerciseId !== undefined) update.exercise_id = patch.exerciseId;
  if (patch.role !== undefined) update.role = patch.role;
  if (patch.schemeType !== undefined) update.scheme_type = patch.schemeType;
  if (patch.repUnit !== undefined) update.rep_unit = patch.repUnit;
  if (patch.sets !== undefined) update.sets = patch.sets;
  if (patch.repMin !== undefined) update.rep_min = patch.repMin;
  if (patch.repMax !== undefined) update.rep_max = patch.repMax;
  if (patch.rirMin !== undefined) update.rir_min = patch.rirMin;
  if (patch.rirMax !== undefined) update.rir_max = patch.rirMax;
  if (patch.topSetReps !== undefined) update.top_set_reps = patch.topSetReps;
  if (patch.backoffSets !== undefined) update.backoff_sets = patch.backoffSets;
  if (patch.backoffRepMin !== undefined) update.backoff_rep_min = patch.backoffRepMin;
  if (patch.backoffRepMax !== undefined) update.backoff_rep_max = patch.backoffRepMax;

  const { data, error } = await supabase
    .from('routine_exercises')
    .update(update)
    .eq('id', routineExerciseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteRoutineExercise(
  supabase: SupabaseClient,
  routineExerciseId: string
): Promise<void> {
  const { error } = await supabase
    .from('routine_exercises')
    .update({ is_deleted: true })
    .eq('id', routineExerciseId);
  if (error) throw error;
}

export async function moveRoutineExercise(
  supabase: SupabaseClient,
  dayId: string,
  routineExerciseId: string,
  direction: 'up' | 'down'
): Promise<void> {
  const { data, error } = await supabase
    .from('routine_exercises')
    .select('id, order_index')
    .eq('routine_day_id', dayId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  const items = data ?? [];

  const index = items.findIndex((e: { id: string }) => e.id === routineExerciseId);
  const swapWithIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || swapWithIndex < 0 || swapWithIndex >= items.length) return;

  const current = items[index];
  const swapWith = items[swapWithIndex];

  const { error: error1 } = await supabase
    .from('routine_exercises')
    .update({ order_index: swapWith.order_index })
    .eq('id', current.id);
  if (error1) throw error1;

  const { error: error2 } = await supabase
    .from('routine_exercises')
    .update({ order_index: current.order_index })
    .eq('id', swapWith.id);
  if (error2) throw error2;
}

export async function findOrCreateExercise(
  supabase: SupabaseClient,
  name: string,
  muscleGroup: string
): Promise<Exercise> {
  const { data: existing, error: existingError } = await supabase
    .from('exercises')
    .select('*')
    .eq('name', name)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from('exercises')
    .insert({ name, muscle_group: muscleGroup })
    .select()
    .single();
  if (createError) throw createError;
  return created;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/lib/routines/mutations.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full test suite to confirm nothing regressed**

Run: `npx jest`

- [ ] **Step 6: Commit**

```bash
git add src/lib/routines/mutations.ts tests/lib/routines/mutations.test.ts
git commit -m "feat: add routine write mutations"
```

---

### Task 6: Routines list and create screens

**Files:**
- Create: `src/hooks/useRoutines.ts`
- Create: `app/(app)/routines/index.tsx`
- Create: `app/(app)/routines/new.tsx`
- Modify: `app/(app)/index.tsx` — add a link to the routines list

**Interfaces:**
- Consumes: `listRoutines` (Task 4), `createRoutine`, `activateRoutine`, `softDeleteRoutine` (Task 5), `useAuthSession` (Foundation plan), `supabase` client (Foundation plan)
- Produces: `useRoutines(userId: string | undefined): { routines: Routine[]; isLoading: boolean; refetch: () => Promise<void> }` — reused by Task 7

No automated test for this task (spec §11 — screens are manually verified); this task's own verification is `tsc --noEmit` plus a manual walkthrough at the end of Task 8, once the full CRUD loop exists.

- [ ] **Step 1: Write the routines hook**

Create `src/hooks/useRoutines.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listRoutines } from '../lib/routines/queries';
import { Routine } from '../lib/routines/types';

export function useRoutines(userId: string | undefined) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    const data = await listRoutines(supabase, userId);
    setRoutines(data);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { routines, isLoading, refetch };
}
```

- [ ] **Step 2: Build the routines list screen**

Create `app/(app)/routines/index.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useRoutines } from '../../../src/hooks/useRoutines';
import { supabase } from '../../../src/lib/supabase';
import { activateRoutine, softDeleteRoutine } from '../../../src/lib/routines/mutations';

export default function RoutinesList() {
  const { session } = useAuthSession();
  const userId = session?.user.id;
  const { routines, isLoading, refetch } = useRoutines(userId);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleActivate(routineId: string) {
    if (!userId) return;
    setBusyId(routineId);
    try {
      await activateRoutine(supabase, userId, routineId);
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(routineId: string, name: string) {
    Alert.alert('Eliminar rutina', `¿Eliminar "${name}"? Esto no borra tu historial de entrenamientos.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setBusyId(routineId);
          try {
            await softDeleteRoutine(supabase, routineId);
            await refetch();
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={routines}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Todavía no tenés rutinas.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/routines/${item.id}`)}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {item.name}
                {item.is_active ? ' ⭐' : ''}
              </Text>
            </View>
            <View style={styles.rowActions}>
              {!item.is_active && (
                <Pressable
                  disabled={busyId === item.id}
                  onPress={() => handleActivate(item.id)}
                  style={styles.actionButton}
                >
                  <Text style={styles.actionButtonText}>Activar</Text>
                </Pressable>
              )}
              <Pressable
                disabled={busyId === item.id}
                onPress={() => handleDelete(item.id, item.name)}
                style={[styles.actionButton, styles.deleteButton]}
              >
                <Text style={styles.actionButtonText}>Eliminar</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />
      <Pressable style={styles.newButton} onPress={() => router.push('/routines/new')}>
        <Text style={styles.newButtonText}>+ Nueva rutina</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  empty: { textAlign: 'center', marginTop: 32, color: '#666' },
  row: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 8 },
  rowText: { marginBottom: 8 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowActions: { flexDirection: 'row', gap: 8 },
  actionButton: { backgroundColor: '#111', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  deleteButton: { backgroundColor: '#dc2626' },
  actionButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  newButton: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  newButtonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 3: Build the create routine screen**

Create `app/(app)/routines/new.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useRoutines } from '../../../src/hooks/useRoutines';
import { supabase } from '../../../src/lib/supabase';
import { createRoutine } from '../../../src/lib/routines/mutations';

export default function NewRoutine() {
  const { session } = useAuthSession();
  const userId = session?.user.id;
  const { routines } = useRoutines(userId);

  const [name, setName] = useState('');
  const [usesTopSetBackoff, setUsesTopSetBackoff] = useState(false);
  const [suggestedDurationWeeks, setSuggestedDurationWeeks] = useState('');
  const [nextRoutineId, setNextRoutineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!userId) return;
    if (!name.trim()) {
      setError('Ponele un nombre a la rutina.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const routine = await createRoutine(supabase, userId, {
        name: name.trim(),
        usesTopSetBackoff,
        suggestedDurationWeeks: suggestedDurationWeeks ? Number(suggestedDurationWeeks) : null,
        nextRoutineId,
      });
      router.replace(`/routines/${routine.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la rutina.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Nueva rutina</Text>
      <TextInput style={styles.input} placeholder="Nombre" value={name} onChangeText={setName} />

      <View style={styles.switchRow}>
        <Text>Usa top set / back-off</Text>
        <Switch value={usesTopSetBackoff} onValueChange={setUsesTopSetBackoff} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Duración sugerida (semanas, opcional)"
        keyboardType="number-pad"
        value={suggestedDurationWeeks}
        onChangeText={setSuggestedDurationWeeks}
      />

      {routines.length > 0 && (
        <View style={styles.pickerSection}>
          <Text style={styles.pickerLabel}>Rutina siguiente (opcional)</Text>
          {routines.map((r) => (
            <Pressable
              key={r.id}
              style={[styles.pickerRow, nextRoutineId === r.id && styles.pickerRowSelected]}
              onPress={() => setNextRoutineId(nextRoutineId === r.id ? null : r.id)}
            >
              <Text>{r.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={handleCreate} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Creando...' : 'Crear rutina'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerSection: { gap: 6 },
  pickerLabel: { fontWeight: '600' },
  pickerRow: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10 },
  pickerRowSelected: { borderColor: '#111', backgroundColor: '#f0f0f0' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 4: Link Home to the routines list**

Replace the full contents of `app/(app)/index.tsx` (currently 29 lines, ending in a `signOut` button and its `styles` block) with:

```tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuthSession } from '../../src/hooks/useAuthSession';

export default function Home() {
  const { session, isLoading } = useAuthSession();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fit Tracker</Text>
      {isLoading ? (
        <Text>Cargando...</Text>
      ) : (
        <Text>Sesión iniciada como {session?.user.email}</Text>
      )}
      <Pressable style={styles.button} onPress={() => router.push('/routines')}>
        <Text style={styles.buttonText}>Ver rutinas</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.buttonText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite to confirm nothing regressed**

Run: `npx jest`

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useRoutines.ts app/\(app\)/routines app/\(app\)/index.tsx
git commit -m "feat: add routines list and create-routine screens"
```

---

### Task 7: Routine editor screen

**Files:**
- Create: `src/hooks/useRoutine.ts`
- Create: `src/hooks/useRoutineDays.ts`
- Create: `app/(app)/routines/[routineId].tsx`

**Interfaces:**
- Consumes: `getRoutine`, `listRoutineDays` (Task 4); `updateRoutine`, `createDay`, `softDeleteDay`, `moveDay` (Task 5); `useRoutines` (Task 6, reused here for the "next routine" picker)
- Produces: `useRoutine(routineId)`, `useRoutineDays(routineId)` — same shape as `useRoutines` (`{ data, isLoading, refetch }`, named per-entity); `useRoutineDays` is reused by Task 8's manual verification flow (navigating from a day back to this screen)

No automated test — manual verification, same as Task 6.

- [ ] **Step 1: Write the routine and days hooks**

Create `src/hooks/useRoutine.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getRoutine } from '../lib/routines/queries';
import { Routine } from '../lib/routines/types';

export function useRoutine(routineId: string | undefined) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!routineId) return;
    setIsLoading(true);
    const data = await getRoutine(supabase, routineId);
    setRoutine(data);
    setIsLoading(false);
  }, [routineId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { routine, isLoading, refetch };
}
```

Create `src/hooks/useRoutineDays.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listRoutineDays } from '../lib/routines/queries';
import { RoutineDay } from '../lib/routines/types';

export function useRoutineDays(routineId: string | undefined) {
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!routineId) return;
    setIsLoading(true);
    const data = await listRoutineDays(supabase, routineId);
    setDays(data);
    setIsLoading(false);
  }, [routineId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { days, isLoading, refetch };
}
```

- [ ] **Step 2: Build the routine editor screen**

Create `app/(app)/routines/[routineId].tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useRoutine } from '../../../src/hooks/useRoutine';
import { useRoutineDays } from '../../../src/hooks/useRoutineDays';
import { useRoutines } from '../../../src/hooks/useRoutines';
import { supabase } from '../../../src/lib/supabase';
import { updateRoutine, createDay, softDeleteDay, moveDay } from '../../../src/lib/routines/mutations';

export default function RoutineEditor() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  const { session } = useAuthSession();
  const userId = session?.user.id;
  const { routine, isLoading: routineLoading, refetch: refetchRoutine } = useRoutine(routineId);
  const { days, isLoading: daysLoading, refetch: refetchDays } = useRoutineDays(routineId);
  const { routines: otherRoutines } = useRoutines(userId);

  const [name, setName] = useState('');
  const [usesTopSetBackoff, setUsesTopSetBackoff] = useState(false);
  const [suggestedDurationWeeks, setSuggestedDurationWeeks] = useState('');
  const [nextRoutineId, setNextRoutineId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newDayName, setNewDayName] = useState('');
  const [newDayIsRest, setNewDayIsRest] = useState(false);
  const [addingDay, setAddingDay] = useState(false);

  useEffect(() => {
    if (routine && !initialized) {
      setName(routine.name);
      setUsesTopSetBackoff(routine.uses_top_set_backoff);
      setSuggestedDurationWeeks(
        routine.suggested_duration_weeks !== null ? String(routine.suggested_duration_weeks) : ''
      );
      setNextRoutineId(routine.next_routine_id);
      setInitialized(true);
    }
  }, [routine, initialized]);

  async function handleSave() {
    if (!routineId) return;
    setSaving(true);
    try {
      await updateRoutine(supabase, routineId, {
        name: name.trim(),
        usesTopSetBackoff,
        suggestedDurationWeeks: suggestedDurationWeeks ? Number(suggestedDurationWeeks) : null,
        nextRoutineId,
      });
      await refetchRoutine();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDay() {
    if (!routineId || !newDayName.trim()) return;
    await createDay(supabase, routineId, { name: newDayName.trim(), isRestDay: newDayIsRest });
    setNewDayName('');
    setNewDayIsRest(false);
    setAddingDay(false);
    await refetchDays();
  }

  function handleDeleteDay(dayId: string, dayName: string) {
    Alert.alert('Eliminar día', `¿Eliminar "${dayName}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await softDeleteDay(supabase, dayId);
          await refetchDays();
        },
      },
    ]);
  }

  async function handleMoveDay(dayId: string, direction: 'up' | 'down') {
    if (!routineId) return;
    await moveDay(supabase, routineId, dayId, direction);
    await refetchDays();
  }

  if (routineLoading || daysLoading || !routine) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  const pickableRoutines = otherRoutines.filter((r) => r.id !== routineId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TextInput style={styles.input} placeholder="Nombre" value={name} onChangeText={setName} />

      <View style={styles.switchRow}>
        <Text>Usa top set / back-off</Text>
        <Switch value={usesTopSetBackoff} onValueChange={setUsesTopSetBackoff} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Duración sugerida (semanas, opcional)"
        keyboardType="number-pad"
        value={suggestedDurationWeeks}
        onChangeText={setSuggestedDurationWeeks}
      />

      {pickableRoutines.length > 0 && (
        <View style={styles.pickerSection}>
          <Text style={styles.pickerLabel}>Rutina siguiente (opcional)</Text>
          {pickableRoutines.map((r) => (
            <Pressable
              key={r.id}
              style={[styles.pickerRow, nextRoutineId === r.id && styles.pickerRowSelected]}
              onPress={() => setNextRoutineId(nextRoutineId === r.id ? null : r.id)}
            >
              <Text>{r.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Días</Text>
      {days.map((day, index) => (
        <View key={day.id} style={styles.dayRow}>
          <Pressable
            style={styles.dayRowMain}
            onPress={() => router.push(`/routines/${routineId}/days/${day.id}`)}
          >
            <Text style={styles.dayName}>
              {day.name}
              {day.is_rest_day ? ' (descanso)' : ''}
            </Text>
          </Pressable>
          <View style={styles.dayActions}>
            <Pressable disabled={index === 0} onPress={() => handleMoveDay(day.id, 'up')}>
              <Text style={styles.moveButton}>↑</Text>
            </Pressable>
            <Pressable disabled={index === days.length - 1} onPress={() => handleMoveDay(day.id, 'down')}>
              <Text style={styles.moveButton}>↓</Text>
            </Pressable>
            <Pressable onPress={() => handleDeleteDay(day.id, day.name)}>
              <Text style={styles.deleteButton}>Eliminar</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {addingDay ? (
        <View style={styles.addDayForm}>
          <TextInput
            style={styles.input}
            placeholder="Nombre del día"
            value={newDayName}
            onChangeText={setNewDayName}
          />
          <View style={styles.switchRow}>
            <Text>Día de descanso</Text>
            <Switch value={newDayIsRest} onValueChange={setNewDayIsRest} />
          </View>
          <Pressable style={styles.button} onPress={handleAddDay}>
            <Text style={styles.buttonText}>Agregar día</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.newButton} onPress={() => setAddingDay(true)}>
          <Text style={styles.newButtonText}>+ Agregar día</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerSection: { gap: 6 },
  pickerLabel: { fontWeight: '600' },
  pickerRow: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10 },
  pickerRowSelected: { borderColor: '#111', backgroundColor: '#f0f0f0' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
  },
  dayRowMain: { flex: 1 },
  dayName: { fontSize: 16, fontWeight: '600' },
  dayActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  moveButton: { fontSize: 18, paddingHorizontal: 6 },
  deleteButton: { color: '#dc2626', fontWeight: '600' },
  addDayForm: { gap: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  newButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  newButtonText: { color: '#111', fontWeight: '600' },
});
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite to confirm nothing regressed**

Run: `npx jest`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRoutine.ts src/hooks/useRoutineDays.ts app/\(app\)/routines/\[routineId\].tsx
git commit -m "feat: add routine editor screen"
```

---

### Task 8: Day editor and exercise form

**Files:**
- Create: `src/hooks/useRoutineDay.ts`
- Create: `src/hooks/useDayExercises.ts`
- Create: `src/hooks/useExercises.ts`
- Create: `src/components/ExerciseForm.tsx`
- Create: `app/(app)/routines/[routineId]/days/[dayId].tsx`

**Interfaces:**
- Consumes: `getRoutineDay`, `listDayExercises`, `listExercises` (Task 4); `updateDay`, `createRoutineExercise`, `updateRoutineExercise`, `softDeleteRoutineExercise`, `moveRoutineExercise`, `findOrCreateExercise` (Task 5); `RoutineExerciseWithName`, `RoutineExerciseRole`, `RoutineExerciseSchemeType`, `RoutineExerciseRepUnit` (Task 4 types)
- Produces:
  ```ts
  export interface ExerciseFormValues { exerciseName, muscleGroup: 'upper'|'lower'|'core', role, schemeType, repUnit, sets, repMin, repMax, rirMin, rirMax, topSetReps, backoffSets, backoffRepMin, backoffRepMax } // all numeric fields as strings — this is form state, not the mutation input
  export function ExerciseForm(props: { exercises: Exercise[]; initial?: RoutineExerciseWithName; onSubmit: (values: ExerciseFormValues) => Promise<void>; onCancel: () => void }): JSX.Element
  ```
  This is the last task in the plan — its last step is a full manual walkthrough of everything Tasks 6-8 built.

Spec §6 lists the Exercise form's fields as name/role/scheme_type/rep_unit/scheme fields — it doesn't mention muscle group, but `exercises.muscle_group` is a required (`not null`) column with no default, so creating a brand-new exercise from this form needs a value for it. This task adds a minimal 3-way `upper`/`lower`/`core` selector to satisfy that constraint — the smallest extension that makes the spec's own schema requirement satisfiable, not new scope.

- [ ] **Step 1: Write the remaining hooks**

Create `src/hooks/useRoutineDay.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getRoutineDay } from '../lib/routines/queries';
import { RoutineDay } from '../lib/routines/types';

export function useRoutineDay(dayId: string | undefined) {
  const [day, setDay] = useState<RoutineDay | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!dayId) return;
    setIsLoading(true);
    const data = await getRoutineDay(supabase, dayId);
    setDay(data);
    setIsLoading(false);
  }, [dayId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { day, isLoading, refetch };
}
```

Create `src/hooks/useDayExercises.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listDayExercises } from '../lib/routines/queries';
import { RoutineExerciseWithName } from '../lib/routines/types';

export function useDayExercises(dayId: string | undefined) {
  const [exercises, setExercises] = useState<RoutineExerciseWithName[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!dayId) return;
    setIsLoading(true);
    const data = await listDayExercises(supabase, dayId);
    setExercises(data);
    setIsLoading(false);
  }, [dayId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { exercises, isLoading, refetch };
}
```

Create `src/hooks/useExercises.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listExercises } from '../lib/routines/queries';
import { Exercise } from '../lib/routines/types';

export function useExercises() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const data = await listExercises(supabase);
    setExercises(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { exercises, isLoading, refetch };
}
```

- [ ] **Step 2: Build the exercise form component**

Create `src/components/ExerciseForm.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch } from 'react-native';
import {
  Exercise,
  RoutineExerciseRole,
  RoutineExerciseSchemeType,
  RoutineExerciseRepUnit,
  RoutineExerciseWithName,
} from '../lib/routines/types';

export interface ExerciseFormValues {
  exerciseName: string;
  muscleGroup: 'upper' | 'lower' | 'core';
  role: RoutineExerciseRole;
  schemeType: RoutineExerciseSchemeType;
  repUnit: RoutineExerciseRepUnit;
  sets: string;
  repMin: string;
  repMax: string;
  rirMin: string;
  rirMax: string;
  topSetReps: string;
  backoffSets: string;
  backoffRepMin: string;
  backoffRepMax: string;
}

interface ExerciseFormProps {
  exercises: Exercise[];
  initial?: RoutineExerciseWithName;
  onSubmit: (values: ExerciseFormValues) => Promise<void>;
  onCancel: () => void;
}

function initialValues(initial?: RoutineExerciseWithName): ExerciseFormValues {
  if (!initial) {
    return {
      exerciseName: '',
      muscleGroup: 'upper',
      role: 'accessory',
      schemeType: 'normal',
      repUnit: 'reps',
      sets: '',
      repMin: '',
      repMax: '',
      rirMin: '',
      rirMax: '',
      topSetReps: '',
      backoffSets: '',
      backoffRepMin: '',
      backoffRepMax: '',
    };
  }
  return {
    exerciseName: initial.exercise_name,
    muscleGroup: 'upper',
    role: initial.role,
    schemeType: initial.scheme_type,
    repUnit: initial.rep_unit,
    sets: initial.sets !== null ? String(initial.sets) : '',
    repMin: initial.rep_min !== null ? String(initial.rep_min) : '',
    repMax: initial.rep_max !== null ? String(initial.rep_max) : '',
    rirMin: initial.rir_min !== null ? String(initial.rir_min) : '',
    rirMax: initial.rir_max !== null ? String(initial.rir_max) : '',
    topSetReps: initial.top_set_reps !== null ? String(initial.top_set_reps) : '',
    backoffSets: initial.backoff_sets !== null ? String(initial.backoff_sets) : '',
    backoffRepMin: initial.backoff_rep_min !== null ? String(initial.backoff_rep_min) : '',
    backoffRepMax: initial.backoff_rep_max !== null ? String(initial.backoff_rep_max) : '',
  };
}

export function ExerciseForm({ exercises, initial, onSubmit, onCancel }: ExerciseFormProps) {
  const [values, setValues] = useState<ExerciseFormValues>(initialValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const suggestions =
    values.exerciseName.trim().length > 0
      ? exercises
          .filter((e) => e.name.toLowerCase().includes(values.exerciseName.trim().toLowerCase()))
          .slice(0, 5)
      : [];

  function update<K extends keyof ExerciseFormValues>(key: K, value: ExerciseFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): string | null {
    if (!values.exerciseName.trim()) return 'Ponele un nombre al ejercicio.';
    if (values.schemeType === 'normal') {
      if (!values.sets || !values.repMin || !values.repMax) {
        return 'Series, reps mínimas y reps máximas son obligatorias.';
      }
      if (Number(values.repMin) > Number(values.repMax)) {
        return 'Las reps mínimas no pueden ser mayores a las máximas.';
      }
    } else {
      if (!values.topSetReps || !values.backoffSets || !values.backoffRepMin || !values.backoffRepMax) {
        return 'Top set y back-off son obligatorios para este esquema.';
      }
      if (Number(values.backoffRepMin) > Number(values.backoffRepMax)) {
        return 'El rango de back-off es inválido.';
      }
    }
    if (values.rirMin && values.rirMax && Number(values.rirMin) > Number(values.rirMax)) {
      return 'El rango de RIR es inválido.';
    }
    return null;
  }

  async function handleSubmit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el ejercicio.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        placeholder="Nombre del ejercicio"
        value={values.exerciseName}
        onChangeText={(text) => update('exerciseName', text)}
      />
      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((s) => (
            <Pressable key={s.id} onPress={() => update('exerciseName', s.name)} style={styles.suggestionRow}>
              <Text>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.label}>Grupo muscular</Text>
      <View style={styles.segmented}>
        {(['upper', 'lower', 'core'] as const).map((option) => (
          <Pressable
            key={option}
            style={[styles.segment, values.muscleGroup === option && styles.segmentSelected]}
            onPress={() => update('muscleGroup', option)}
          >
            <Text style={values.muscleGroup === option ? styles.segmentTextSelected : styles.segmentText}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Rol</Text>
      <View style={styles.segmented}>
        {(['main', 'accessory', 'core'] as const).map((option) => (
          <Pressable
            key={option}
            style={[styles.segment, values.role === option && styles.segmentSelected]}
            onPress={() => update('role', option)}
          >
            <Text style={values.role === option ? styles.segmentTextSelected : styles.segmentText}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.switchRow}>
        <Text>Top set / back-off</Text>
        <Switch
          value={values.schemeType === 'top_set_backoff'}
          onValueChange={(value) => update('schemeType', value ? 'top_set_backoff' : 'normal')}
        />
      </View>

      <View style={styles.switchRow}>
        <Text>Medido en segundos</Text>
        <Switch
          value={values.repUnit === 'seconds'}
          onValueChange={(value) => update('repUnit', value ? 'seconds' : 'reps')}
        />
      </View>

      {values.schemeType === 'normal' ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Series"
            keyboardType="number-pad"
            value={values.sets}
            onChangeText={(text) => update('sets', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Reps mínimas"
            keyboardType="number-pad"
            value={values.repMin}
            onChangeText={(text) => update('repMin', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Reps máximas"
            keyboardType="number-pad"
            value={values.repMax}
            onChangeText={(text) => update('repMax', text)}
          />
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Reps del top set"
            keyboardType="number-pad"
            value={values.topSetReps}
            onChangeText={(text) => update('topSetReps', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Series de back-off"
            keyboardType="number-pad"
            value={values.backoffSets}
            onChangeText={(text) => update('backoffSets', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Reps mínimas de back-off"
            keyboardType="number-pad"
            value={values.backoffRepMin}
            onChangeText={(text) => update('backoffRepMin', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Reps máximas de back-off"
            keyboardType="number-pad"
            value={values.backoffRepMax}
            onChangeText={(text) => update('backoffRepMax', text)}
          />
        </>
      )}

      <TextInput
        style={styles.input}
        placeholder="RIR mínimo (opcional)"
        keyboardType="number-pad"
        value={values.rirMin}
        onChangeText={(text) => update('rirMin', text)}
      />
      <TextInput
        style={styles.input}
        placeholder="RIR máximo (opcional)"
        keyboardType="number-pad"
        value={values.rirMax}
        onChangeText={(text) => update('rirMax', text)}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={handleSubmit} disabled={saving}>
          <Text style={styles.buttonText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  suggestions: { borderWidth: 1, borderColor: '#eee', borderRadius: 8 },
  suggestionRow: { padding: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  label: { fontWeight: '600', marginTop: 4 },
  segmented: { flexDirection: 'row', gap: 6 },
  segment: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  segmentSelected: { backgroundColor: '#111', borderColor: '#111' },
  segmentText: { color: '#111' },
  segmentTextSelected: { color: '#fff' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  error: { color: '#dc2626' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, alignItems: 'center' },
  cancelButtonText: { color: '#111', fontWeight: '600' },
});
```

- [ ] **Step 3: Build the day editor screen**

Create `app/(app)/routines/[routineId]/days/[dayId].tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRoutineDay } from '../../../../../src/hooks/useRoutineDay';
import { useDayExercises } from '../../../../../src/hooks/useDayExercises';
import { useExercises } from '../../../../../src/hooks/useExercises';
import { supabase } from '../../../../../src/lib/supabase';
import {
  updateDay,
  createRoutineExercise,
  updateRoutineExercise,
  softDeleteRoutineExercise,
  moveRoutineExercise,
  findOrCreateExercise,
} from '../../../../../src/lib/routines/mutations';
import { ExerciseForm, ExerciseFormValues } from '../../../../../src/components/ExerciseForm';
import { RoutineExerciseWithName } from '../../../../../src/lib/routines/types';

export default function DayEditor() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const { day, isLoading: dayLoading, refetch: refetchDay } = useRoutineDay(dayId);
  const { exercises, isLoading: exercisesLoading, refetch: refetchExercises } = useDayExercises(dayId);
  const { exercises: catalog } = useExercises();

  const [name, setName] = useState('');
  const [isRestDay, setIsRestDay] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  const [addingExercise, setAddingExercise] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);

  useEffect(() => {
    if (day && !initialized) {
      setName(day.name);
      setIsRestDay(day.is_rest_day);
      setInitialized(true);
    }
  }, [day, initialized]);

  async function handleSave() {
    if (!dayId) return;
    setSaving(true);
    try {
      await updateDay(supabase, dayId, { name: name.trim(), isRestDay });
      await refetchDay();
    } finally {
      setSaving(false);
    }
  }

  function toMutationInput(values: ExerciseFormValues) {
    return {
      role: values.role,
      schemeType: values.schemeType,
      repUnit: values.repUnit,
      sets: values.sets ? Number(values.sets) : null,
      repMin: values.repMin ? Number(values.repMin) : null,
      repMax: values.repMax ? Number(values.repMax) : null,
      rirMin: values.rirMin ? Number(values.rirMin) : null,
      rirMax: values.rirMax ? Number(values.rirMax) : null,
      topSetReps: values.topSetReps ? Number(values.topSetReps) : null,
      backoffSets: values.backoffSets ? Number(values.backoffSets) : null,
      backoffRepMin: values.backoffRepMin ? Number(values.backoffRepMin) : null,
      backoffRepMax: values.backoffRepMax ? Number(values.backoffRepMax) : null,
    };
  }

  async function handleCreateExercise(values: ExerciseFormValues) {
    if (!dayId) return;
    const exercise = await findOrCreateExercise(supabase, values.exerciseName.trim(), values.muscleGroup);
    await createRoutineExercise(supabase, dayId, { exerciseId: exercise.id, ...toMutationInput(values) });
    setAddingExercise(false);
    await refetchExercises();
  }

  async function handleUpdateExercise(routineExerciseId: string, values: ExerciseFormValues) {
    const exercise = await findOrCreateExercise(supabase, values.exerciseName.trim(), values.muscleGroup);
    await updateRoutineExercise(supabase, routineExerciseId, {
      exerciseId: exercise.id,
      ...toMutationInput(values),
    });
    setEditingExerciseId(null);
    await refetchExercises();
  }

  function handleDeleteExercise(routineExerciseId: string, exerciseName: string) {
    Alert.alert('Eliminar ejercicio', `¿Eliminar "${exerciseName}" de este día?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await softDeleteRoutineExercise(supabase, routineExerciseId);
          await refetchExercises();
        },
      },
    ]);
  }

  async function handleMoveExercise(routineExerciseId: string, direction: 'up' | 'down') {
    if (!dayId) return;
    await moveRoutineExercise(supabase, dayId, routineExerciseId, direction);
    await refetchExercises();
  }

  if (dayLoading || exercisesLoading || !day) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TextInput style={styles.input} placeholder="Nombre del día" value={name} onChangeText={setName} />
      <View style={styles.switchRow}>
        <Text>Día de descanso</Text>
        <Switch value={isRestDay} onValueChange={setIsRestDay} />
      </View>
      <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
      </Pressable>

      {!isRestDay && (
        <>
          <Text style={styles.sectionTitle}>Ejercicios</Text>
          {exercises.map((exercise: RoutineExerciseWithName, index: number) =>
            editingExerciseId === exercise.id ? (
              <ExerciseForm
                key={exercise.id}
                exercises={catalog}
                initial={exercise}
                onSubmit={(values) => handleUpdateExercise(exercise.id, values)}
                onCancel={() => setEditingExerciseId(null)}
              />
            ) : (
              <View key={exercise.id} style={styles.exerciseRow}>
                <Pressable style={styles.exerciseRowMain} onPress={() => setEditingExerciseId(exercise.id)}>
                  <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
                  <Text style={styles.exerciseMeta}>
                    {exercise.role} · {exercise.scheme_type}
                  </Text>
                </Pressable>
                <View style={styles.exerciseActions}>
                  <Pressable disabled={index === 0} onPress={() => handleMoveExercise(exercise.id, 'up')}>
                    <Text style={styles.moveButton}>↑</Text>
                  </Pressable>
                  <Pressable
                    disabled={index === exercises.length - 1}
                    onPress={() => handleMoveExercise(exercise.id, 'down')}
                  >
                    <Text style={styles.moveButton}>↓</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDeleteExercise(exercise.id, exercise.exercise_name)}>
                    <Text style={styles.deleteButton}>Eliminar</Text>
                  </Pressable>
                </View>
              </View>
            )
          )}

          {addingExercise ? (
            <ExerciseForm
              exercises={catalog}
              onSubmit={handleCreateExercise}
              onCancel={() => setAddingExercise(false)}
            />
          ) : (
            <Pressable style={styles.newButton} onPress={() => setAddingExercise(true)}>
              <Text style={styles.newButtonText}>+ Agregar ejercicio</Text>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
  },
  exerciseRowMain: { flex: 1 },
  exerciseName: { fontSize: 16, fontWeight: '600' },
  exerciseMeta: { color: '#666', fontSize: 12 },
  exerciseActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  moveButton: { fontSize: 18, paddingHorizontal: 6 },
  deleteButton: { color: '#dc2626', fontWeight: '600' },
  newButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  newButtonText: { color: '#111', fontWeight: '600' },
});
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite to confirm nothing regressed**

Run: `npx jest`
Expected: every test from Tasks 1-8 passes.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useRoutineDay.ts src/hooks/useDayExercises.ts src/hooks/useExercises.ts src/components/ExerciseForm.tsx "app/(app)/routines/[routineId]/days"
git commit -m "feat: add day editor screen and exercise form"
```

- [ ] **Step 7: Manually verify the full import + CRUD flow end to end**

This is the last task in the plan — this step exercises everything Tasks 1-8 built together, on a real device.

1. Run the import script once against your own account: `npx tsx scripts/import-routine.ts <your-login-email>`. Expected: prints the two imported routine ids; no errors.
2. Run it again with the same email. Expected: prints "Import skipped: ... already exists" for both — confirms idempotency on a real run, not just the test's throwaway user.
3. Run `npx expo start`, open the app, sign in, tap **Ver rutinas**. Expected: "Full Body" and "Split 5 días" both appear.
4. Tap **Activar** on "Full Body". Expected: it gets a ⭐, and the button disappears from that row (only inactive routines show it).
5. Tap into "Full Body". Expected: its days (Día A, Día B, Core) are listed in order; edit the name field and tap **Guardar** — reopen the routine and confirm the new name stuck.
6. Tap **+ Agregar día**, create a throwaway day, confirm it appears at the bottom of the list, then use ↑ to move it up one position, then **Eliminar** it (confirm the alert) and confirm it disappears.
7. Tap into "Día A". Expected: its 6 exercises are listed. Tap one to edit it inline — change a field, save, confirm the change is reflected in the row's summary line.
8. Tap **+ Agregar ejercicio**, type a brand-new name (not in the suggestions list), fill in a normal scheme, save. Expected: it appears at the bottom of the list. Go back to the routine editor, into a *different* day, add an exercise, and type the same name you just created — confirm it appears in the autocomplete suggestions (proves `findOrCreateExercise` is deduplicating against the shared catalog, not creating a duplicate).
9. Delete the throwaway exercise you created. Confirm it disappears.
10. Back on the routines list, tap **Eliminar** on "Split 5 días" and confirm. Expected: it disappears from the list. In the Supabase dashboard's table editor (or via a quick manual query), confirm the row still exists with `is_deleted = true` rather than being gone — this is the one invariant no automated test in this plan can observe end-to-end on a real device, since it depends on the dashboard, not the app.

