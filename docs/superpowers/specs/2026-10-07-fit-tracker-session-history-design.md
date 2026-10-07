# Fit Tracker — Session History & Set Corrections — Design Spec

Date: 2026-10-07

## 1. Purpose

Logged sessions can't be looked at again, and a mistyped set can't be fixed. This spec adds:

- A **Historial** section: a list of completed sessions and a set-by-set detail screen.
- **Set corrections**: change the weight, reps or RIR of a logged set, or delete it — from a past session's detail and from the in-progress session screen, through one shared editor.

It builds on the implemented specs (`2026-09-13-fit-tracker-design.md`, `2026-10-01-fit-tracker-progress-and-prs-design.md`). It adds one column and recreates one view; every write goes through the existing offline queue.

## 2. Non-goals

- No adding a forgotten set to a past session, and no deleting a whole session.
- **No progression recompute.** Correcting a set never changes `user_exercise_state` (suggested weight, hit/miss counters). Charts, records and trends read history and fix themselves; the user adjusts a wrong suggested weight with the weight stepper next session.
- No offline history screens (list and detail need connectivity; corrections themselves work offline).
- No edit history / audit trail beyond the soft-delete flag.
- No automated UI/E2E tests (main spec §11).

## 3. Data model

### 3.1 Migration

```sql
alter table public.logged_sets
  add column is_deleted boolean not null default false;
```

`exercise_set_history` is recreated (`create or replace view`) with one more filter, `and ls.is_deleted = false`, and **must keep `with (security_invoker = true)`** so RLS keeps applying (see the progress spec §4.1).

Soft delete keeps the project rule that app code never hard-deletes rows, and makes a delete just another upsert through the existing offline queue.

### 3.2 Readers that must ignore deleted sets

These are the only places that read `logged_sets` today (checked by search on 2026-10-07):

| Reader | Change |
|---|---|
| `exercise_set_history` view | filter in the view (3.1) |
| `listSessionSets` (`src/lib/sessions/queries.ts`) | `.eq('is_deleted', false)` |
| `listRecentTopSets` (`src/lib/progression/queries.ts`, deload detection) | `.eq('is_deleted', false)` |

New readers in this spec filter the same way. `LoggedSet` gains `is_deleted?: boolean`.

## 4. Writes

Both corrections reuse `enqueueWrite(db, id, 'logged_sets', payload)` followed by `flushOnly`, exactly like logging a set:

- **Edit** = upsert of the **full row** (same `id`, same `session_id`, `routine_exercise_id`, `set_index`, `set_type`, `created_at`) with the new `weight`, `reps`, `rir`. The full row is sent because an upsert's insert half must satisfy the NOT NULL columns.
- **Delete** = the same full-row upsert with `is_deleted: true`.

Each write gets its own `pending_writes` id (a fresh UUID), never the set's id, so two queued corrections to one set don't collide in the queue.

The screen updates optimistically: local state changes immediately (an edited set shows its new values; a deleted set disappears).

After a correction the app runs `syncNow` (flush, then `refreshLocalCache`), so `exercise_records_cache` is rebuilt from server history and a deleted false record stops counting for live PRs. Offline, the cache is refreshed at the next successful sync.

## 5. Screens

### 5.1 Navigation

- Drawer item **Historial** after "Progreso", `swipeEnabled: false`.
- `app/(app)/history/_layout.tsx`: headerless `Stack`, same as `progress/_layout.tsx`.
- **Home**: each "Actividad reciente" row opens that session's detail. `listRecentCompletedSessions` also returns the session `id`.

### 5.2 History list — `app/(app)/history/index.tsx`

- Completed sessions, newest first, 30 per page, the next page loading when the list nears its end.
- Each row: short weekday + date and the routine day name (`Jue 02/10 · Push`), then `N ejercicios · M series` (deleted sets excluded), and `›`.
- States: spinner on first load; empty → "Todavía no hay sesiones. Completá tu primera sesión para verla acá."; error → "Conectate para ver tu historial" + "Reintentar". A failed page never shows a partial list as complete: a failure on page 2+ keeps the loaded rows and shows a "Reintentar" row at the end.

### 5.3 Session detail — `app/(app)/history/[sessionId].tsx`

