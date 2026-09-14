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
