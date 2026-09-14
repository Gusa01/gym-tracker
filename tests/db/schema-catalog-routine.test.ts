import { createAdminClient } from '../helpers/supabaseAdmin';
import { seedTestRoutine } from '../helpers/seedTestRoutine';

const supabase = createAdminClient();
const testEmail = `schema-test-${Date.now()}@example.com`;
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

describe('catalog and routine structure schema', () => {
  it('creates a full valid chain: exercise -> routine -> day -> routine_exercise', async () => {
    const { routineExercise } = await seedTestRoutine(supabase, userId);
    expect(routineExercise.scheme_type).toBe('normal');
  });

  it('rejects a routine_exercise where rep_min is greater than rep_max', async () => {
    const { day, exercise } = await seedTestRoutine(supabase, userId);
    const { error } = await supabase.from('routine_exercises').insert({
      routine_day_id: day.id,
      exercise_id: exercise.id,
      order_index: 1,
      role: 'accessory',
      scheme_type: 'normal',
      sets: 3,
      rep_min: 12,
      rep_max: 8,
      rir_min: 2,
      rir_max: 3,
    });
    expect(error).not.toBeNull();
  });

  it('rejects a top_set_backoff routine_exercise missing backoff fields', async () => {
    const { day, exercise } = await seedTestRoutine(supabase, userId);
    const { error } = await supabase.from('routine_exercises').insert({
      routine_day_id: day.id,
      exercise_id: exercise.id,
      order_index: 2,
      role: 'main',
      scheme_type: 'top_set_backoff',
      top_set_reps: 6,
    });
    expect(error).not.toBeNull();
  });
});