- Header: back arrow + `Jue 02/10 · Push`.
- One block per exercise, in routine order (`routine_exercises.order_index`), including exercises later removed from the routine. Each set row: label (`Top set`, `Back-off`, `Serie N`), `weight kg × reps` (`75 s` for time-based, `12 reps` for zero-weight), `RIR n` when present, and a `✎` button.
- An exercise whose sets were all deleted is not shown.
- Same loading/error states as the list.
- After a successful correction: a short note "Corregido. El peso sugerido no cambia; si quedó mal, ajustalo en tu próxima sesión."

### 5.4 Set editor — `src/components/SetEditor.tsx`

A bottom-sheet modal, shared by the history detail and the session screen.

- Fields, prefilled with the set's values: weight (`WeightStepper`) unless the exercise is time-based; reps or seconds (`StepperInput`); RIR (`StepperInput`) only when the exercise has an RIR target.
- **Guardar**: disabled while invalid (§6) or saving, with the reason shown under the fields.
- **Borrar serie**: asks "¿Borrar esta serie?" (Cancelar / Borrar). Disabled while saving.
- **Cancelar** closes without changes.

### 5.5 Session in progress

- Each logged row in `SessionExerciseCard` (`✓ Serie 1 (...): 80kg × 8`) gets a `✎` that opens `SetEditor`.
- Deleting a set makes that set index the next one to log again (the card already picks the first prescribed index with no logged set).
- Editing a set of an exercise already completed in this session does not recompute progression. Deleting one and logging it again recomputes when the exercise completes again (existing logic).

## 6. Pure logic — `src/lib/history/`

No Supabase, SQLite or React imports; unit-tested.

| Function | Behavior |
|---|---|
| `summarizeSession(sets)` | `{ exerciseCount, setCount }` over non-deleted sets; exercises counted by distinct `routine_exercise_id`. |
| `groupSessionSets(sets, exercises)` | Groups non-deleted sets by routine exercise, exercises ordered by `order_index`, sets by `set_index`; drops exercises with no sets. |
| `validateSetEdit(values, exercise)` | Returns `null` or the first error message (Spanish): reps/seconds must be a whole number ≥ 1; weight ≥ 0 (ignored for time-based); RIR, when shown, a whole number 0–10. |
| `formatSessionTitle(date, dayName)` | `Jue 02/10 · Push` (Spanish weekday abbreviations, Monday = Lun). |

## 7. Queries — `src/lib/history/queries.ts`

- `listCompletedSessions(supabase, userId, page)`: completed sessions, newest first (`session_date`, then `id`), `PAGE_SIZE = 30`, with `routine_days(name)` and the session's non-deleted `logged_sets(routine_exercise_id)` for the counts.
- `getSessionDetail(supabase, sessionId)`: the session (date, day name), its non-deleted sets, and the routine exercises those sets point to (name, order, scheme, rep unit, RIR target) — soft-deleted routine exercises included.

## 8. Hooks

`useSessionHistory(userId)` (pages, `loadMore`, `refetch`) and `useSessionDetail(sessionId)` follow the progress hooks' pattern: refetch on focus, a request counter so stale responses never overwrite newer state, errors set an error message and never leave `isLoading` stuck.

## 9. Error handling

- Corrections are queued like any logged set: offline they stay queued and sync later; a rejected write stays in the queue and retries (existing behavior).
- The editor never closes on a validation error; it closes after the correction is queued.
- Delete requires confirmation; buttons are disabled while saving to prevent double taps.

## 10. Testing

### Unit
- `summarizeSession`: counts without deleted sets; a session with no sets → 0/0.
- `groupSessionSets`: routine order, set order, removed exercises included, all-deleted exercise dropped.
- `validateSetEdit`: valid values; reps 0; negative weight; RIR out of range; time-based ignores weight; no RIR field when the exercise has no RIR target.
- `formatSessionTitle`: weekday and date format.

### Integration (`*.integration.test.ts`)
- A set upserted with `is_deleted: true` disappears from `exercise_set_history` and `listSessionSets`.
- The recreated view still respects RLS (another user sees nothing).
- Upserting an edited set changes its values without creating a second row.
- `listCompletedSessions` returns only completed sessions, newest first, paged, with counts excluding deleted sets.
- `getSessionDetail` returns non-deleted sets and their exercises, including a soft-deleted routine exercise.

### Manual (device, demo user)
1. Historial lists sessions and opens the detail; a Home "Actividad reciente" row opens the same detail.
2. Correcting a weight changes the Progreso chart.
3. Deleting the set that held a record lowers the record.
4. In a live session, deleting a set makes it the next one to log.
5. Airplane mode: a correction shows immediately and syncs when back online.
