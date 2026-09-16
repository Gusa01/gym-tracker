# Fit Tracker — Home Dashboard & Drawer Navigation — Design Spec

Date: 2026-09-16

## 1. Purpose

The Home screen currently shows only today's resolved day and a start/resume-session button, with "Ver rutinas" and "Cerrar sesión" as loose buttons in its body. This spec turns Home into a small dashboard (weekly schedule at a glance, week progress, recent activity, a consistency streak) and moves the two navigation actions into a drawer, so Home's body is free to be dashboard content instead of a mix of data and app-chrome.

This is an addition on top of the already-implemented spec (`docs/superpowers/specs/2026-09-13-fit-tracker-design.md`) — it doesn't change any existing data model, routine-CRUD, session-logging, or progression-engine behavior. It only reads existing tables and adds new client-side presentation logic plus a navigation-shell change.

## 2. Non-goals

- No changes to the weekly schedule data model (`routines.weekday_schedule`) — the calendar is read-only, reusing the exact resolution logic already built for "today."
- No exact reconstruction of historical adherence (which days were actually scheduled on any given past week, accounting for routine switches or since-edited schedules). The consistency streak intentionally uses a simpler, coarser definition (§5).
- No per-day tap-through from the calendar strip to that day's detail — informational only for this pass.
- No changes to how routines/sessions are created or logged.

## 3. Weekly calendar strip

A row of 7 cells, Monday through Sunday, each showing:
- The weekday abbreviation (Lun, Mar, Mié, Jue, Vie, Sáb, Dom).
- The resolved routine day's name for that weekday this week (e.g. "Día A"), or "Descanso" if the weekday has no entry in `weekday_schedule`, or the day it resolves to has `is_rest_day = true`.
- A visual highlight on today's cell.

Resolution reuses `resolveTodayDayId` (already built) once per weekday, all against the **current** week number (`computeWeekNumber(routine.started_at, now)` — already built) — this is what makes an alternating Friday (`{ even_week, odd_week }`) resolve correctly without new logic. The pure function that assembles the full week:

```typescript
export interface WeekCalendarDay {
  weekday: Weekday;
  label: string;
  dayName: string | null;
  isRestDay: boolean;
  isToday: boolean;
}

function buildWeekCalendar(
  weekdaySchedule: Record<string, unknown>,
  days: { id: string; name: string; is_rest_day: boolean }[],
  weekNumber: number,
  today: Date
): WeekCalendarDay[]
```

If the active routine has no schedule entry for a weekday and no day resolves, that cell shows "Descanso" (blank/rest) — this matches the existing single-day resolution's behavior (no entry = no trainable day).

## 4. Week progress bar

Replaces the current plain "Semana N" text when the routine has a `suggested_duration_weeks`:

```typescript
function computeWeekProgress(weekNumber: number, suggestedDurationWeeks: number | null): number | null
```

Returns a 0-1 fraction (`weekNumber / suggestedDurationWeeks`, capped at 1) or `null` when the routine is indefinite (`suggested_duration_weeks === null`). When `null`, Home falls back to the current plain "Semana N" text — no bar for an indefinite routine, since there's nothing to show progress toward.

## 5. Recent activity and consistency streak

Both are derived from one new query, fetched once:

```typescript
export async function listRecentCompletedSessions(
  supabase: SupabaseClient,
  userId: string,
  limit = 30
): Promise<{ sessionDate: string; dayName: string }[]>
```

Selects `workout_sessions` joined to `routine_days` for the name, filtered to `status = 'completed'`, ordered by `session_date` descending, capped at `limit` (30 is enough history for the streak calculation below while staying a cheap single query for a personal app's data volume).

**Recent activity list:** the first 5 entries, shown as "Día A — 12/09" style rows.

**Consistency streak (simplified, per the approved design):** *not* "did I train every day my schedule said to" — that would require reconstructing which days were scheduled on each past week, which breaks the moment a routine is edited or switched. Instead: **consecutive calendar weeks (Monday-anchored) with at least one completed session**, counted backwards from the current week. If the current week has no session yet (e.g., checking Home on a Monday before training), that week is skipped once rather than breaking the streak, and counting starts from the most recent week that does have one:

```typescript
export function computeConsecutiveActiveWeeks(sessionDates: string[], now: Date): number
```

Algorithm: convert each date to its Monday-anchored week key; walk backwards one week at a time from the current week (skipping forward past an empty *current* week exactly once), counting consecutive weeks present in the set, stopping at the first gap.

## 6. Drawer navigation

`app/(app)/_layout.tsx` changes from a plain `Stack` to `expo-router/drawer`'s `Drawer`, with two visible items:
- **Inicio** (`index` — Home)
- **Rutinas** (`routines` — the existing routines Stack, unchanged internally)

The `session` route group is still reachable via `router.push` but hidden from the drawer's menu (`drawerItemStyle: { display: 'none' }`) — it's a flow you're pushed into from Home, not a standalone destination.

A custom drawer content component (`src/components/AppDrawerContent.tsx`) renders the default item list plus a "Cerrar sesión" button pinned at the bottom, calling `supabase.auth.signOut()` (same call already used inline on Home today).

**No new dependency needed.** This project's installed `expo-router` (SDK 57) vendors its own drawer implementation and exports everything needed — `Drawer`, `DrawerContentScrollView`, `DrawerItemList`, etc. — directly from `expo-router/drawer`, specifically so apps don't need `@react-navigation/drawer` as a separate dependency. Its only native dependency (`react-native-drawer-layout`) is already present transitively via `expo-router` itself.

**Known follow-up risk (not a design decision, a verification item):** the root `app/_layout.tsx` currently wraps everything in a `SafeAreaView` with `edges={['top', 'bottom']}`. Drawer screens get their own header (needed for the hamburger icon that opens the drawer), which may double up on top spacing. This plan's implementation task must check this on-device and adjust the root layout's `edges` if needed — noted here so it isn't a surprise, not resolved in this doc since it needs a running app to see.

## 7. Files

**Create:**
- `src/lib/home/weekCalendar.ts` — `buildWeekCalendar`, `computeWeekProgress` (pure, tested)
- `src/lib/home/streak.ts` — `computeConsecutiveActiveWeeks` (pure, tested)
- `src/components/AppDrawerContent.tsx`
- `src/components/WeekCalendarStrip.tsx` (renders `WeekCalendarDay[]`)

**Modify:**
- `src/lib/sessions/queries.ts` — add `listRecentCompletedSessions`
- `src/hooks/useHomeData.ts` — fetch and expose calendar/progress/activity/streak data
- `app/(app)/index.tsx` — render the new dashboard sections, remove the "Ver rutinas"/"Cerrar sesión" buttons
- `app/(app)/_layout.tsx` — `Stack` → `Drawer`

## 8. Testing

- `buildWeekCalendar`, `computeWeekProgress`, `computeConsecutiveActiveWeeks` are pure — unit tested directly, covering: alternating-week resolution in the calendar, the indefinite-routine (`null`) case for progress, and the streak's current-week-skip/gap-stops-the-count behavior.
- `listRecentCompletedSessions` is tested against the real hosted Supabase project, matching every other query in this codebase.
- The Drawer restructuring and the dashboard's on-screen assembly are UI wiring — verified manually on-device, consistent with this project's established testing strategy (spec §11.4 of the original design doc).
