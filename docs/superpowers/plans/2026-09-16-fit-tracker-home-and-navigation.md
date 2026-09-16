# Fit Tracker — Home Dashboard & Drawer Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Home screen into a small dashboard (weekly calendar strip, week progress, recent activity, consistency streak) and move "Ver rutinas"/"Cerrar sesión" out of Home's body into a drawer navigation shell.

**Architecture:** Two new pure, Jest-tested modules (`src/lib/home/weekCalendar.ts`, `src/lib/home/streak.ts`) compute dashboard data from already-cached/queried state — no new tables, no new network shape beyond one new read query. `app/(app)/_layout.tsx` switches from `Stack` to `expo-router/drawer`'s `Drawer`, with a custom drawer content component holding the sign-out button. `useHomeData` gains the new derived fields; `app/(app)/index.tsx` renders them.

**Tech Stack:** Expo Router (SDK 57) `expo-router/drawer` (vendors `@react-navigation/drawer` building blocks — no new dependency), existing Supabase + expo-sqlite stack, Jest against the real hosted Supabase project for integration tests.

**Spec:** `docs/superpowers/specs/2026-09-16-fit-tracker-home-and-navigation-design.md`

## Global Constraints

- **No new dependency for the drawer.** Import `Drawer`, `Drawer.Screen`, `DrawerContentScrollView`, `DrawerItemList`, and the `DrawerContentComponentProps` type from `expo-router/drawer` — never install or import `@react-navigation/drawer` directly (spec §6).
- **Pure functions stay pure.** `src/lib/home/weekCalendar.ts` and `src/lib/home/streak.ts` must not import `expo-sqlite`, `@supabase/supabase-js`, or any React Native module — this is what keeps them directly Jest-testable, matching the existing `src/lib/progression/*` convention.
- **Date-only strings need manual parsing.** Postgres `date` columns (e.g. `session_date`) come back as `'YYYY-MM-DD'` strings. Never pass one through `new Date(str)` directly — depending on the machine's timezone offset, `new Date('2026-01-20')` parses as UTC midnight, which can render as the *previous* local day. Split the string into `Y/M/D` components and construct the `Date` from those (see Task 2's `parseDateOnly`).
- **Monday-anchored weeks.** Both the calendar strip and the streak treat weeks as Monday-through-Sunday, matching the existing `weekdayFromDate`/`resolveTodayDayId` convention in `src/lib/sessions/weekResolution.ts`.
- **Calendar strip labels intentionally differ from `WeekdayPicker`.** `WeekdayPicker.tsx` uses single-letter labels (`L`, `M`, `X`...) because it's a compact day-toggle chip row. The new `WeekCalendarStrip` has room for 3-letter abbreviations (`Lun`, `Mar`, `Mié`...) per spec §3 — this is a deliberate difference in a different component, not an inconsistency to fix.
- **RLS/soft-delete conventions are unchanged.** This plan only adds one read query (`listRecentCompletedSessions`) and reads already-fetched cache data — no new migrations, no new tables.
- **UI copy is in Spanish**, matching every existing screen.
- **Styling convention:** plain `StyleSheet.create`, no UI library. Existing palette: `#111` (primary text/buttons), `#ddd` (borders), `#666` (secondary text), `#16a34a` (success green), `#dc2626` (error/destructive red), `#f59e0b` (warning amber). Reuse these instead of inventing new colors.
- **Testing convention:** pure functions get direct Jest unit tests. `listRecentCompletedSessions` (touches Supabase) gets an integration test against the real hosted project via `tests/helpers/supabaseAdmin.ts`'s `createAdminClient()` and `tests/helpers/seedActiveRoutine.ts`. The Drawer restructuring, `AppDrawerContent`, `WeekCalendarStrip`, `useHomeData` wiring, and `index.tsx` dashboard assembly are UI — verified manually on-device/simulator, matching this project's established approach (no Node binding for `expo-sqlite`, and these are presentation wiring, not logic).

---

### Task 1: Pure week-calendar functions

**Files:**
- Create: `src/lib/home/weekCalendar.ts`
- Test: `tests/lib/home/weekCalendar.test.ts`

