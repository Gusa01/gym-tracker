import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '../helpers/supabaseAdmin';
import { seedTestRoutine, seedTestRoutineAsUser } from '../helpers/seedTestRoutine';

const admin = createAdminClient();
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

async function createSignedInClient(email: string, password: string) {
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, userId: data.user!.id };
}

describe('row level security', () => {
  let userA: Awaited<ReturnType<typeof createSignedInClient>>;
  let userB: Awaited<ReturnType<typeof createSignedInClient>>;
  let routineAId: string;
  let userSeedA: Awaited<ReturnType<typeof seedTestRoutineAsUser>>;
  let sessionAId: string;
  let loggedSetAId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    userA = await createSignedInClient(`rls-a-${suffix}@example.com`, 'testpassword123');
    userB = await createSignedInClient(`rls-b-${suffix}@example.com`, 'testpassword123');

    const { routine } = await seedTestRoutine(admin, userA.userId);
    routineAId = routine.id;

    // Seed a second routine tree via user A's own authenticated client, so
    // the *_owner_insert policies are exercised by a real authenticated
    // request rather than bypassed by the service-role admin client.
    userSeedA = await seedTestRoutineAsUser(userA.client, userA.userId);

    const { data: session, error: sessionError } = await admin
      .from('workout_sessions')
      .insert({ user_id: userA.userId, routine_day_id: userSeedA.day.id, status: 'in_progress' })
      .select()
      .single();
    if (sessionError) throw sessionError;
    sessionAId = session!.id;

    const { data: loggedSet, error: loggedSetError } = await admin
      .from('logged_sets')
      .insert({
        session_id: sessionAId,
        routine_exercise_id: userSeedA.routineExercise.id,
        set_index: 0,
        set_type: 'working',
        weight: 40,
        reps: 10,
        rir: 2,
      })
      .select()
      .single();
    if (loggedSetError) throw loggedSetError;
    loggedSetAId = loggedSet!.id;
  });

  afterAll(async () => {
    await admin.auth.admin.deleteUser(userA.userId);
    await admin.auth.admin.deleteUser(userB.userId);
  });

  it("lets user A read their own routine", async () => {
    const { data, error } = await userA.client
      .from('routines')
      .select()
      .eq('id', routineAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(routineAId);
  });

  it("hides user A's routine from user B", async () => {
    const { data, error } = await userB.client
      .from('routines')
      .select()
      .eq('id', routineAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("blocks user B from updating user A's routine", async () => {
    const { data, error } = await userB.client
      .from('routines')
      .update({ name: 'Hijacked' })
      .eq('id', routineAId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('lets any authenticated user read the shared exercise catalog', async () => {
    const { data: exercise } = await admin
      .from('exercises')
      .upsert({ name: '[test-fixture] RLS Catalog Test Exercise', muscle_group: 'legs' }, { onConflict: 'name' })
      .select()
      .single();

    const { data, error } = await userB.client
      .from('exercises')
      .select()
      .eq('id', exercise!.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(exercise!.id);

    await admin.from('exercises').delete().eq('id', exercise!.id);
  });

  it("blocks user B from deleting user A's routine (RLS filters, admin confirms it survives)", async () => {
    const { data, error } = await userB.client
      .from('routines')
      .delete()
      .eq('id', routineAId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: stillThere, error: adminError } = await admin
      .from('routines')
      .select()
      .eq('id', routineAId)
      .maybeSingle();
    expect(adminError).toBeNull();
    expect(stillThere?.id).toBe(routineAId);
  });

  it('lets user A insert routine_days and routine_exercises via their own authenticated client', () => {
    // Exercised in beforeAll via seedTestRoutineAsUser; if any *_owner_insert
    // policy had rejected the request, beforeAll itself would have thrown.
    expect(userSeedA.day.id).toBeTruthy();
    expect(userSeedA.routineExercise.id).toBeTruthy();
  });

  it("hides user A's routine_day from user B (select) and blocks update", async () => {
    const { data: selectData, error: selectError } = await userB.client
      .from('routine_days')
      .select()
      .eq('id', userSeedA.day.id)
      .maybeSingle();
    expect(selectError).toBeNull();
    expect(selectData).toBeNull();

    const { data: updateData, error: updateError } = await userB.client
      .from('routine_days')
      .update({ name: 'Hijacked Day' })
      .eq('id', userSeedA.day.id)
      .select();
    expect(updateError).toBeNull();
    expect(updateData).toEqual([]);
  });

  it("hides user A's routine_exercise from user B (select) and blocks update", async () => {
    const { data: selectData, error: selectError } = await userB.client
      .from('routine_exercises')
      .select()
      .eq('id', userSeedA.routineExercise.id)
      .maybeSingle();
    expect(selectError).toBeNull();
    expect(selectData).toBeNull();

    const { data: updateData, error: updateError } = await userB.client
      .from('routine_exercises')
      .update({ order_index: 99 })
      .eq('id', userSeedA.routineExercise.id)
      .select();
    expect(updateError).toBeNull();
    expect(updateData).toEqual([]);
  });

  it("hides user A's logged_sets from user B (select) and blocks update", async () => {
    const { data: selectData, error: selectError } = await userB.client
      .from('logged_sets')
      .select()
      .eq('id', loggedSetAId)
      .maybeSingle();
    expect(selectError).toBeNull();
    expect(selectData).toBeNull();

    const { data: updateData, error: updateError } = await userB.client
      .from('logged_sets')
      .update({ weight: 999 })
      .eq('id', loggedSetAId)
      .select();
    expect(updateError).toBeNull();
    expect(updateData).toEqual([]);
  });

  it("rejects user B inserting a user_exercise_state row forged with user A's user_id", async () => {
    const { data, error } = await userB.client
      .from('user_exercise_state')
      .insert({
        user_id: userA.userId,
        exercise_id: userSeedA.exercise.id,
        current_weight: 50,
      })
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});
