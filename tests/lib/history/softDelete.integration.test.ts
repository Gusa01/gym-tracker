import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import { listSessionSets } from '../../../src/lib/sessions/queries';
import { listRecentTopSets } from '../../../src/lib/progression/queries';
import { listExerciseSetHistory } from '../../../src/lib/progress/queries';

const admin = createAdminClient();
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = 'testpassword123';
const createdUserIds: string[] = [];

async function createUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email };
}

async function seedCompletedSessionWithSets(userId: string) {
  const seeded = await seedTestRoutine(admin, userId);
  const { data: session, error: sessionError } = await admin
    .from('workout_sessions')
    .insert({ user_id: userId, routine_day_id: seeded.day.id, session_date: '2026-02-02', status: 'completed' })
    .select('id')
    .single();
  if (sessionError) throw sessionError;
  const { data: sets, error: setsError } = await admin
    .from('logged_sets')
    .insert([
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 1, set_type: 'top_set', weight: 80, reps: 5 },
      { session_id: session.id, routine_exercise_id: seeded.routineExercise.id, set_index: 2, set_type: 'top_set', weight: 70, reps: 8 },
    ])
    .select('*')
    .order('set_index');
  if (setsError) throw setsError;
  return { sessionId: session.id as string, routineExerciseId: seeded.routineExercise.id as string, sets: sets! };
}

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe('logged_sets soft delete', () => {
  let userId: string;
  let seeded: Awaited<ReturnType<typeof seedCompletedSessionWithSets>>;

  beforeAll(async () => {
    ({ userId } = await createUser('soft-delete'));
    seeded = await seedCompletedSessionWithSets(userId);
    const deleted = seeded.sets.find((s) => s.set_index === 2)!;
    const { error } = await admin.from('logged_sets').upsert({ ...deleted, is_deleted: true });
    if (error) throw error;
  });

  it('defaults new sets to not deleted', () => {
    expect(seeded.sets.every((s) => s.is_deleted === false)).toBe(true);
  });

  it('hides a deleted set from listSessionSets', async () => {
    const sets = await listSessionSets(admin, seeded.sessionId);
    expect(sets.map((s) => s.set_index)).toEqual([1]);
  });

  it('hides a deleted set from the deload top-set lookup', async () => {
    const sets = await listRecentTopSets(admin, seeded.routineExerciseId, 5);
    expect(sets.map((s) => s.set_index)).toEqual([1]);
  });

  it('hides a deleted set from exercise_set_history', async () => {
    const rows = await listExerciseSetHistory(admin, userId);
    expect(rows.map((r) => r.set_index)).toEqual([1]);
  });

  it('edits a set in place when upserting the full row with the same id', async () => {
    const original = seeded.sets.find((s) => s.set_index === 1)!;
    const { error } = await admin.from('logged_sets').upsert({ ...original, weight: 82.5, reps: 4 });
    expect(error).toBeNull();
    const { data } = await admin.from('logged_sets').select('*').eq('session_id', seeded.sessionId);
    expect(data).toHaveLength(2);
    expect(data!.find((s) => s.id === original.id)).toMatchObject({ weight: 82.5, reps: 4, is_deleted: false });
  });
});

describe('recreated exercise_set_history keeps row level security', () => {
  it("never shows another user's sets", async () => {
    const owner = await createUser('soft-delete-owner');
    const other = await createUser('soft-delete-other');
    await seedCompletedSessionWithSets(owner.userId);

    const otherClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await otherClient.auth.signInWithPassword({ email: other.email, password: PASSWORD });
    if (signInError) throw signInError;

    const { data, error } = await otherClient.from('exercise_set_history').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
