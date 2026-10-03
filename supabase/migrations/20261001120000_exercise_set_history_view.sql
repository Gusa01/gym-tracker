-- One row per qualifying logged set, keyed by the catalog exercise so the same exercise
-- logged in different routines forms one series. Qualifying = completed session, not a
-- warmup. Soft-deleted routines/exercises are intentionally NOT filtered: history is immutable.
--
-- security_invoker makes the view run with the caller's permissions, so the RLS policies on
-- logged_sets / workout_sessions apply. Without it a view runs as its owner and would expose
-- every user's sets.
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
