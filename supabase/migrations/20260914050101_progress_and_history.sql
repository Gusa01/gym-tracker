create table public.user_exercise_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  current_weight numeric,
  suggested_next_weight numeric,
  consecutive_hit_count integer not null default 0,
  consecutive_miss_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, exercise_id)
);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_day_id uuid not null references public.routine_days(id),
  session_date date not null default current_date,
  week_number integer,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed'))
);

create table public.logged_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  routine_exercise_id uuid not null references public.routine_exercises(id),
  set_index integer not null,
  set_type text not null check (set_type in ('top_set', 'back_off', 'working', 'warmup')),
  weight numeric not null,
  reps numeric not null,
  rir numeric,
  created_at timestamptz not null default now()
);

create table public.routine_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id),
  event_type text not null check (event_type in ('started', 'deload')),
  occurred_at timestamptz not null default now(),
  note text
);
