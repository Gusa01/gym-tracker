export const CREATE_TABLES_SQL = `
  create table if not exists routines_cache (
    id text primary key,
    name text not null,
    uses_top_set_backoff integer not null,
    suggested_duration_weeks integer,
    next_routine_id text,
    weekday_schedule text not null,
    is_active integer not null,
    started_at text
  );

  create table if not exists routine_days_cache (
    id text primary key,
    routine_id text not null,
    name text not null,
    order_index integer not null,
    is_rest_day integer not null
  );

  create table if not exists routine_exercises_cache (
    id text primary key,
    routine_day_id text not null,
    exercise_id text not null,
    exercise_name text not null,
    order_index integer not null,
    role text not null,
    scheme_type text not null,
    rep_unit text not null,
    sets integer,
    rep_min integer,
    rep_max integer,
    rir_min integer,
    rir_max integer,
    top_set_reps integer,
    backoff_sets integer,
    backoff_rep_min integer,
    backoff_rep_max integer
  );

  create table if not exists user_exercise_state_cache (
    exercise_id text primary key,
    current_weight real,
    suggested_next_weight real
  );

  create table if not exists pending_writes (
    id text primary key,
    entity text not null,
    payload_json text not null,
    created_at text not null,
    attempts integer not null default 0
  );
`;
