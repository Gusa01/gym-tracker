import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import {
  listRoutines,
  getRoutine,
  listRoutineDays,
  getRoutineDay,
  listDayExercises,
  listExercises,
} from '../../../src/lib/routines/queries';

const supabase = createAdminClient();
const testEmail = `routine-queries-${Date.now()}@example.com`;
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

describe('routine queries', () => {
  it('lists routines for a user and fetches one by id', async () => {
    const { routine } = await seedTestRoutine(supabase, userId);

    const routines = await listRoutines(supabase, userId);
    expect(routines.some((r) => r.id === routine.id)).toBe(true);

    const fetched = await getRoutine(supabase, routine.id);
    expect(fetched?.id).toBe(routine.id);
  });

  it('excludes soft-deleted routines from listRoutines and getRoutine', async () => {
    const { routine } = await seedTestRoutine(supabase, userId);
    await supabase.from('routines').update({ is_deleted: true }).eq('id', routine.id);

    const routines = await listRoutines(supabase, userId);
    expect(routines.some((r) => r.id === routine.id)).toBe(false);
    expect(await getRoutine(supabase, routine.id)).toBeNull();
  });

  it('lists days for a routine and excludes soft-deleted ones', async () => {
    const { routine, day } = await seedTestRoutine(supabase, userId);
    const days = await listRoutineDays(supabase, routine.id);
    expect(days.map((d) => d.id)).toContain(day.id);

    await supabase.from('routine_days').update({ is_deleted: true }).eq('id', day.id);
    const daysAfterDelete = await listRoutineDays(supabase, routine.id);
    expect(daysAfterDelete.map((d) => d.id)).not.toContain(day.id);
    expect(await getRoutineDay(supabase, day.id)).toBeNull();
  });

  it('lists exercises for a day joined with their catalog name, and excludes soft-deleted ones', async () => {
    const { day, routineExercise, exercise } = await seedTestRoutine(supabase, userId);
    const exercises = await listDayExercises(supabase, day.id);
    const found = exercises.find((e) => e.id === routineExercise.id);
    expect(found?.exercise_name).toBe(exercise.name);

    await supabase.from('routine_exercises').update({ is_deleted: true }).eq('id', routineExercise.id);
    const afterDelete = await listDayExercises(supabase, day.id);
    expect(afterDelete.map((e) => e.id)).not.toContain(routineExercise.id);
  });

  it('lists the shared exercise catalog', async () => {
    const { exercise } = await seedTestRoutine(supabase, userId);
    const exercises = await listExercises(supabase);
    expect(exercises.some((e) => e.id === exercise.id)).toBe(true);
  });
});
