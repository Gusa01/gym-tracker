import { SQLiteDatabase } from 'expo-sqlite';
import { SupabaseClient } from '@supabase/supabase-js';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { listPendingWrites, removePendingWrite, incrementAttempts } from '../sqlite/pendingWrites';
import { refreshLocalCache } from '../sqlite/cache';
import { flushPendingWrites } from './flushQueue';

/** Flushes the pending write queue without re-downloading the routine cache. */
async function flushQueueOnce(db: SQLiteDatabase, supabase: SupabaseClient): Promise<void> {
  const writes = listPendingWrites(db);
  if (writes.length === 0) return;
  const { succeededIds, failedIds } = await flushPendingWrites(supabase, writes);
  succeededIds.forEach((id) => removePendingWrite(db, id));
  failedIds.forEach((id) => incrementAttempts(db, id));
}

let flushChain: Promise<void> = Promise.resolve();

/** Serialized so flushes never overlap and same-row writes keep their order. */
export function flushOnly(db: SQLiteDatabase, supabase: SupabaseClient): Promise<void> {
  const run = flushChain.catch(() => {}).then(() => flushQueueOnce(db, supabase));
  flushChain = run;
  return run;
}

export async function syncNow(db: SQLiteDatabase, supabase: SupabaseClient, userId: string): Promise<void> {
  await flushOnly(db, supabase);
  await refreshLocalCache(db, supabase, userId);
}

export function startSyncListener(db: SQLiteDatabase, supabase: SupabaseClient, userId: string): () => void {
  const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      syncNow(db, supabase, userId).catch(() => {});
    }
  });

  const appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      syncNow(db, supabase, userId).catch(() => {});
    }
  });

  return () => {
    unsubscribeNetInfo();
    appStateSubscription.remove();
  };
}
