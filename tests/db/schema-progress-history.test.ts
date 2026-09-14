import { createAdminClient } from '../helpers/supabaseAdmin';
import { seedTestRoutine } from '../helpers/seedTestRoutine';

const supabase = createAdminClient();
const testEmail = `progress-test-${Date.now()}@example.com`;
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

describe('progress and history schema', () => {
  it('enforces one user_exercise_state row per user and exercise', async () => {
    const { exercise } = await seedTestRoutine(supabase, userId);

    const first = await supabase
      .from('user_exercise_state')
      .insert({ user_id: userId, exercise_id: exercise.id, current_weight: 40 });
    expect(first.error).toBeNull();

    const duplicate = await supabase
      .from('user_exercise_state')
      .insert({ user_id: userId, exercise_id: exercise.id, current_weight: 42.5 });
    expect(duplicate.error).not.toBeNull();
  });

  it('rejects a workout_session with an invalid status', async () => {
    const { day } = await seedTestRoutine(supabase, userId);
    const { error } = await supabase
      .from('workout_sessions')
      .insert({ user_id: userId, routine_day_id: day.id, status: 'not_a_real_status' });
    expect(error).not.toBeNull();
  });

  it('logs a valid set and rejects an invalid set_type', async () => {
    const { day, routineExercise } = await seedTestRoutine(supabase, userId);
    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .insert({ user_id: userId, routine_day_id: day.id, status: 'in_progress' })
      .select()
      .single();
    expect(sessionError).toBeNull();

    const validSet = await supabase.from('logged_sets').insert({
      session_id: session!.id,
      routine_exercise_id: routineExercise.id,
      set_index: 0,
      set_type: 'working',
      weight: 40,
      reps: 10,
      rir: 2,
    });
    expect(validSet.error).toBeNull();

    const invalidSet = await supabase.from('logged_sets').insert({
      session_id: session!.id,
      routine_exercise_id: routineExercise.id,
      set_index: 1,
      set_type: 'not_a_real_type',
      weight: 40,
      reps: 10,
      rir: 2,
    });
    expect(invalidSet.error).not.toBeNull();
  });

  it('rejects a routine_history row with an invalid event_type', async () => {
    const { routine } = await seedTestRoutine(supabase, userId);
    const { error } = await supabase.from('routine_history').insert({
      user_id: userId,
      routine_id: routine.id,
      event_type: 'not_a_real_event',
    });
    expect(error).not.toBeNull();
  });
});
