# Fit Tracker — Progress Charts & Personal Records — Design Spec

Date: 2026-10-01

## 1. Purpose

Every set the user logs is stored in `logged_sets`, but nothing in the app reads it back. This spec adds:

- A **Progress** section: a list of every exercise the user has trained, with a current number and a week-over-week trend arrow, and a per-exercise detail screen with a line chart and personal records.
- **Live PR detection**: while logging a session, a set that beats the user's previous best shows a brief "¡Nuevo PR!" banner. Works offline.

This is an addition on top of the implemented specs (`2026-09-13-fit-tracker-design.md`, `2026-09-16-fit-tracker-home-and-navigation-design.md`). It adds one database view and one local cache table; it does not change any existing table, the routine CRUD, the session-logging writes, or the progression engine.

## 2. Non-goals

- No offline Progress screen. The list and detail screens need connectivity; only live PR detection works offline (§7).
- No volume metric (weight × reps summed). Only estimated 1RM and weight (plus seconds / reps for exercises where those don't apply).
- No date-range filter on the chart. The full history is shown; a range filter can be added if it ever gets long.
- No shortcut to Progress from the session screen or Home. Entry is the drawer only.
- No end-of-session PR summary. PRs surface live, per set.
- No session history screen (that's the next sub-project).
- No automated UI/E2E tests (same policy as the main spec §11).

## 3. Definitions

### 3.1 Qualifying sets

A set counts toward progress and records only if:
- its session has `status = 'completed'`, and
- its `set_type` is not `'warmup'`.

Sets are grouped by the **catalog exercise** (`routine_exercises.exercise_id`), not by the routine line item, so "Press banca" logged in two different routines is one series. Sets whose routine, day, or routine exercise was later soft-deleted **still count**: history is immutable.

### 3.2 Exercise metric kind

Each exercise has exactly one metric kind, derived from its qualifying sets:

| kind | when | primary metric | alternative metric |
|---|---|---|---|
| `seconds` | the exercise's `rep_unit` is `'seconds'` | best seconds (the `reps` column) | none |
| `bodyweight` | `rep_unit` is `'reps'` and every qualifying set has `weight = 0` | best reps | none |
| `weighted` | `rep_unit` is `'reps'` and at least one qualifying set has `weight > 0` | estimated 1RM | weight |

For a `weighted` exercise, sets with `weight = 0` (for example, logged before the user set a weight) are ignored for every metric.

`rep_unit` is read from the routine exercise row the set was logged against. If one catalog exercise appears with different `rep_unit`s across routines, the value from the most recent set wins.

### 3.3 Estimated 1RM (Epley)

```
estimate1RM(weight, reps) =
  weight                         if reps = 1
  weight × (1 + reps / 30)       if reps > 1
  null                           if weight <= 0 or reps <= 0
```

The result is rounded to 0.1 kg. All comparisons (records, trend, live PR) use the rounded value, so a gain that rounds to zero is not a PR.

Display: drop the decimal when it is `.0` (`96 kg`, `97.5 kg`).

### 3.4 Chart points

One point per session. The point is the session's best qualifying set for the selected metric:
- 1RM view: the set with the highest estimated 1RM (ties: the heavier weight).
- Weight view: the set with the highest weight (ties: more reps).
- Seconds / reps (single-metric kinds): the highest value.

Each point keeps its source set (`weight`, `reps`, `session_date`) so tapping it can show "12/09 · 80 kg × 6".

### 3.5 Personal records

Per exercise, over all qualifying sets:
- `weighted`: **Best estimated 1RM** (value + the set that produced it + date) and **Best weight** (value + reps + date). Ties go to the earliest date (the date the record was first reached).
- `seconds`: **Best time**.
- `bodyweight`: **Most reps**.

### 3.6 Week-over-week trend

Per exercise, using its primary metric:
1. Bucket qualifying sets into calendar weeks, Monday to Sunday, by `session_date`.
2. Take each week's **best** value (not average, so a planned light day doesn't drag the trend down).
3. Compare the most recent week that has data against the previous week that has data. Weeks with no data are skipped.
4. `↑` if the change is above +1%, `↓` if below −1%, `→` otherwise.
5. No arrow if the exercise has data in fewer than 2 weeks.

A deload week will show `↓`. That's correct and needs no special case.

The number shown next to the arrow in the list is the most recent week's best value, so the number and the arrow always agree.

## 4. Data layer

### 4.1 Migration: `exercise_set_history` view

One new migration creates:

```sql
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

`security_invoker = true` makes the view run with the querying user's permissions, so the existing RLS policies on `logged_sets` and `workout_sessions` apply. Without it, a Postgres view runs as its owner and would expose every user's sets.

No soft-delete filter on `routine_exercises` or `exercises` (§3.1).

### 4.2 Query: `listExerciseSetHistory`

`src/lib/progress/queries.ts`:

```typescript
listExerciseSetHistory(
  supabase: SupabaseClient,
  userId: string,
  exerciseId?: string
): Promise<ExerciseSetRow[]>
```

- Filters by `user_id` (and `exercise_id` when given), ordered by `session_date`, then `logged_set_id`, for stable paging.
- **Pages through results** with `.range()` in pages of 1000 until a page comes back short. PostgREST caps responses at 1000 rows by default and truncates silently. A few months of training passes that.

### 4.3 Pure logic: `src/lib/progress/`

No Supabase, SQLite, or React imports. Each function's behavior is defined in §3.

| function | spec |
|---|---|
| `estimate1RM(weight, reps)` | §3.3 |
| `metricKind(sets)` | §3.2 |
| `bestSetPerSession(sets, metric)` | §3.4 |
| `computeRecords(sets)` | §3.5 |
| `computeWeeklyTrend(sets)` | §3.6 |
| `summarizeExercises(rows)` | groups rows by `exercise_id` into list items: name, kind, latest week's value, trend, last trained date |
| `detectLiveRecord(newSet, previousBest, earlierSessionSets)` | §7 |

### 4.4 Local cache: `exercise_records_cache`

A new SQLite table in `src/lib/sqlite/schema.ts`:

```sql
create table if not exists exercise_records_cache (
  exercise_id text primary key,
  best_e1rm real,
  best_weight real,
  best_seconds real,
  best_reps real
);
```

- **Refreshed** inside `refreshLocalCache`, the same place and moment the routine cache is refreshed today: fetch `listExerciseSetHistory(userId)`, run `computeRecords` per exercise, and replace the table's contents in the same transaction.
- **Merged locally on session completion**: `completeSession` folds the finished session's bests into the table (keeping the max per column), so a second offline session before any sync still compares against the latest records.

## 5. Screens

### 5.1 Navigation

- New drawer item **Progreso**, between "Rutinas" and the sign-out button, with `swipeEnabled: false` like "Rutinas".
- `app/(app)/progress/_layout.tsx`: a headerless `Stack`, same pattern as `app/(app)/routines/_layout.tsx`.

### 5.2 Progress list: `app/(app)/progress/index.tsx`

- One row per exercise from `summarizeExercises`, sorted by last trained date, most recent first.
- Each row: exercise name, the latest week's value with its unit (`96 kg`, `75 s`, `12 reps`), the trend arrow, and "hace N días" (relative last trained date).
- Tap: navigate to the detail screen.
- States:
  - Loading: the existing spinner component.
  - Empty: "Todavía no hay datos. Completá tu primera sesión para empezar a ver tu progreso."
  - Error / offline: "Conectate para ver tu progreso" plus a "Reintentar" button.

### 5.3 Exercise detail: `app/(app)/progress/[exerciseId].tsx`

- Header with the exercise name and a back arrow.
- `weighted` exercises: a two-option toggle, **1RM est.** (default) and **Peso**. Other kinds: no toggle.
- A line chart (`react-native-gifted-charts` `LineChart`) of `bestSetPerSession` for the selected metric, x-axis by date. Tapping a point shows its date and source set.
- With a single session: the one point plus "Seguí entrenando para ver la evolución".
- A **Récords** card per §3.5, for example:
  - `Mejor 1RM est. 96 kg` / `80 kg × 6 · 12/09`
  - `Mejor peso 85 kg` / `85 kg × 3 · 20/09`
- Same loading / error states as the list.

### 5.4 Hook: `useExerciseProgress`

`src/hooks/useExerciseProgress.ts` exposes the list data and the detail data (by `exerciseId`), each with `{ data, isLoading, error, refetch }`, following the existing hooks' error-surfacing pattern (a rejected fetch sets `error`, never leaves `isLoading` stuck).

### 5.5 Dependencies

- `react-native-gifted-charts` and its peer `react-native-svg` (installed with `npx expo install` so the version matches the Expo SDK). Both run in Expo Go. The implementation plan must check gifted-charts' current peer dependencies (for example, a linear-gradient package) and install those through `npx expo install` too.

## 6. Data flow

```
session screen ──logSet──▶ pending_writes ──sync──▶ logged_sets (Supabase)
                                                         │
                                         exercise_set_history (view, RLS)
                                          │                         │
                          listExerciseSetHistory          refreshLocalCache
                                          │                         │
                          pure functions (§4.3)        exercise_records_cache
                                          │                         │
                            Progress list / detail     detectLiveRecord in logSet
```

## 7. Live PR detection

In `useSessionSets.logSet`, after the set is enqueued (existing behavior unchanged):

1. Skip if the set is a warmup.
2. Read the exercise's row from `exercise_records_cache` (`previousBest`).
3. **No row means the exercise has no completed-session history: no celebration.** This keeps a first session from flagging every exercise as a PR.
4. Baseline per metric = max(`previousBest`, best among this session's earlier qualifying sets of the same `exercise_id`). Including the current session's earlier sets means a lighter set after a PR set never re-celebrates, and the same record isn't celebrated twice.
5. A record is broken when the new set's value is **strictly greater** than the baseline, for any of the exercise's metrics:
   - `weighted`: estimated 1RM and/or weight (sets with `weight = 0` never qualify).
   - `seconds`: seconds.
   - `bodyweight`: reps.
6. If any record broke, show the banner.

### 7.1 Banner

A small non-blocking banner at the top of the session screen. It auto-dismisses after about 3 seconds and needs no tap.

```
🏆 ¡Nuevo PR en Press banca!
1RM est. 98 kg (antes 96 kg)
```

If two records broke: `1RM est. 98 kg · Peso 85 kg`. A new banner replaces any visible one. Built as a plain component in `src/components/`, with no toast library.

## 8. Error handling

- Progress screens: any fetch failure (offline, timeout, RLS error) shows the "Conectate" state with retry. Partial pagination failure counts as failure; never render a truncated history.
- Cache refresh: a failure fetching history leaves `exercise_records_cache` untouched (the existing transaction pattern), so live PRs keep comparing against the last good snapshot.
- Live PR detection must never block or fail `logSet`: any error inside it is caught and the set is still logged, with no banner.

## 9. Testing

### Unit (`checks` CI job)

- `estimate1RM`: normal case, 1 rep, weight 0, reps 0, rounding to 0.1.
- `metricKind`: seconds, bodyweight, weighted, weighted with some zero-weight sets.
- `bestSetPerSession`: correct pick per metric, including ties.
- `computeRecords`: correct value, source set and earliest date per kind.
- `computeWeeklyTrend`: up / flat / down around the 1% threshold, empty weeks skipped, fewer than 2 weeks gives no arrow, Monday-to-Sunday bucketing (Sunday and the next Monday land in different weeks).
- `summarizeExercises`: grouping, sort order, latest-week value matches the trend's week.
- `detectLiveRecord`: beats previous best; doesn't; no history gives no celebration; a lighter set after an in-session PR doesn't celebrate; two records at once; weight 0; seconds; bodyweight.
- SQLite schema: `exercise_records_cache` is created (extends the existing schema test).

### Integration (`integration` CI job, `*.integration.test.ts`)

- The view excludes warmup sets and sets from `in_progress` sessions.
- The view merges one catalog exercise logged across two routines.
- The view respects RLS: user A querying through an anon-key client signed in as A sees none of user B's sets.
- `listExerciseSetHistory` returns every row when there are more than 1000 (seed 1001+ sets).

### Manual (device)

- Complete a session; it appears in Progreso with the right number.
- Beat a record; the banner shows with the right values; a lighter set afterwards shows no banner.
- First session of a brand-new exercise shows no banner.
- Airplane mode: Progreso shows "Conectate"; live PR still works.

## 10. Closing walkthrough

Per the agreed working mode, the sub-project ends with a logic walkthrough for the user (no code reading required) plus 4–5 interview-style questions, covering: why the view uses `security_invoker`, why pagination is needed, why the formula lives in one place (TypeScript) rather than in SQL, and how live PRs work offline.
