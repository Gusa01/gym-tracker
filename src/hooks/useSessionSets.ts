import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { getDatabase } from '../lib/sqlite/db';
import { getCachedDayExercises, getCachedExerciseState, CachedRoutineExercise } from '../lib/sqlite/cache';
import { listSessionSets } from '../lib/sessions/queries';
import { loadCurrentSession, saveCurrentSession } from '../lib/sessions/currentSessionStorage';
import { LoggedSet, SetType } from '../lib/sessions/types';
import { enqueueWrite } from '../lib/sqlite/pendingWrites';
import { flushOnly } from '../lib/sync/syncService';
import { useAuthSession } from './useAuthSession';

export function useSessionSets(sessionId: string | undefined) {
  const { session } = useAuthSession();
  const userId = session?.user.id;

  const [dayName, setDayName] = useState<string | null>(null);
  const [exercises, setExercises] = useState<CachedRoutineExercise[]>([]);
  const [loggedSets, setLoggedSets] = useState<LoggedSet[]>([]);
  const [weightByExercise, setWeightByExercise] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      // Offline (or any read failure) degrades to an unknown/empty checklist rather than
      // blocking the whole session screen; sync catches up once connectivity returns.
      const sets = await listSessionSets(supabase, sessionId).catch(() => []);
      setLoggedSets(sets);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadForDay = useCallback((dayId: string, resolvedDayName: string) => {
    const dayExercises = getCachedDayExercises(getDatabase(), dayId);
    setExercises(dayExercises);
    setDayName(resolvedDayName);
    const weights: Record<string, number | null> = {};
    dayExercises.forEach((exercise) => {
      const state = getCachedExerciseState(getDatabase(), exercise.exercise_id);
      weights[exercise.id] = state?.current_weight ?? null;
    });
    setWeightByExercise(weights);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function logSet(
    routineExerciseId: string,
    setIndex: number,
    setType: SetType,
    weight: number,
    reps: number,
    rir: number | null
  ) {
    if (!sessionId) return;
    const id = Crypto.randomUUID();
    const payload = {
      id,
      session_id: sessionId,
      routine_exercise_id: routineExerciseId,
      set_index: setIndex,
      set_type: setType,
      weight,
      reps,
      rir,
      created_at: new Date().toISOString(),
    };
    enqueueWrite(getDatabase(), id, 'logged_sets', payload);
    setLoggedSets((prev) => [...prev, payload as LoggedSet]);
    if (userId) flushOnly(getDatabase(), supabase).catch(() => {});
  }

  async function completeSession() {
    if (!sessionId) return;
    const id = Crypto.randomUUID();
    enqueueWrite(getDatabase(), id, 'workout_sessions', { id: sessionId, status: 'completed' });
    const pointer = await loadCurrentSession();
    if (pointer && pointer.sessionId === sessionId) {
      await saveCurrentSession({ ...pointer, status: 'completed' });
    }
    if (userId) await flushOnly(getDatabase(), supabase).catch(() => {});
  }

  return { dayName, exercises, loggedSets, weightByExercise, loading, loadForDay, logSet, completeSession };
}
