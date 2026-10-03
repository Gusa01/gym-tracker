import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
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

async function signIn(email: string) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function insertSession(userId: string, dayId: string, date: string, status: 'completed' | 'in_progress') {
  const { data, error } = await admin
    .from('workout_sessions')
    .insert({ user_id: userId, routine_day_id: dayId, session_date: date, status })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function insertSets(
  sessionId: string,
  routineExerciseId: string,
  sets: Array<{ set_type: string; weight: number; reps: number }>
) {
  const { data, error } = await admin
    .from('logged_sets')
    .insert(sets.map((s, i) => ({ session_id: sessionId, routine_exercise_id: routineExerciseId, set_index: i, ...s })))
    .select('id');
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe('exercise_set_history view', () => {
  let userId: string;
  let exerciseId: string;
  let expectedIds: string[];

  beforeAll(async () => {
    ({ userId } = await createUser('history'));
    const first = await seedTestRoutine(admin, userId);
    const second = await seedTestRoutine(admin, userId);
    exerciseId = first.exercise.id;

    const completed = await insertSession(userId, first.day.id, '2026-01-05', 'completed');
    const [, workingId] = await insertSets(completed, first.routineExercise.id, [
      { set_type: 'warmup', weight: 40, reps: 10 },
      { set_type: 'working', weight: 80, reps: 6 },
    ]);

    const unfinished = await insertSession(userId, first.day.id, '2026-01-06', 'in_progress');
    await insertSets(unfinished, first.routineExercise.id, [{ set_type: 'working', weight: 85, reps: 5 }]);

    const otherRoutine = await insertSession(userId, second.day.id, '2026-01-07', 'completed');
    const [otherId] = await insertSets(otherRoutine, second.routineExercise.id, [
      { set_type: 'working', weight: 82.5, reps: 6 },
    ]);

    expectedIds = [workingId, otherId];
  });

  it('excludes warmup sets and sets from unfinished sessions', async () => {
    const rows = await listExerciseSetHistory(admin, userId);
    expect(rows.map((r) => r.logged_set_id).sort()).toEqual([...expectedIds].sort());
  });

  it('merges one catalog exercise logged in two routines into one series', async () => {
    const rows = await listExerciseSetHistory(admin, userId);
    expect(new Set(rows.map((r) => r.exercise_id))).toEqual(new Set([exerciseId]));
    expect(new Set(rows.map((r) => r.session_id)).size).toBe(2);
    expect(rows[0].exercise_name).toBe('[test-fixture] Shared Exercise');
  });

  it('returns numeric weight and reps, ordered by session date', async () => {
    const rows = await listExerciseSetHistory(admin, userId);
    expect(rows.map((r) => r.session_date)).toEqual(['2026-01-05', '2026-01-07']);
    expect(rows.map((r) => r.weight)).toEqual([80, 82.5]);
    expect(typeof rows[0].reps).toBe('number');
  });

  it('filters by exercise when one is given', async () => {
    expect(await listExerciseSetHistory(admin, userId, exerciseId)).toHaveLength(2);
    expect(await listExerciseSetHistory(admin, userId, '00000000-0000-0000-0000-000000000000')).toHaveLength(0);
  });
});

describe('exercise_set_history row level security', () => {
  it("never shows another user's sets", async () => {
    const owner = await createUser('history-owner');
    const other = await createUser('history-other');
    const seeded = await seedTestRoutine(admin, owner.userId);
    const session = await insertSession(owner.userId, seeded.day.id, '2026-01-05', 'completed');
    await insertSets(session, seeded.routineExercise.id, [{ set_type: 'working', weight: 60, reps: 8 }]);

    const ownerClient = await signIn(owner.email);
    const otherClient = await signIn(other.email);

    const { data: ownRows, error: ownError } = await ownerClient.from('exercise_set_history').select('*');
    expect(ownError).toBeNull();
    expect(ownRows).toHaveLength(1);

    const { data: unfiltered, error: unfilteredError } = await otherClient.from('exercise_set_history').select('*');
    expect(unfilteredError).toBeNull();
    expect(unfiltered).toHaveLength(0);

    const { data: targeted } = await otherClient
      .from('exercise_set_history')
      .select('*')
      .eq('user_id', owner.userId);
    expect(targeted).toHaveLength(0);
  });
});

describe('listExerciseSetHistory pagination', () => {
  it('returns every row past the 1000-row response cap', async () => {
    const { userId } = await createUser('history-paging');
    const seeded = await seedTestRoutine(admin, userId);
    const session = await insertSession(userId, seeded.day.id, '2026-01-05', 'completed');
    await insertSets(
      session,
      seeded.routineExercise.id,
      Array.from({ length: 1001 }, () => ({ set_type: 'working', weight: 50, reps: 10 }))
    );

    const rows = await listExerciseSetHistory(admin, userId);
    expect(rows).toHaveLength(1001);
    expect(new Set(rows.map((r) => r.logged_set_id)).size).toBe(1001);
  });
});
