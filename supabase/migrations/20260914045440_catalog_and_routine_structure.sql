create extension if not exists pgcrypto;

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  muscle_group text not null
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  uses_top_set_backoff boolean not null default false,
  suggested_duration_weeks integer,
  next_routine_id uuid references public.routines(id) on delete set null,
  weekday_schedule jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  started_at timestamptz,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.routine_days (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  name text not null,
  order_index integer not null,
  is_rest_day boolean not null default false,
  is_deleted boolean not null default false
);

create table public.routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_day_id uuid not null references public.routine_days(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  order_index integer not null,
  role text not null check (role in ('main', 'accessory', 'core')),
  scheme_type text not null check (scheme_type in ('normal', 'top_set_backoff')),
  rep_unit text not null default 'reps' check (rep_unit in ('reps', 'seconds')),
  sets integer,
  rep_min integer,
  rep_max integer,
  rir_min integer,
  rir_max integer,
  top_set_reps integer,
  backoff_sets integer,
  backoff_rep_min integer,
  backoff_rep_max integer,
  is_deleted boolean not null default false,
  check (rep_min is null or rep_max is null or rep_min <= rep_max),
  check (rir_min is null or rir_max is null or rir_min <= rir_max),
  check (
    (scheme_type = 'normal' and sets is not null and rep_min is not null and rep_max is not null)
    or
    (scheme_type = 'top_set_backoff' and top_set_reps is not null and backoff_sets is not null
      and backoff_rep_min is not null and backoff_rep_max is not null)
  )
);
