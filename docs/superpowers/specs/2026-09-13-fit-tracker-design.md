# Fit Tracker — Design Spec

Date: 2026-09-13

## 1. Purpose

A native mobile app to run the routine defined in `rutina_gym_top_set_back_off.md`,
log every set performed at the gym, and use that log to:

- Suggest progressive overload (when to raise weight on an exercise).
- Detect when a deload is needed, based on how far actual performance falls
  from the target (reps and RIR), not just a binary hit/miss.
- Detect when it's time to move from one routine to the next (e.g. the
  document's Full Body phase → Split phase transition), while allowing
  manual switching to any routine at any time.

The `.md` file is imported once as the initial seed data. After import, the
app — not the file — is the source of truth; the file is not read or
rewritten by the running app.

## 2. Non-goals

- No social features, no nutrition tracking, no rest timer, no wearable
  integration.
- No admin panel or generic "routine marketplace" — routines are created via
  the one-time import script or manual editing in-app.
- No generic markdown-routine parser — the import script is written against
  this specific document's structure.
- No automated E2E/UI test suite (see §11).

## 3. Architecture

**Client:** Expo (React Native), targeting iOS and Android from one codebase.
- `expo-sqlite` holds a local read-only cache of the active routine
  (`routines`, `routine_days`, `routine_exercises`, `user_exercise_state`) so
  the app is fully usable without connectivity.
- A generic `pending_writes` local table queues writes (new sessions, logged
  sets) made while offline.
- `@supabase/supabase-js` talks to the backend when connectivity is
  available; session persisted via `AsyncStorage` so login survives app
  restarts.
- A sync service, driven by `@react-native-community/netinfo` and app
  foreground events, flushes `pending_writes` in FIFO order on reconnect and
  refreshes the local cache.

**Backend:** Supabase (managed Postgres + Auth).
- Postgres holds the source of truth for all data.
- Supabase Auth (email/password) with Row Level Security scoping every
  user-owned table to `auth.uid()`.

**Distribution:** EAS Build produces installable `.apk`/`.ipa` files, sideloaded
directly onto devices — no App Store / Play Store submission.

**Import:** a standalone Node script (`scripts/import-routine.ts`), run
manually with the Supabase service-role key, parses the `.md` once and seeds
the database for a given user.

## 4. Data model

### Catalog

**`exercises`** — shared catalog across all users.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text, unique | |
| muscle_group | text | drives progression increment size (upper vs lower body) |

### Routine structure (editable, not versioned)

**`routines`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk → auth.users | |
| name | text | e.g. "Full Body", "Split 5 días" |
| uses_top_set_backoff | boolean | |
| suggested_duration_weeks | int, nullable | null = indefinite |
| next_routine_id | uuid fk → routines.id, nullable | suggested follow-up routine |
| weekday_schedule | jsonb | see below |
| is_active | boolean | exactly one active routine per user at a time |
| started_at | timestamptz | when this routine became active |
| is_deleted | boolean, default false | soft delete — see §6 |

`weekday_schedule` maps weekdays to a `routine_day_id`, with an alternation
form for days that rotate between two day-templates (e.g. the document's
Friday, which alternates Día A / Día B by week parity). Example, for the
Full Body routine:

```json
{
  "mon": "day-a-uuid",
  "tue": "core-uuid",
  "wed": "day-b-uuid",
  "thu": "core-uuid",
  "fri": { "even_week": "day-a-uuid", "odd_week": "day-b-uuid" }
}
```

There is no persisted "Día C" — it is purely a scheduling rule, not a
distinct set of exercises, so it isn't modeled as its own `routine_days` row.

**`routine_days`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| routine_id | uuid fk → routines.id | |
| name | text | e.g. "Día A", "Upper", "Core" |
| order_index | int | display order only |
| is_rest_day | boolean | true only for genuine no-training days (e.g. Phase 2 Wednesday) |
| is_deleted | boolean, default false | soft delete — see §6 |

