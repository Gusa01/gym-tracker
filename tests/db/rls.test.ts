import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '../helpers/supabaseAdmin';
import { seedTestRoutine } from '../helpers/seedTestRoutine';

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

  beforeAll(async () => {
    const suffix = Date.now();
    userA = await createSignedInClient(`rls-a-${suffix}@example.com`, 'testpassword123');
    userB = await createSignedInClient(`rls-b-${suffix}@example.com`, 'testpassword123');

    const { routine } = await seedTestRoutine(admin, userA.userId);
    routineAId = routine.id;
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
      .insert({ name: `RLS Catalog Test ${Date.now()}`, muscle_group: 'legs' })
      .select()
      .single();

    const { data, error } = await userB.client
      .from('exercises')
      .select()
      .eq('id', exercise!.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(exercise!.id);
  });
});
