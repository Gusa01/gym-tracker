import * as fs from 'fs';
import * as path from 'path';
import { createAdminClient } from '../helpers/supabaseAdmin';
import { importRoutine } from '../../scripts/import-routine';

// This test performs dozens of sequential inserts against a real hosted
// Supabase project (one round trip per routine/day/exercise), which exceeds
// Jest's default 5s timeout even though nothing is actually hung.
jest.setTimeout(30000);

const supabase = createAdminClient();
const fixture = fs.readFileSync(
  path.join(__dirname, '..', '..', 'rutina_gym_top_set_back_off.md'),
  'utf-8'
);
const testEmail = `import-routine-${Date.now()}@example.com`;
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

// The two `it` blocks below depend on running in file order (Jest runs a
// describe block's tests sequentially) — the second exercises idempotency
// against the first's already-imported data, deliberately.
describe('importRoutine', () => {
  it('creates both routines with their days, exercises, and weekday schedule', async () => {
    const result = await importRoutine(supabase, userId, fixture);
    expect(result.imported).toBe(true);
    expect(Object.keys(result.routineIds!)).toEqual(['Full Body', 'Split 5 días']);

    const { data: fullBody } = await supabase
      .from('routines')
      .select('*')
      .eq('id', result.routineIds!['Full Body'])
      .single();
    expect(fullBody.suggested_duration_weeks).toBe(4);
    expect(fullBody.next_routine_id).toBe(result.routineIds!['Split 5 días']);
    expect(fullBody.weekday_schedule.fri).toEqual({
      even_week: expect.any(String),
      odd_week: expect.any(String),
    });

    const { data: fullBodyDays } = await supabase
      .from('routine_days')
      .select('*')
      .eq('routine_id', result.routineIds!['Full Body'])
      .order('order_index');
    expect(fullBodyDays!.map((d) => d.name)).toEqual(['Día A', 'Día B', 'Core']);

    const { data: split } = await supabase
      .from('routines')
      .select('*')
      .eq('id', result.routineIds!['Split 5 días'])
      .single();
    expect(split.next_routine_id).toBeNull();
    expect(split.uses_top_set_backoff).toBe(true);

    const { data: splitDays } = await supabase
      .from('routine_days')
      .select('*')
      .eq('routine_id', result.routineIds!['Split 5 días'])
      .order('order_index');
    const descanso = splitDays!.find((d) => d.name === 'Descanso');
    expect(descanso!.is_rest_day).toBe(true);

    const upperDay = splitDays!.find((d) => d.name === 'Upper')!;
    const { data: upperExercises } = await supabase
      .from('routine_exercises')
      .select('*, exercises(name)')
      .eq('routine_day_id', upperDay.id)
      .order('order_index');
    const pressBanca = upperExercises!.find((e: any) => e.exercises.name === 'Press banca');
    expect(pressBanca.scheme_type).toBe('top_set_backoff');
    expect(pressBanca.top_set_reps).toBe(5);
  });

  it('is idempotent: refuses to re-import for the same user', async () => {
    const result = await importRoutine(supabase, userId, fixture);
    expect(result.imported).toBe(false);
    expect(result.reason).toContain('already exists');
  });
});
