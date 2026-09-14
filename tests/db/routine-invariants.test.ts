import { createAdminClient } from '../helpers/supabaseAdmin';
import { seedTestRoutine } from '../helpers/seedTestRoutine';

const supabase = createAdminClient();
const testEmail = `routine-invariants-${Date.now()}@example.com`;
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

afterEach(async () => {
  // Clean up by deactivating all routines created in the test
  await supabase.from('routines').update({ is_active: false }).eq('user_id', userId);
});

describe('routine invariants', () => {
  it('rejects a second active routine for the same user', async () => {
    const { routine: routineA } = await seedTestRoutine(supabase, userId);
    await supabase.from('routines').update({ is_active: true }).eq('id', routineA.id);

    const { data: routineB, error: createError } = await supabase
      .from('routines')
      .insert({ user_id: userId, name: `Second Routine ${Date.now()}`, uses_top_set_backoff: false })
      .select()
      .single();
    expect(createError).toBeNull();

    const { error: activateError } = await supabase
      .from('routines')
      .update({ is_active: true })
      .eq('id', routineB!.id);
    expect(activateError).not.toBeNull();
  });

  it('allows a second active routine once the first is deactivated', async () => {
    const { routine: routineA } = await seedTestRoutine(supabase, userId);
    await supabase.from('routines').update({ is_active: true }).eq('id', routineA.id);

    const { data: routineB } = await supabase
      .from('routines')
      .insert({ user_id: userId, name: `Third Routine ${Date.now()}`, uses_top_set_backoff: false })
      .select()
      .single();

    await supabase.from('routines').update({ is_active: false }).eq('id', routineA.id);
    const { error: activateError } = await supabase
      .from('routines')
      .update({ is_active: true })
      .eq('id', routineB!.id);
    expect(activateError).toBeNull();
  });
});
