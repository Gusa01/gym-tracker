import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { useAuthSession } from './useAuthSession';
import { getDatabase } from '../lib/sqlite/db';
import { resolveToday, getCachedRoutineDays, getCachedDayExercises } from '../lib/sqlite/cache';
import { formatDateOnly } from '../lib/sessions/weekResolution';
import { getSessionForDate, listRecentCompletedSessions } from '../lib/sessions/queries';
import { buildWeekCalendar, computeWeekProgress, WeekCalendarDay } from '../lib/home/weekCalendar';
import { computeConsecutiveActiveWeeks } from '../lib/home/streak';
import { saveCurrentSession, loadCurrentSession } from '../lib/sessions/currentSessionStorage';
import { enqueueWrite } from '../lib/sqlite/pendingWrites';
import { flushOnly, syncNow } from '../lib/sync/syncService';
import { computeSuggestions } from '../lib/progression/suggestions';
import { shouldSuggestRoutineSwitch } from '../lib/progression/routineSwitch';
import { recordDeload } from '../lib/progression/mutations';
import { activateRoutine } from '../lib/routines/mutations';
import { getRoutine } from '../lib/routines/queries';

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
  const [deloadExerciseName, setDeloadExerciseName] = useState<string | null>(null);
  const [deloadDismissed, setDeloadDismissed] = useState(false);
  const [routineSwitchAvailable, setRoutineSwitchAvailable] = useState(false);
  const [nextRoutineId, setNextRoutineId] = useState<string | null>(null);
  const [nextRoutineName, setNextRoutineName] = useState<string | null>(null);
  const [switchDismissed, setSwitchDismissed] = useState(false);
  const [weekCalendar, setWeekCalendar] = useState<WeekCalendarDay[]>([]);
  const [weekProgress, setWeekProgress] = useState<number | null>(null);
  const [recentActivity, setRecentActivity] = useState<{ sessionId: string; sessionDate: string; dayName: string }[]>([]);
  const [consistencyStreak, setConsistencyStreak] = useState(0);

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
        setDeloadExerciseName(null);
        setRoutineSwitchAvailable(false);
        setNextRoutineName(null);
        setWeekCalendar([]);
        setWeekProgress(null);
        setRecentActivity([]);
        setConsistencyStreak(0);
        return;
      }
      setRoutineName(resolved.routine.name);
      setWeekNumber(resolved.weekNumber);

      setDeloadDismissed(false);
      setSwitchDismissed(false);
      const days = getCachedRoutineDays(getDatabase(), resolved.routine.id);
      setWeekCalendar(buildWeekCalendar(resolved.routine.weekday_schedule, days, resolved.weekNumber, new Date()));
      setWeekProgress(computeWeekProgress(resolved.weekNumber, resolved.routine.suggested_duration_weeks));

      // 200 sessions is enough history for a multi-year streak; the previous default of 30
      // silently capped the counter at ~6 weeks for an actively-training user.
      const recentSessions = await listRecentCompletedSessions(supabase, userId, 200).catch(() => null);
      if (recentSessions !== null) {
        setRecentActivity(recentSessions.slice(0, 5));
        setConsistencyStreak(computeConsecutiveActiveWeeks(recentSessions.map((s) => s.sessionDate), new Date()));
      }
      // else: offline / request failure — preserve whatever recentActivity/consistencyStreak
      // already held from the last successful load, instead of flashing them to empty/0.

      const exercisesByDay = days.map((d) => getCachedDayExercises(getDatabase(), d.id));
      const seenExerciseIds = new Set<string>();
      const topSetExercises = exercisesByDay.flat().filter((exercise) => {
        if (exercise.scheme_type !== 'top_set_backoff' || seenExerciseIds.has(exercise.id)) return false;
        seenExerciseIds.add(exercise.id);
        return true;
      });
      // Only the deload half needs the network. The routine-switch half is derivable from the
      // already-cached routine, so recompute it here instead of losing the banner while offline.
      const suggestions = await computeSuggestions(
        supabase,
        topSetExercises,
        resolved.routine,
        resolved.routine.id,
        new Date()
      ).catch(() => ({
        deloadExerciseName: null,
        routineSwitchAvailable: shouldSuggestRoutineSwitch(resolved.routine, new Date()),
      }));
      setDeloadExerciseName(suggestions.deloadExerciseName);
      setRoutineSwitchAvailable(suggestions.routineSwitchAvailable);
      setNextRoutineId(resolved.routine.next_routine_id);
      if (suggestions.routineSwitchAvailable && resolved.routine.next_routine_id) {
        const nextRoutine = await getRoutine(supabase, resolved.routine.next_routine_id).catch(() => null);
        setNextRoutineName(nextRoutine?.name ?? null);
      } else {
        setNextRoutineName(null);
      }

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

  function dismissDeload() {
    setDeloadDismissed(true);
  }

  function dismissSwitch() {
    setSwitchDismissed(true);
  }

  async function acceptDeload() {
    const resolved = resolveToday(getDatabase());
    if (!userId || !resolved) return;
    await recordDeload(supabase, userId, resolved.routine.id);
    setDeloadDismissed(true);
  }

  async function acceptSwitch() {
    if (!userId || !nextRoutineId) return;
    await activateRoutine(supabase, userId, nextRoutineId);
    setSwitchDismissed(true);
    await load();
  }

  return {
    loading,
    error,
    routineName,
    weekNumber,
    todayDayName,
    todayIsRestDay,
    sessionStatus,
    startOrResumeSession,
    deloadExerciseName: deloadDismissed ? null : deloadExerciseName,
    routineSwitchAvailable: switchDismissed ? false : routineSwitchAvailable,
    nextRoutineName,
    dismissDeload,
    dismissSwitch,
    acceptDeload,
    acceptSwitch,
    weekCalendar,
    weekProgress,
    recentActivity,
    consistencyStreak,
  };
}
