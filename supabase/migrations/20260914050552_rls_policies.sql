alter table public.exercises enable row level security;
alter table public.routines enable row level security;
alter table public.routine_days enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.user_exercise_state enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.logged_sets enable row level security;
alter table public.routine_history enable row level security;

-- exercises: shared catalog, readable & insertable by any authenticated user
create policy "exercises_select_all" on public.exercises
  for select using (auth.role() = 'authenticated');
create policy "exercises_insert_all" on public.exercises
  for insert with check (auth.role() = 'authenticated');

-- routines: owner only
create policy "routines_owner_select" on public.routines
  for select using (user_id = auth.uid());
create policy "routines_owner_insert" on public.routines
  for insert with check (user_id = auth.uid());
create policy "routines_owner_update" on public.routines
  for update using (user_id = auth.uid());
-- No delete policy: routines are soft-deleted via UPDATE is_deleted = true (Global Constraints).
-- Omitting the policy makes the database itself refuse a hard DELETE, not just app convention.

-- routine_days: via routines join
create policy "routine_days_owner_select" on public.routine_days
  for select using (exists (
    select 1 from public.routines r where r.id = routine_days.routine_id and r.user_id = auth.uid()
  ));
create policy "routine_days_owner_insert" on public.routine_days
  for insert with check (exists (
    select 1 from public.routines r where r.id = routine_days.routine_id and r.user_id = auth.uid()
  ));
create policy "routine_days_owner_update" on public.routine_days
  for update using (exists (
    select 1 from public.routines r where r.id = routine_days.routine_id and r.user_id = auth.uid()
  ));
-- No delete policy: routine_days are soft-deleted via UPDATE is_deleted = true (Global Constraints).

-- routine_exercises: via routine_days -> routines join
create policy "routine_exercises_owner_select" on public.routine_exercises
  for select using (exists (
    select 1 from public.routine_days d join public.routines r on r.id = d.routine_id
    where d.id = routine_exercises.routine_day_id and r.user_id = auth.uid()
  ));
create policy "routine_exercises_owner_insert" on public.routine_exercises
  for insert with check (exists (
    select 1 from public.routine_days d join public.routines r on r.id = d.routine_id
    where d.id = routine_exercises.routine_day_id and r.user_id = auth.uid()
  ));
create policy "routine_exercises_owner_update" on public.routine_exercises
  for update using (exists (
    select 1 from public.routine_days d join public.routines r on r.id = d.routine_id
    where d.id = routine_exercises.routine_day_id and r.user_id = auth.uid()
  ));
-- No delete policy: routine_exercises are soft-deleted via UPDATE is_deleted = true (Global Constraints).

-- user_exercise_state: owner only
create policy "user_exercise_state_owner_all" on public.user_exercise_state
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- workout_sessions: owner only
create policy "workout_sessions_owner_all" on public.workout_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- logged_sets: via workout_sessions join
create policy "logged_sets_owner_select" on public.logged_sets
  for select using (exists (
    select 1 from public.workout_sessions s where s.id = logged_sets.session_id and s.user_id = auth.uid()
  ));
create policy "logged_sets_owner_insert" on public.logged_sets
  for insert with check (exists (
    select 1 from public.workout_sessions s where s.id = logged_sets.session_id and s.user_id = auth.uid()
  ));
create policy "logged_sets_owner_update" on public.logged_sets
  for update using (exists (
    select 1 from public.workout_sessions s where s.id = logged_sets.session_id and s.user_id = auth.uid()
  ));
create policy "logged_sets_owner_delete" on public.logged_sets
  for delete using (exists (
    select 1 from public.workout_sessions s where s.id = logged_sets.session_id and s.user_id = auth.uid()
  ));

-- routine_history: owner only
create policy "routine_history_owner_all" on public.routine_history
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