**`routine_exercises`** — one row per exercise line within a day.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| routine_day_id | uuid fk → routine_days.id | |
| exercise_id | uuid fk → exercises.id | |
| order_index | int | |
| role | text: `main` \| `accessory` \| `core` | |
| scheme_type | text: `normal` \| `top_set_backoff` | |
| rep_unit | text: `reps` \| `seconds`, default `reps` | for time-based core work (e.g. plancha) |
| sets | int, nullable | used when `scheme_type = normal` |
| rep_min | int | |
| rep_max | int | |
| rir_min | int, nullable | null for core exercises (the document defines no RIR target for core) |
| rir_max | int, nullable | |
| top_set_reps | int, nullable | used when `scheme_type = top_set_backoff` |
| backoff_sets | int, nullable | |
| backoff_rep_min | int, nullable | |
| backoff_rep_max | int, nullable | |
| is_deleted | boolean, default false | soft delete — see §6 |

### Progress state (mutable, drives overload suggestions)

**`user_exercise_state`** — anchored to the global exercise, not to a
specific routine's line item, so progress carries over when the same
exercise reappears in a different routine or day.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk | |
| exercise_id | uuid fk → exercises.id | |
| current_weight | numeric, nullable | null until first logged |
| suggested_next_weight | numeric, nullable | computed after a session; prefills the next occurrence |
| consecutive_hit_count | int, default 0 | |
| consecutive_miss_count | int, default 0 | |
| updated_at | timestamptz | |

Unique constraint on `(user_id, exercise_id)`.

### History (immutable log)

**`workout_sessions`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk | |
| routine_day_id | uuid fk → routine_days.id | the resolved day actually trained |
| session_date | date | |
| week_number | int, nullable | computed from the active routine's `routine_history.started_at` |
| status | text: `in_progress` \| `completed` | |

**`logged_sets`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| session_id | uuid fk → workout_sessions.id | |
| routine_exercise_id | uuid fk → routine_exercises.id | |
| set_index | int | |
| set_type | text: `top_set` \| `back_off` \| `working` \| `warmup` | |
| weight | numeric | |
| reps | numeric | interpreted as reps or seconds per `routine_exercises.rep_unit` |
| rir | numeric, nullable | null for core exercises |
| created_at | timestamptz | |

**`routine_history`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk | |
| routine_id | uuid fk → routines.id | |
| event_type | text: `started` \| `deload` | |
| occurred_at | timestamptz | |
| note | text, nullable | |

### Local SQLite mirror (device)

- Read-only cache of `routines` / `routine_days` / `routine_exercises` /
  `user_exercise_state` for the current user, refreshed opportunistically
  when online.
- `pending_writes (id, entity, payload_json, created_at, attempts)` — queues
  `workout_sessions` / `logged_sets` inserts made offline; flushed FIFO on
  reconnect.

## 5. Import flow

`scripts/import-routine.ts`, run once manually:

1. Reads `rutina_gym_top_set_back_off.md` from the repo root.
2. Parses its specific structure: phase headings → day subheadings → table
   rows. Two row formats are handled via regex:
   - `3×8-10` → normal `sets`/`rep_min`/`rep_max`.
   - `Top set 1×5-6 + Back-off 2×8-10` → `top_set_reps` +
     `backoff_sets`/`backoff_rep_min`/`backoff_rep_max`.
   - `3×30-40s` (core) → `rep_unit = seconds`, no RIR column present in the
     source table, so `rir_min`/`rir_max` are left null.
3. Infers `role` from the row's phrasing: "movimiento completo" → `main`,
   "(accesorio ...)" → `accessory`, rows in a Tue/Thu core table → `core`.
4. Upserts new exercise names into the global `exercises` catalog
   (deduplicated by name).