**Interfaces:**
- Consumes: `Weekday` type from `src/lib/routines/types.ts`; `weekdayFromDate`, `resolveTodayDayId` from `src/lib/sessions/weekResolution.ts` (both already exist, unchanged).
- Produces: `WeekCalendarDay` interface, `buildWeekCalendar(weekdaySchedule, days, weekNumber, today)`, `computeWeekProgress(weekNumber, suggestedDurationWeeks)` — consumed by Task 5 (`useHomeData`) and Task 4 (`WeekCalendarStrip`).

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/home/weekCalendar.test.ts`:

```typescript
import { buildWeekCalendar, computeWeekProgress } from '../../../src/lib/home/weekCalendar';

describe('buildWeekCalendar', () => {
  const days = [
    { id: 'day-a', name: 'Día A', is_rest_day: false },
    { id: 'day-b', name: 'Día B', is_rest_day: false },
    { id: 'day-rest', name: 'Descanso activo', is_rest_day: true },
  ];

  it('resolves a plain (non-alternating) entry every week', () => {
    const schedule = { mon: 'day-a' };
    const week1 = buildWeekCalendar(schedule, days, 1, new Date(2026, 0, 19)); // Monday
    const week2 = buildWeekCalendar(schedule, days, 2, new Date(2026, 0, 19));
    expect(week1.find((d) => d.weekday === 'mon')?.dayName).toBe('Día A');
    expect(week2.find((d) => d.weekday === 'mon')?.dayName).toBe('Día A');
  });

  it('resolves an alternating entry differently on even vs odd weeks', () => {
    const schedule = { fri: { even_week: 'day-a', odd_week: 'day-b' } };
    const oddWeek = buildWeekCalendar(schedule, days, 1, new Date(2026, 0, 19));
    const evenWeek = buildWeekCalendar(schedule, days, 2, new Date(2026, 0, 19));
    expect(oddWeek.find((d) => d.weekday === 'fri')?.dayName).toBe('Día B');
    expect(evenWeek.find((d) => d.weekday === 'fri')?.dayName).toBe('Día A');
  });

  it('marks a weekday with no schedule entry as a rest day with no name', () => {
    const week = buildWeekCalendar({ mon: 'day-a' }, days, 1, new Date(2026, 0, 19));
    const wed = week.find((d) => d.weekday === 'wed');
    expect(wed?.isRestDay).toBe(true);
    expect(wed?.dayName).toBeNull();
  });

  it('marks a weekday resolving to an is_rest_day=true routine day as a rest day with no name', () => {
    const schedule = { tue: 'day-rest' };
    const week = buildWeekCalendar(schedule, days, 1, new Date(2026, 0, 19));
    const tue = week.find((d) => d.weekday === 'tue');
    expect(tue?.isRestDay).toBe(true);
    expect(tue?.dayName).toBeNull();
  });

  it('flags only today\'s weekday as isToday', () => {
    // 2026-01-20 is a Tuesday
    const week = buildWeekCalendar({}, days, 1, new Date(2026, 0, 20));
    const flagged = week.filter((d) => d.isToday);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].weekday).toBe('tue');
  });

  it('always returns exactly 7 days in Monday-through-Sunday order', () => {
    const week = buildWeekCalendar({}, days, 1, new Date(2026, 0, 19));
    expect(week.map((d) => d.weekday)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(week.map((d) => d.label)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
  });
});

