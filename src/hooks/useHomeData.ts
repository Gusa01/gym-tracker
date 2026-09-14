import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { useAuthSession } from './useAuthSession';
import { getDatabase } from '../lib/sqlite/db';
import { resolveToday } from '../lib/sqlite/cache';
import { formatDateOnly } from '../lib/sessions/weekResolution';
import { getSessionForDate } from '../lib/sessions/queries';
import { saveCurrentSession, loadCurrentSession } from '../lib/sessions/currentSessionStorage';
import { enqueueWrite } from '../lib/sqlite/pendingWrites';
import { flushOnly, syncNow } from '../lib/sync/syncService';

type SessionStatus = 'none' | 'in_progress' | 'completed';

export function useHomeData() {
  const { session } = useAuthSession();
  const userId = session?.user.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [routineName, setRoutineName] = useState<string | null>(null);
  const [weekNumber, setWeekNumber] = useState<number | null>(null);
  const [todayDayId, setTodayDayId] = useState<string | null>(null);
  const [todayDayName, setTodayDayName] = useState<string | null>(null);
  const [todayIsRestDay, setTodayIsRestDay] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('none');

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      await syncNow(getDatabase(), supabase, userId).catch(() => {
        // offline is expected; fall through to whatever the cache already has
      });

      const resolved = resolveToday(getDatabase());
      if (!resolved) {
        setRoutineName(null);
        setWeekNumber(null);
        setTodayDayId(null);
        setTodayDayName(null);
        setTodayIsRestDay(false);
        setSessionStatus('none');
        return;
      }
      setRoutineName(resolved.routine.name);
      setWeekNumber(resolved.weekNumber);

      const day = resolved.day;
      if (!day) {
        setTodayDayId(null);
        setTodayDayName(null);
        setTodayIsRestDay(false);
        setSessionStatus('none');
        return;
      }

      setTodayDayId(day.id);
      setTodayDayName(day.name);
      setTodayIsRestDay(day.is_rest_day);

      if (!day.is_rest_day) {
        const today = new Date();
        const todayStr = formatDateOnly(today);
        // Local-first: a pointer for today is authoritative, so an offline completion is
        // still recognized here instead of offering to start a duplicate session.
        const pointer = await loadCurrentSession();
        const pointerMatchesToday = pointer && pointer.dayId === day.id && pointer.sessionDate === todayStr;
        if (pointerMatchesToday) {
          setSessionStatus(pointer!.status === 'completed' ? 'completed' : 'in_progress');
        } else {
          const existing = await getSessionForDate(supabase, userId, day.id, todayStr).catch(() => null);
          setSessionStatus(existing ? (existing.status === 'completed' ? 'completed' : 'in_progress') : 'none');
        }
      } else {
        setSessionStatus('none');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el inicio.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const startingRef = useRef(false);

  const startOrResumeSession = useCallback(async (): Promise<string | null> => {
    if (!userId || !todayDayId) return null;
    if (startingRef.current) return null;
    startingRef.current = true;
    try {
      const pointer = await loadCurrentSession();
      if (pointer && pointer.dayId === todayDayId && pointer.sessionDate === formatDateOnly(new Date())) {
        return pointer.sessionId;
      }

      const today = new Date();
      const sessionDate = formatDateOnly(today);
      const week = weekNumber ?? 1;

      const existing = await getSessionForDate(supabase, userId, todayDayId, sessionDate).catch(() => null);
      if (existing) {
        await saveCurrentSession({ sessionId: existing.id, dayId: todayDayId, sessionDate, weekNumber: week });
        return existing.id;
      }

      const sessionId = Crypto.randomUUID();
      const payload = {
        id: sessionId,
        user_id: userId,
        routine_day_id: todayDayId,
        session_date: sessionDate,
        week_number: week,
        status: 'in_progress' as const,
      };
      enqueueWrite(getDatabase(), sessionId, 'workout_sessions', payload);
      await saveCurrentSession({ sessionId, dayId: todayDayId, sessionDate, weekNumber: week });
      flushOnly(getDatabase(), supabase).catch(() => {});
      return sessionId;
    } finally {
      startingRef.current = false;
    }
  }, [userId, todayDayId, weekNumber]);

  return {
    loading,
    error,
    routineName,
    weekNumber,
    todayDayName,
    todayIsRestDay,
    sessionStatus,
    startOrResumeSession,
  };
}
