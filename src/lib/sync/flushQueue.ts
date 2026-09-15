import { SupabaseClient } from '@supabase/supabase-js';

export interface PendingWrite {
  id: string;
  entity: 'workout_sessions' | 'logged_sets' | 'user_exercise_state';
  payload: Record<string, unknown>;
}

export interface FlushResult {
  succeededIds: string[];
  failedIds: string[];
}

const CONFLICT_TARGETS: Partial<Record<PendingWrite['entity'], string>> = {
  user_exercise_state: 'user_id,exercise_id',
};

export async function flushPendingWrites(supabase: SupabaseClient, writes: PendingWrite[]): Promise<FlushResult> {
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  for (const write of writes) {
    const onConflict = CONFLICT_TARGETS[write.entity];
    const { error } = await supabase.from(write.entity).upsert(write.payload, onConflict ? { onConflict } : undefined);
    if (error) {
      failedIds.push(write.id);
    } else {
      succeededIds.push(write.id);
    }
  }
  return { succeededIds, failedIds };
}
