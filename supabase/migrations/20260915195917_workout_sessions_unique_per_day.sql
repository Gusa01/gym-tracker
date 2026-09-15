-- Prevents the offline-finish duplicate-session bug identified in the session-logging
-- plan's final review: without this, two workout_sessions rows for the same
-- (user, day, date) make getSessionForDate's .maybeSingle() error, which the client
-- silently swallows, permanently hiding that day's session status.
alter table public.workout_sessions
  add constraint workout_sessions_user_day_date_unique unique (user_id, routine_day_id, session_date);
