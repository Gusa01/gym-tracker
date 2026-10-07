export type SessionStatus = 'in_progress' | 'completed';

export interface WorkoutSession {
  id: string;
  user_id: string;
  routine_day_id: string;
  session_date: string;
  week_number: number | null;
  status: SessionStatus;
}

export type SetType = 'top_set' | 'back_off' | 'working' | 'warmup';

export interface LoggedSet {
  id: string;
  session_id: string;
  routine_exercise_id: string;
  set_index: number;
  set_type: SetType;
  weight: number;
  reps: number;
  rir: number | null;
  created_at: string;
  is_deleted?: boolean;
}