describe('computeWeekProgress', () => {
  it('returns null for an indefinite routine (no suggested duration)', () => {
    expect(computeWeekProgress(3, null)).toBeNull();
  });

  it('returns the fraction of weeks completed', () => {
    expect(computeWeekProgress(2, 8)).toBe(0.25);
  });

  it('caps at 1 when the current week exceeds the suggested duration', () => {
    expect(computeWeekProgress(10, 8)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/home/weekCalendar.test.ts`
Expected: FAIL — `Cannot find module '../../../src/lib/home/weekCalendar'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/home/weekCalendar.ts`:

```typescript
import { Weekday } from '../routines/types';
import { weekdayFromDate, resolveTodayDayId } from '../sessions/weekResolution';

export interface WeekCalendarDay {
  weekday: Weekday;
  label: string;
  dayName: string | null;
  isRestDay: boolean;
  isToday: boolean;
}

interface CalendarRoutineDay {
  id: string;
  name: string;
  is_rest_day: boolean;
}

const WEEK_ORDER: { weekday: Weekday; label: string }[] = [
  { weekday: 'mon', label: 'Lun' },
  { weekday: 'tue', label: 'Mar' },
  { weekday: 'wed', label: 'Mié' },
  { weekday: 'thu', label: 'Jue' },
  { weekday: 'fri', label: 'Vie' },
  { weekday: 'sat', label: 'Sáb' },
  { weekday: 'sun', label: 'Dom' },
];

export function buildWeekCalendar(
  weekdaySchedule: Record<string, unknown>,
  days: CalendarRoutineDay[],
  weekNumber: number,
  today: Date
): WeekCalendarDay[] {
  const todayWeekday = weekdayFromDate(today);

  return WEEK_ORDER.map(({ weekday, label }) => {
    const dayId = resolveTodayDayId(weekdaySchedule, weekday, weekNumber);
    const day = dayId ? days.find((d) => d.id === dayId) ?? null : null;
    const isRestDay = !day || day.is_rest_day;

    return {
      weekday,
      label,
      dayName: isRestDay ? null : day!.name,
      isRestDay,
      isToday: weekday === todayWeekday,
    };
  });
}

export function computeWeekProgress(weekNumber: number, suggestedDurationWeeks: number | null): number | null {
  if (suggestedDurationWeeks === null) return null;
  return Math.min(weekNumber / suggestedDurationWeeks, 1);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/home/weekCalendar.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/home/weekCalendar.ts tests/lib/home/weekCalendar.test.ts
git commit -m "feat: add pure weekly calendar and week-progress functions"
```

---

### Task 2: Pure consistency-streak function

**Files:**
- Create: `src/lib/home/streak.ts`
- Test: `tests/lib/home/streak.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (fully self-contained pure module).
- Produces: `computeConsecutiveActiveWeeks(sessionDates: string[], now: Date): number` — consumed by Task 5 (`useHomeData`).

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/home/streak.test.ts`. These fixtures use 2026-01-20 (a Tuesday) as `now`, so its Monday-anchored week starts 2026-01-19; the prior weeks start 2026-01-12, 2026-01-05, and 2025-12-29:

```typescript
import { computeConsecutiveActiveWeeks } from '../../../src/lib/home/streak';

describe('computeConsecutiveActiveWeeks', () => {
  const now = new Date(2026, 0, 20); // Tuesday, week-of-Monday = 2026-01-19

  it('returns 0 for no session history', () => {
    expect(computeConsecutiveActiveWeeks([], now)).toBe(0);
  });

  it('counts consecutive weeks including the current one', () => {
    const dates = ['2026-01-20', '2026-01-13', '2026-01-06'];
    expect(computeConsecutiveActiveWeeks(dates, now)).toBe(3);
  });

  it('skips an empty current week once and counts from the last active week', () => {
    const dates = ['2026-01-14', '2026-01-07'];
    expect(computeConsecutiveActiveWeeks(dates, now)).toBe(2);
  });

  it('stops counting at the first gap', () => {
    const dates = ['2026-01-20', '2026-01-06']; // current week present, prior week missing
    expect(computeConsecutiveActiveWeeks(dates, now)).toBe(1);
  });

  it('treats any date within a week as satisfying that week, regardless of weekday', () => {
    const dates = ['2026-01-22', '2026-01-08']; // Thursdays, weeks of 01-19 and 01-05
    // gap at week-of-01-12 breaks the streak after the first week
    expect(computeConsecutiveActiveWeeks(dates, now)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/home/streak.test.ts`
Expected: FAIL — `Cannot find module '../../../src/lib/home/streak'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/home/streak.ts`:

```typescript
function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const jsDay = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function computeConsecutiveActiveWeeks(sessionDates: string[], now: Date): number {
  const activeMondayKeys = new Set(sessionDates.map((iso) => dateKey(mondayOf(parseDateOnly(iso)))));

  let cursor = mondayOf(now);
  if (!activeMondayKeys.has(dateKey(cursor))) {
    cursor = addDays(cursor, -7);
  }

  let count = 0;
  while (activeMondayKeys.has(dateKey(cursor))) {
    count++;
    cursor = addDays(cursor, -7);
  }
  return count;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/home/streak.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/home/streak.ts tests/lib/home/streak.test.ts
git commit -m "feat: add pure consecutive-active-weeks streak function"
```

---

### Task 3: `listRecentCompletedSessions` query

**Files:**
- Modify: `src/lib/sessions/queries.ts`
- Test: `tests/lib/sessions/queries.test.ts` (append to existing file)

**Interfaces:**
- Consumes: `seedActiveRoutine` from `tests/helpers/seedActiveRoutine.ts` (already exists — creates an active routine + day for a user); `createAdminClient` from `tests/helpers/supabaseAdmin.ts`.
- Produces: `listRecentCompletedSessions(supabase, userId, limit = 30): Promise<{ sessionDate: string; dayName: string }[]>` — consumed by Task 5 (`useHomeData`).

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/sessions/queries.test.ts` (add the import and the new `describe` block; the file already imports `createAdminClient`, `seedActiveRoutine`, and sets up `supabase`/`testEmail`/`userId` in `beforeAll`/`afterAll` — reuse those):

```typescript
import { getActiveRoutine, getSessionForDate, listSessionSets, listRecentCompletedSessions } from '../../../src/lib/sessions/queries';

// ... (existing describe blocks unchanged) ...

describe('listRecentCompletedSessions', () => {
  it('returns only completed sessions, newest first, with the day name joined in', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);

    async function insertSession(sessionDate: string, status: 'in_progress' | 'completed') {
      const { error } = await supabase.from('workout_sessions').insert({
        user_id: userId,
        routine_day_id: day.id,
        session_date: sessionDate,
        week_number: 1,
        status,
      });
      if (error) throw error;
    }

    await insertSession('2026-03-01', 'completed');
    await insertSession('2026-03-08', 'completed');
    await insertSession('2026-03-15', 'in_progress'); // not completed, must be excluded

    const result = await listRecentCompletedSessions(supabase, userId);

    expect(result.map((r) => r.sessionDate)).toEqual(['2026-03-08', '2026-03-01']);
    expect(result.every((r) => r.dayName === day.name)).toBe(true);
  });

  it('respects the limit parameter', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);
    for (const sessionDate of ['2026-04-01', '2026-04-08', '2026-04-15']) {
      const { error } = await supabase.from('workout_sessions').insert({
        user_id: userId,
        routine_day_id: day.id,
        session_date: sessionDate,
        week_number: 1,
        status: 'completed',
      });
      if (error) throw error;
    }

    const result = await listRecentCompletedSessions(supabase, userId, 2);
    expect(result).toHaveLength(2);
    expect(result[0].sessionDate).toBe('2026-04-15');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/lib/sessions/queries.test.ts -t "listRecentCompletedSessions"`
Expected: FAIL — `listRecentCompletedSessions is not a function` (or TS compile error on the import)

- [ ] **Step 3: Write the implementation**

Add to `src/lib/sessions/queries.ts` (after `listSessionSets`):

```typescript
export async function listRecentCompletedSessions(
  supabase: SupabaseClient,
  userId: string,
  limit = 30
): Promise<{ sessionDate: string; dayName: string }[]> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('session_date, routine_days(name)')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('session_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as any[]).map((row) => ({
    sessionDate: row.session_date,
    dayName: row.routine_days.name,
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/sessions/queries.test.ts`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessions/queries.ts tests/lib/sessions/queries.test.ts
git commit -m "feat: add listRecentCompletedSessions query for the Home dashboard"
```

---

### Task 4: `WeekCalendarStrip` component

**Files:**
- Create: `src/components/WeekCalendarStrip.tsx`

**Interfaces:**
- Consumes: `WeekCalendarDay` type from `src/lib/home/weekCalendar.ts` (Task 1).
- Produces: `WeekCalendarStrip({ days }: { days: WeekCalendarDay[] })` component — consumed by Task 6 (`app/(app)/index.tsx`).

- [ ] **Step 1: Write the component**

Create `src/components/WeekCalendarStrip.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { WeekCalendarDay } from '../lib/home/weekCalendar';

interface WeekCalendarStripProps {
  days: WeekCalendarDay[];
}

export function WeekCalendarStrip({ days }: WeekCalendarStripProps) {
  return (
    <View style={styles.row}>
      {days.map((day) => (
        <View key={day.weekday} style={[styles.cell, day.isToday && styles.cellToday]}>
          <Text style={[styles.label, day.isToday && styles.labelToday]}>{day.label}</Text>
          <Text style={[styles.dayName, day.isToday && styles.labelToday]} numberOfLines={2}>
            {day.isRestDay ? 'Descanso' : day.dayName}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  cell: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 2,
    alignItems: 'center',
    gap: 4,
    minHeight: 60,
  },
  cellToday: { backgroundColor: '#111', borderColor: '#111' },
  label: { fontSize: 12, fontWeight: '700', color: '#111' },
  labelToday: { color: '#fff' },
  dayName: { fontSize: 10, color: '#666', textAlign: 'center' },
});
```

- [ ] **Step 2: Manual verification (deferred to Task 6)**

This component has no Jest test (pure UI, no Node binding to verify against) — it's exercised visually once wired into Home in Task 6's manual verification pass. No standalone action needed here beyond writing the file.

- [ ] **Step 3: Commit**

```bash
git add src/components/WeekCalendarStrip.tsx
git commit -m "feat: add WeekCalendarStrip component for the Home dashboard"
```

---

### Task 5: Wire the new data into `useHomeData`

**Files:**
- Modify: `src/hooks/useHomeData.ts`

**Interfaces:**
- Consumes: `buildWeekCalendar`, `computeWeekProgress`, `WeekCalendarDay` (Task 1); `computeConsecutiveActiveWeeks` (Task 2); `listRecentCompletedSessions` (Task 3).
- Produces: `useHomeData()` now also returns `weekCalendar: WeekCalendarDay[]`, `weekProgress: number | null`, `recentActivity: { sessionDate: string; dayName: string }[]` (capped at 5), `consistencyStreak: number` — consumed by Task 6 (`app/(app)/index.tsx`).

- [ ] **Step 1: Add the new imports and state**

In `src/hooks/useHomeData.ts`, add to the top imports:

```typescript
import { buildWeekCalendar, computeWeekProgress, WeekCalendarDay } from '../lib/home/weekCalendar';
import { computeConsecutiveActiveWeeks } from '../lib/home/streak';
import { getSessionForDate, listRecentCompletedSessions } from '../lib/sessions/queries';
```

(This replaces the existing `import { getSessionForDate } from '../lib/sessions/queries';` line with the combined import above.)

Add new state alongside the existing `useState` declarations:

```typescript
const [weekCalendar, setWeekCalendar] = useState<WeekCalendarDay[]>([]);
const [weekProgress, setWeekProgress] = useState<number | null>(null);
const [recentActivity, setRecentActivity] = useState<{ sessionDate: string; dayName: string }[]>([]);
const [consistencyStreak, setConsistencyStreak] = useState(0);
```

- [ ] **Step 2: Reset the new state in the "no active routine" early return**

In the `if (!resolved) { ... return; }` block inside `load()`, add resets alongside the existing ones:

```typescript
setWeekCalendar([]);
setWeekProgress(null);
setRecentActivity([]);
setConsistencyStreak(0);
```

- [ ] **Step 3: Compute the new fields after `days` is fetched**

`days` is already computed in `load()` (`const days = getCachedRoutineDays(getDatabase(), resolved.routine.id);`) right before the `topSetExercises` derivation. Immediately after that existing line, add:

```typescript
setWeekCalendar(buildWeekCalendar(resolved.routine.weekday_schedule, days, resolved.weekNumber, new Date()));
setWeekProgress(computeWeekProgress(resolved.weekNumber, resolved.routine.suggested_duration_weeks));

const recentSessions = await listRecentCompletedSessions(supabase, userId).catch(() => []);
setRecentActivity(recentSessions.slice(0, 5));
setConsistencyStreak(computeConsecutiveActiveWeeks(recentSessions.map((s) => s.sessionDate), new Date()));
```

This mirrors the existing pattern just below it (`computeSuggestions(...).catch(...)`) of falling back gracefully instead of failing the whole `load()` when a network-dependent call fails while offline.

- [ ] **Step 4: Expose the new fields from the hook's return value**

In the `return { ... }` object at the end of `useHomeData`, add:

```typescript
weekCalendar,
weekProgress,
recentActivity,
consistencyStreak,
```

- [ ] **Step 5: Manual verification**

No Jest test for this hook (matches existing convention — `useHomeData` has never had a direct test, since it composes `expo-sqlite` reads that have no Node binding). Verified on-device in Task 6, once `index.tsx` renders these fields.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useHomeData.ts
git commit -m "feat: expose weekly calendar, progress, activity, and streak from useHomeData"
```

---

### Task 6: Render the Home dashboard

**Files:**
- Modify: `app/(app)/index.tsx`

**Interfaces:**
- Consumes: the new `useHomeData()` fields from Task 5; `WeekCalendarStrip` from Task 4.
- Produces: the finished Home screen. No further tasks consume this file's internals.

- [ ] **Step 1: Rewrite `app/(app)/index.tsx`**

Replace the full contents of `app/(app)/index.tsx` with:

```tsx
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useHomeData } from '../../src/hooks/useHomeData';
import { WeekCalendarStrip } from '../../src/components/WeekCalendarStrip';

function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

export default function Home() {
  const {
    loading,
    error,
    routineName,
    weekNumber,
    weekProgress,
    weekCalendar,
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
    recentActivity,
    consistencyStreak,
  } = useHomeData();

  async function handleStart() {
    const sessionId = await startOrResumeSession();
    if (sessionId) {
      router.push(`/(app)/session/${sessionId}` as any);
    }
  }

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

  return (
    <View style={styles.container}>
      {loading && <ActivityIndicator />}
      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && !error && (
        <>
          {routineName ? (
            <>
              <View style={styles.card}>
                <Text style={styles.routineName}>{routineName}</Text>
                {weekProgress !== null ? (
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${weekProgress * 100}%` }]} />
                  </View>
                ) : (
                  <Text style={styles.weekLabel}>Semana {weekNumber}</Text>
                )}

                <WeekCalendarStrip days={weekCalendar} />

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
              </View>

              {consistencyStreak > 0 && (
                <View style={styles.streakCard}>
                  <Text style={styles.streakText}>
                    🔥 {consistencyStreak}{' '}
                    {consistencyStreak === 1 ? 'semana consecutiva' : 'semanas consecutivas'} entrenando
                  </Text>
                </View>
              )}

              {recentActivity.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Actividad reciente</Text>
                  {recentActivity.map((entry, index) => (
                    <Text key={index} style={styles.activityRow}>
                      {entry.dayName} — {formatShortDate(entry.sessionDate)}
                    </Text>
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={styles.card}>
              <Text>No tenés una rutina activa. Activá una desde el menú "Rutinas".</Text>
            </View>
          )}
        </>
      )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 16, padding: 16 },
  card: { width: '100%', gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 16 },
  routineName: { fontSize: 20, fontWeight: '700' },
  weekLabel: { color: '#666' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#eee', overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: '#111' },
  doneLabel: { color: '#16a34a', fontWeight: '600' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14 },
  buttonText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  streakCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    padding: 12,
  },
  streakText: { color: '#92400e', fontWeight: '600' },
  sectionTitle: { fontWeight: '700', fontSize: 15 },
  activityRow: { color: '#333' },
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
});
```

Note this removes the old in-body "Fit Tracker" title, the "Sesión iniciada como {email}" line, and the "Ver rutinas"/"Cerrar sesión" buttons — those move to the Drawer header/content in Task 7.

- [ ] **Step 2: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS (all existing tests unaffected — this task only touches a UI screen with no direct tests)

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/index.tsx"
git commit -m "feat: render Home as a dashboard with calendar, progress, activity, and streak"
```

---

### Task 7: Drawer navigation

**Files:**
- Create: `src/components/AppDrawerContent.tsx`
- Modify: `app/(app)/_layout.tsx`
- Modify (conditionally, only if the manual check in Step 4 finds double top-padding): `app/_layout.tsx`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.ts` (existing).
- Produces: the finished navigation shell. Terminal task — nothing downstream depends on this file's internals.

- [ ] **Step 1: Write `AppDrawerContent`**

Create `src/components/AppDrawerContent.tsx`:

```tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { DrawerContentScrollView, DrawerItemList, DrawerContentComponentProps } from 'expo-router/drawer';
import { supabase } from '../lib/supabase';

export function AppDrawerContent(props: DrawerContentComponentProps) {
  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.scrollContent}>
      <View style={styles.items}>
        <DrawerItemList {...props} />
      </View>
      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Cerrar sesión</Text>
      </Pressable>
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flex: 1, justifyContent: 'space-between' },
  items: { flex: 1 },
  signOutButton: {
    margin: 16,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#111',
    alignItems: 'center',
  },
  signOutText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 2: Replace `app/(app)/_layout.tsx`'s `Stack` with `Drawer`**

Replace the full contents of `app/(app)/_layout.tsx` with:

```tsx
import { Drawer } from 'expo-router/drawer';
import { AppDrawerContent } from '../../src/components/AppDrawerContent';

export default function AppLayout() {
  return (
    <Drawer screenOptions={{ headerShown: true }} drawerContent={(props) => <AppDrawerContent {...props} />}>
      <Drawer.Screen name="index" options={{ title: 'Inicio' }} />
      <Drawer.Screen name="routines" options={{ title: 'Rutinas' }} />
      <Drawer.Screen name="session" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
    </Drawer>
  );
}
```

This keeps the `session` route reachable via `router.push` (unchanged in `useHomeData.ts`/`index.tsx`) but hidden from the drawer's menu, per spec §6. `routines` and `session` each keep their own nested `Stack` (`app/(app)/routines/_layout.tsx`, `app/(app)/session/_layout.tsx`) unchanged — those still set `headerShown: false` internally, so only the Drawer's own header shows for `routines`, and `session` shows no header at all (matching its current no-header convention, since it's a focused flow entered via a button rather than the drawer).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (this task only touches navigation-shell files with no Jest coverage)

- [ ] **Step 4: Manual on-device verification — the required checks**

Start the app (`npx expo start`) and check, on a real device or simulator:

1. Home shows a hamburger icon in its header (titled "Inicio") that opens the drawer; the drawer lists "Inicio" and "Rutinas" (not "session"), plus a "Cerrar sesión" button pinned at the bottom.
2. Tapping "Rutinas" navigates to the routines list, its header now reads "Rutinas" with its own hamburger icon; the existing routine detail/new-routine screens (`app/(app)/routines/[routineId].tsx`, `app/(app)/routines/new.tsx`) still open and their swipe-back/hardware-back navigation still works exactly as before (they still have no header of their own — this is unchanged from the current app).
3. Starting or resuming a workout still pushes into `/(app)/session/[sessionId]` with no header (same as before this plan).
4. "Cerrar sesión" in the drawer actually signs out and returns to the sign-in screen.
5. **The specific risk flagged in spec §6:** compare the vertical gap between the physical status bar and the screen content on Home/Rutinas now vs. before this task. If there is a visibly doubled gap (the root `SafeAreaView`'s top inset stacking with the Drawer header's own safe-area handling), open `app/_layout.tsx` and change:
   ```tsx
   <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
   ```
   to:
   ```tsx
   <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
   ```
   (the Drawer header already accounts for the top safe area natively, so the outer `SafeAreaView` no longer needs to reserve that space). If there is no visible double-padding, leave `app/_layout.tsx` unchanged and note that in the commit/report.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppDrawerContent.tsx "app/(app)/_layout.tsx"
# If Step 4 required the app/_layout.tsx edge change, include it in the same commit:
# git add app/_layout.tsx
git commit -m "feat: replace Home's loose nav buttons with drawer navigation"
```

---

## Final Verification

- [ ] Run `npm test` once more from a clean state — full suite green.
- [ ] Manually walk through: cold start → sign in → Home dashboard renders calendar/progress/activity/streak → open drawer → Rutinas → back → start a workout → sign out via drawer.
