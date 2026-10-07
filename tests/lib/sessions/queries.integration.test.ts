import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedActiveRoutine } from '../../helpers/seedActiveRoutine';
import {
  getActiveRoutine,
  getSessionForDate,
  listSessionSets,
  listRecentCompletedSessions,
} from '../../../src/lib/sessions/queries';

const supabase = createAdminClient();
const testEmail = `session-queries-${Date.now()}@example.com`;
let userId: string;

beforeAll(async () => {
  const { data, error } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: 'testpassword123',
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
});

afterAll(async () => {
  await supabase.auth.admin.deleteUser(userId);
});

describe('getActiveRoutine', () => {
  it('returns the user\'s active routine', async () => {
    const { routine } = await seedActiveRoutine(supabase, userId);
    const active = await getActiveRoutine(supabase, userId);
    expect(active?.id).toBe(routine.id);
    expect(active?.is_active).toBe(true);
  });

  it('returns null when the user has no active routine', async () => {
    const { data, error } = await supabase.auth.admin.createUser({
      email: `no-active-routine-${Date.now()}@example.com`,
      password: 'testpassword123',
      email_confirm: true,
    });
    if (error) throw error;
    try {
      const active = await getActiveRoutine(supabase, data.user.id);
      expect(active).toBeNull();
    } finally {
      await supabase.auth.admin.deleteUser(data.user.id);
    }
  });
});

describe('getSessionForDate / listSessionSets', () => {
  it('returns null when no session exists for that day/date yet', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);
    const session = await getSessionForDate(supabase, userId, day.id, '2026-01-01');
    expect(session).toBeNull();
  });

  it('finds an existing session for the day/date and lists its sets', async () => {
    const { day, routineExercise } = await seedActiveRoutine(supabase, userId);

    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: userId,
        routine_day_id: day.id,
        session_date: '2026-02-02',
        week_number: 1,
        status: 'in_progress',
      })
      .select()
      .single();
    if (sessionError) throw sessionError;

    const { error: setError } = await supabase.from('logged_sets').insert({
      session_id: session.id,
      routine_exercise_id: routineExercise.id,
      set_index: 1,
      set_type: 'working',
      weight: 60,
      reps: 8,
      rir: 2,
    });
    if (setError) throw setError;

    const found = await getSessionForDate(supabase, userId, day.id, '2026-02-02');
    expect(found?.id).toBe(session.id);

    const sets = await listSessionSets(supabase, session.id);
    expect(sets).toHaveLength(1);
    expect(sets[0].weight).toBe(60);
    expect(sets[0].reps).toBe(8);
  });
});

describe('listRecentCompletedSessions', () => {
  it('returns only completed sessions, newest first, with the day name joined in', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);

    async function insertSession(sessionDate: string, status: 'in_progress' | 'completed') {
      const { error } = await supabase.from('workout_sessions').insert({
        user_id: userId,
        routine_day_id: day.id,
        session_date: sessionDate,
        week_number: 1,
        status,
      });
      if (error) throw error;
    }

    await insertSession('2026-03-01', 'completed');
    await insertSession('2026-03-08', 'completed');
    await insertSession('2026-03-15', 'in_progress'); // not completed, must be excluded

    const result = await listRecentCompletedSessions(supabase, userId);

    expect(result.map((r) => r.sessionDate)).toEqual(['2026-03-08', '2026-03-01']);
    expect(result.every((r) => r.dayName === day.name)).toBe(true);
    expect(result.every((r) => typeof r.sessionId === 'string' && r.sessionId.length > 0)).toBe(true);
  });

  it('respects the limit parameter', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);
    for (const sessionDate of ['2026-04-01', '2026-04-08', '2026-04-15']) {
      const { error } = await supabase.from('workout_sessions').insert({
        user_id: userId,
        routine_day_id: day.id,
        session_date: sessionDate,
        week_number: 1,
        status: 'completed',
      });
      if (error) throw error;
    }

    const result = await listRecentCompletedSessions(supabase, userId, 2);
    expect(result).toHaveLength(2);
    expect(result[0].sessionDate).toBe('2026-04-15');
  });
});
