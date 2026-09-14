import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import {
  createRoutine,
  softDeleteRoutine,
  activateRoutine,
  createDay,
  softDeleteDay,
  moveDay,
  createRoutineExercise,
  softDeleteRoutineExercise,
  moveRoutineExercise,
  findOrCreateExercise,
} from '../../../src/lib/routines/mutations';

const supabase = createAdminClient();
const testEmail = `routine-mutations-${Date.now()}@example.com`;
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

describe('routine mutations', () => {
  it('soft-deletes a routine, cascading to its days and exercises', async () => {
    const { routine, day, routineExercise } = await seedTestRoutine(supabase, userId);
    await softDeleteRoutine(supabase, routine.id);

    const { data: routineRow } = await supabase
      .from('routines')
      .select('is_deleted, is_active')
      .eq('id', routine.id)
      .single();
    expect(routineRow!.is_deleted).toBe(true);
    expect(routineRow!.is_active).toBe(false);

    const { data: dayRow } = await supabase
      .from('routine_days')
      .select('is_deleted')
      .eq('id', day.id)
      .single();
    expect(dayRow!.is_deleted).toBe(true);

    const { data: exerciseRow } = await supabase
      .from('routine_exercises')
      .select('is_deleted')
      .eq('id', routineExercise.id)
      .single();
    expect(exerciseRow!.is_deleted).toBe(true);
  });

  it('activating a routine deactivates the previous one and logs routine_history', async () => {
    const routineA = await createRoutine(supabase, userId, {
      name: `Routine A ${Date.now()}`,
      usesTopSetBackoff: false,
      suggestedDurationWeeks: null,
      nextRoutineId: null,
    });
    const routineB = await createRoutine(supabase, userId, {
      name: `Routine B ${Date.now()}`,
      usesTopSetBackoff: false,
      suggestedDurationWeeks: null,
      nextRoutineId: null,
    });

    await activateRoutine(supabase, userId, routineA.id);
    await activateRoutine(supabase, userId, routineB.id);

    const { data: rows } = await supabase
      .from('routines')
      .select('id, is_active')
      .in('id', [routineA.id, routineB.id]);
    expect(rows!.find((r) => r.id === routineA.id)!.is_active).toBe(false);
    expect(rows!.find((r) => r.id === routineB.id)!.is_active).toBe(true);

    const { data: history } = await supabase
      .from('routine_history')
      .select('*')
      .eq('routine_id', routineB.id)
      .eq('event_type', 'started');
    expect(history!.length).toBe(1);
  });

  it('creates and reorders days, and cascades soft-delete to their exercises', async () => {
    const { routine } = await seedTestRoutine(supabase, userId);
    const dayOne = await createDay(supabase, routine.id, { name: 'Day One', isRestDay: false });
    const dayTwo = await createDay(supabase, routine.id, { name: 'Day Two', isRestDay: false });
    expect(dayTwo.order_index).toBe(dayOne.order_index + 1);

    await moveDay(supabase, routine.id, dayTwo.id, 'up');
    const { data: reordered } = await supabase
      .from('routine_days')
      .select('id, order_index')
      .in('id', [dayOne.id, dayTwo.id])
      .order('order_index');
    expect(reordered![0].id).toBe(dayTwo.id);
    expect(reordered![1].id).toBe(dayOne.id);

    const exercise = await findOrCreateExercise(supabase, `Test Exercise ${Date.now()}`, 'upper');
    const routineExercise = await createRoutineExercise(supabase, dayOne.id, {
      exerciseId: exercise.id,
      role: 'main',
      schemeType: 'normal',
      repUnit: 'reps',
      sets: 3,
      repMin: 8,
      repMax: 10,
      rirMin: 2,
      rirMax: 3,
      topSetReps: null,
      backoffSets: null,
      backoffRepMin: null,
      backoffRepMax: null,
    });

    await softDeleteDay(supabase, dayOne.id);
    const { data: exerciseRow } = await supabase
      .from('routine_exercises')
      .select('is_deleted')
      .eq('id', routineExercise.id)
      .single();
    expect(exerciseRow!.is_deleted).toBe(true);
  });

  it('reorders and soft-deletes exercises within a day', async () => {
    const { day } = await seedTestRoutine(supabase, userId);
    const exerciseOne = await findOrCreateExercise(supabase, `Reorder Exercise A ${Date.now()}`, 'upper');
    const exerciseTwo = await findOrCreateExercise(supabase, `Reorder Exercise B ${Date.now()}`, 'upper');
    const input = {
      role: 'accessory' as const,
      schemeType: 'normal' as const,
      repUnit: 'reps' as const,
      sets: 2,
      repMin: 10,
      repMax: 12,
      rirMin: 2,
      rirMax: 3,
      topSetReps: null,
      backoffSets: null,
      backoffRepMin: null,
      backoffRepMax: null,
    };

    const routineExerciseOne = await createRoutineExercise(supabase, day.id, {
      ...input,
      exerciseId: exerciseOne.id,
    });
    const routineExerciseTwo = await createRoutineExercise(supabase, day.id, {
      ...input,
      exerciseId: exerciseTwo.id,
    });

    await moveRoutineExercise(supabase, day.id, routineExerciseTwo.id, 'up');
    const { data: reordered } = await supabase
      .from('routine_exercises')
      .select('id')
      .in('id', [routineExerciseOne.id, routineExerciseTwo.id])
      .order('order_index');
    expect(reordered![0].id).toBe(routineExerciseTwo.id);
    expect(reordered![1].id).toBe(routineExerciseOne.id);

    await softDeleteRoutineExercise(supabase, routineExerciseOne.id);
    const { data: deletedRow } = await supabase
      .from('routine_exercises')
      .select('is_deleted')
      .eq('id', routineExerciseOne.id)
      .single();
    expect(deletedRow!.is_deleted).toBe(true);
  });

  it('findOrCreateExercise deduplicates by name', async () => {
    const name = `Dedup Exercise ${Date.now()}`;
    const first = await findOrCreateExercise(supabase, name, 'core');
    const second = await findOrCreateExercise(supabase, name, 'core');
    expect(second.id).toBe(first.id);
  });
});
