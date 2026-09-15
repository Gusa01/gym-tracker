import { SupabaseClient } from '@supabase/supabase-js';

export interface PendingWrite {
  id: string;
  entity: 'workout_sessions' | 'logged_sets';
  payload: Record<string, unknown>;
}

export interface FlushResult {
  succeededIds: string[];
  failedIds: string[];
}

export async function flushPendingWrites(supabase: SupabaseClient, writes: PendingWrite[]): Promise<FlushResult> {
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  for (const write of writes) {
    const { error } = await supabase.from(write.entity).upsert(write.payload);
    if (error) {
      failedIds.push(write.id);
    } else {
      succeededIds.push(write.id);
    }
  }
  return { succeededIds, failedIds };
}
