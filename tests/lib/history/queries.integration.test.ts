import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import { listCompletedSessions, getSessionDetail, HISTORY_PAGE_SIZE } from '../../../src/lib/history/queries';

const admin = createAdminClient();
const createdUserIds: string[] = [];

async function createUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'testpassword123', email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return data.user.id;
}

function dateOffset(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe('listCompletedSessions', () => {
  let userId: string;
  let countedSessionId: string;

  beforeAll(async () => {
    userId = await createUser('history-list');
    const first = await seedTestRoutine(admin, userId);
    const second = await seedTestRoutine(admin, userId);

    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, i) => ({
      user_id: userId,
      routine_day_id: first.day.id,
      session_date: dateOffset('2026-01-01', i),
      status: 'completed',
    }));
    rows.push({ user_id: userId, routine_day_id: first.day.id, session_date: '2027-01-01', status: 'in_progress' });
    const { data: sessions, error } = await admin.from('workout_sessions').insert(rows).select('id, session_date');
    if (error) throw error;

    // The newest completed session gets 3 sets on 2 exercises, plus 1 deleted set on a third count.
    countedSessionId = sessions!.find((s) => s.session_date === dateOffset('2026-01-01', HISTORY_PAGE_SIZE))!.id;
    const { error: setsError } = await admin.from('logged_sets').insert([
      { session_id: countedSessionId, routine_exercise_id: first.routineExercise.id, set_index: 1, set_type: 'working', weight: 50, reps: 10 },
      { session_id: countedSessionId, routine_exercise_id: first.routineExercise.id, set_index: 2, set_type: 'working', weight: 50, reps: 10 },
      { session_id: countedSessionId, routine_exercise_id: second.routineExercise.id, set_index: 1, set_type: 'working', weight: 20, reps: 12 },
      { session_id: countedSessionId, routine_exercise_id: second.routineExercise.id, set_index: 2, set_type: 'working', weight: 20, reps: 12, is_deleted: true },
    ]);
    if (setsError) throw setsError;
  });

  it('pages completed sessions newest first and reports whether more remain', async () => {
    const page0 = await listCompletedSessions(admin, userId, 0);
    expect(page0.sessions).toHaveLength(HISTORY_PAGE_SIZE);
    expect(page0.hasMore).toBe(true);
    expect(page0.sessions[0].sessionDate).toBe(dateOffset('2026-01-01', HISTORY_PAGE_SIZE));

    const page1 = await listCompletedSessions(admin, userId, 1);
    expect(page1.sessions.map((s) => s.sessionDate)).toEqual(['2026-01-01']);
    expect(page1.hasMore).toBe(false);
  });

  it('never includes unfinished sessions', async () => {
    const page0 = await listCompletedSessions(admin, userId, 0);
    expect(page0.sessions.some((s) => s.sessionDate === '2027-01-01')).toBe(false);
  });

  it('counts exercises and sets without deleted sets, with the day name', async () => {
    const page0 = await listCompletedSessions(admin, userId, 0);
    expect(page0.sessions[0]).toEqual({
      id: countedSessionId,
      sessionDate: dateOffset('2026-01-01', HISTORY_PAGE_SIZE),
      dayName: 'Día Test',
      exerciseCount: 2,
      setCount: 3,
    });
  });
});

describe('getSessionDetail', () => {
  it('returns the session, its live sets and their exercises, including a removed exercise', async () => {
    const userId = await createUser('history-detail');
    const seeded = await seedTestRoutine(admin, userId);
    const { data: session, error } = await admin
      .from('workout_sessions')
      .insert({ user_id: userId, routine_day_id: seeded.day.id, session_date: '2026-02-03', status: 'completed' })
      .select('id')
      .single();
    if (error) throw error;
    const { error: setsError } = await admin.from('logged_sets').insert([
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 2, set_type: 'working', weight: 40, reps: 9 },
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 1, set_type: 'working', weight: 40, reps: 10 },
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 3, set_type: 'working', weight: 40, reps: 7, is_deleted: true },
    ]);
    if (setsError) throw setsError;
    const { error: removeError } = await admin
      .from('routine_exercises')
      .update({ is_deleted: true })
      .eq('id', seeded.routineExercise.id);
    if (removeError) throw removeError;

    const detail = await getSessionDetail(admin, session.id);

    expect(detail).toMatchObject({ id: session.id, sessionDate: '2026-02-03', dayName: 'Día Test' });
    expect(detail.sets.map((s) => s.set_index)).toEqual([1, 2]);
    expect(detail.exercises).toEqual([
      {
        id: seeded.routineExercise.id,
        exercise_name: '[test-fixture] Shared Exercise',
        order_index: 0,
        scheme_type: 'normal',
        rep_unit: 'reps',
        rir_min: 2,
      },
    ]);
  });
});
