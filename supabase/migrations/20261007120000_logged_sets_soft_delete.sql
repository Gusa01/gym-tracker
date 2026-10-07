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