5. Creates two `routines` rows — "Full Body" (`suggested_duration_weeks = 4`,
   `next_routine_id` → "Split 5 días") and "Split 5 días"
   (`suggested_duration_weeks = null`) — each with their `routine_days`,
   `routine_exercises`, and `weekday_schedule` built from the document's
   structure (including the Friday alternation rule).
6. Is idempotent by routine name: if a routine with that name already exists
   for the target user, it aborts with a warning instead of duplicating.
7. Does not touch `user_exercise_state` — starting weights are entered by
   the user the first time they train each exercise from the app.

## 6. Routine management (CRUD)

The MVP includes full create/edit/delete for routines via in-app forms, not
just the one-time import — the imported Full Body / Split routines are
regular data the user can then edit like any routine they build themselves.

**Screens:**
- **Routines list** — every routine for the user, active one flagged, with
  actions to activate, edit, or delete.
- **Routine editor** — name, `uses_top_set_backoff`, `suggested_duration_weeks`,
  `next_routine_id` (picked from the user's other routines), and the list of
  days (add/remove/reorder).
- **Day editor** — name, `is_rest_day`, and the list of exercises
  (add/remove/reorder).
- **Exercise form** — pick an existing `exercises` entry or type a new name
  (adding it to the shared catalog), `role`, `scheme_type`, `rep_unit`, and
  the scheme fields relevant to the chosen `scheme_type` (the form only
  shows `rep_min`/`rep_max`/`rir_min`/`rir_max` for `normal`, or
  `top_set_reps`/`backoff_*` for `top_set_backoff`). Basic validation:
  `rep_min <= rep_max`, `rir_min <= rir_max`, required fields per scheme
  type.

**Deletion is a soft delete** (`is_deleted = true`) on `routines`,
`routine_days`, and `routine_exercises`, not a hard row delete. All reads
filter `is_deleted = false`. This is because `workout_sessions` /
`logged_sets` reference these rows as historical fact (what you actually
trained against on a given day) — hard-deleting would either cascade and
destroy training history, or require restrict-with-a-fallback logic that
soft delete avoids entirely. Deleting a routine cascades the soft-delete
flag to its days and exercises.

**Simplification (documented, not solved):** editing an existing
`routine_exercise`'s scheme (e.g. raising `rep_max` from 10 to 12) mutates
that row in place. Past `logged_sets` stay linked to it, so if you later
look at old history, it's evaluated against the *current* target, not the
target that was active when you logged it. Versioning scheme changes over
time would fix this but isn't justified for MVP; revisit if it becomes a
real problem.

## 7. Client logging flow

1. **Home** shows the active routine, current week number, and today's
   resolved day (via `weekday_schedule`). "Empezar entrenamiento" creates a
   `workout_sessions` row, or resumes one already `in_progress` for today.
2. **Session screen** lists the day's exercises with their target scheme
   (e.g. "3×8-10 @ RIR 2-3" or "Top set 1×5-6 + Back-off 2×8-10"). Each set
   row has: weight (prefilled from `suggested_next_weight` or
   `current_weight`, with ±1.25/2.5/5kg steppers), reps or seconds per
   `rep_unit`, an RIR selector (0-4, hidden for core exercises), and a
   check button to log it.
3. Logging a set writes immediately to the local queue and updates the UI
   optimistically; it syncs to Supabase right away if online, or stays
   queued if not.
4. There is no separate "accept suggestion" dialog: completing an exercise
   recomputes `suggested_next_weight` (§8), and that value simply prefills
   the weight field the next time this exercise comes up — editing that
   field before logging *is* the override.
5. "Terminar entrenamiento" marks the session `completed`. At that point
   (and on every Home load) deload and routine-switch conditions (§8) are
   evaluated; if triggered, a dismissible banner offers Aceptar/Ignorar.
6. Home and the session screen always read the local cache first, so both
   are usable offline; a connectivity listener flushes `pending_writes` and
   refreshes the cache on reconnect or app foreground.

## 8. Progression, deload, and routine-switch logic

All of this is computed on read from `logged_sets` / `routine_history` —
there is no persisted "pending suggestion" table.

**Progression (raise weight):** after all sets of an exercise are logged in
a session, if every set met `reps >= rep_max` at `rir` within
`[rir_min, rir_max]`, set `suggested_next_weight = current_weight +
increment` (2.5-5kg for `muscle_group` classified as lower body, 1-2.5kg for
upper body). Otherwise `suggested_next_weight` stays equal to
`current_weight`.

**Deload:** for exercises with `scheme_type = top_set_backoff`, compute a
deficit for the top set each session — `rep_min - reps` (positive = came up
short) and how far `rir` fell below `rir_min` (e.g. reporting RIR 0 when 1-2
was expected is a stronger signal than just missing the rep count). If the
top set shows a rep and/or RIR deficit in **two consecutive sessions** for
the same exercise, the Home screen surfaces a deload suggestion. This reads
the last two relevant sessions directly — no extra state is stored beyond
what's already in `logged_sets`.

**Routine switch:** compare `now - started_at` (from the current active
routine's most recent `routine_history` "started" event) against
`suggested_duration_weeks`. If exceeded, Home suggests switching to
`next_routine_id`. The user may switch to any routine at any time regardless
of this suggestion; switching sets the old routine `is_active = false`, the
new one `is_active = true, started_at = now`, and inserts a `routine_history`
"started" row. Accepting a deload suggestion inserts a `routine_history`
"deload" row for the current routine.

## 9. Auth and multi-user

- Supabase Auth, email/password only (no social login, no magic link).
- Session persisted via `AsyncStorage` so the user stays logged in across
  app restarts.
- Row Level Security on every user-owned table (`routines`,
  `user_exercise_state`, `workout_sessions`, `logged_sets`,
  `routine_history`), each carrying `user_id` directly for simple, fast
  policies. `routine_days` / `routine_exercises` are scoped via a join back
  to `routines.user_id`.
- `exercises` is a shared catalog: readable by any authenticated user;
  insertable by any authenticated user (adding a new exercise while editing
  a routine adds it to the shared catalog). No update/delete policy needed
  at this scope.
- No admin role, no cross-user visibility.

## 10. Offline sync

- Reads: Home and session screens always read the local SQLite cache first.
- Writes: every set/session write goes to `pending_writes` immediately and
  updates local state optimistically, then attempts a Supabase write; on
  failure it stays queued.
- A `netinfo` listener plus an app-foreground hook trigger a flush of
  `pending_writes` in FIFO order, followed by a cache refresh.
- Conflict handling is intentionally minimal: the user is effectively the
  sole writer of their own data and writes are append-only (new sessions/
  sets), so there is no merge logic beyond "retry until it lands."

## 11. Testing strategy

Automated testing is concentrated on the domain logic most likely to fail
silently and produce a wrong recommendation:

1. **Unit tests (Jest) for the progression/deload/routine-switch
   calculations** (§8) — pure functions over `logged_sets` /
   `routine_history` data, covering edge cases (RIR exactly at the boundary,
   reps exactly at `rep_min`/`rep_max`, exactly two consecutive misses,
   `suggested_duration_weeks` boundary).
2. **Unit tests for the import parser**, run against the real `.md` as a
   fixture, asserting the exact exercises, schemes, and `rep_unit` values
   extracted.
3. **Tests for the offline queue** against a mocked Supabase client:
   offline write → row appears in `pending_writes` → simulated reconnect →
   queue flushes in order → mock receives the expected calls.
4. **No automated E2E/UI testing.** Screens and the real on-device offline
   behavior are verified manually before considering a feature done — not
   worth the maintenance cost for a single-developer personal app.

## 12. Open items for the implementation plan

- Exact Postgres migration files / RLS policy SQL.
- Expo project scaffold, navigation structure, and screen-level UI details.
- Exact increment table for `muscle_group` → weight increment.
