import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedTestRoutine } from '../../helpers/seedTestRoutine';
import {
  createRoutine,
  updateRoutine,
  softDeleteRoutine,
  activateRoutine,
  createDay,
  updateDay,
  softDeleteDay,
  moveDay,
  createRoutineExercise,
  updateRoutineExercise,
  softDeleteRoutineExercise,
  reorderRoutineExercises,
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
      .select('id, is_active, started_at')
      .in('id', [routineA.id, routineB.id]);
    expect(rows!.find((r) => r.id === routineA.id)!.is_active).toBe(false);
    expect(rows!.find((r) => r.id === routineB.id)!.is_active).toBe(true);
    expect(rows!.find((r) => r.id === routineB.id)!.started_at).not.toBeNull();

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

    const exercise = await findOrCreateExercise(supabase, '[test-fixture] Cascade Delete Exercise', 'upper');
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

  it('soft-deletes an exercise within a day', async () => {
    const { day } = await seedTestRoutine(supabase, userId);
    const exerciseOne = await findOrCreateExercise(supabase, '[test-fixture] Delete Exercise A', 'upper');
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

    await softDeleteRoutineExercise(supabase, routineExerciseOne.id);
    const { data: deletedRow } = await supabase
      .from('routine_exercises')
      .select('is_deleted')
      .eq('id', routineExerciseOne.id)
      .single();
    expect(deletedRow!.is_deleted).toBe(true);
  });

  it('reorderRoutineExercises applies an arbitrary new order in one call', async () => {
    const { day } = await seedTestRoutine(supabase, userId);
    const exerciseOne = await findOrCreateExercise(supabase, '[test-fixture] Drag Exercise A', 'upper');
    const exerciseTwo = await findOrCreateExercise(supabase, '[test-fixture] Drag Exercise B', 'upper');
    const exerciseThree = await findOrCreateExercise(supabase, '[test-fixture] Drag Exercise C', 'upper');
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

    const routineExerciseOne = await createRoutineExercise(supabase, day.id, { ...input, exerciseId: exerciseOne.id });
    const routineExerciseTwo = await createRoutineExercise(supabase, day.id, { ...input, exerciseId: exerciseTwo.id });
    const routineExerciseThree = await createRoutineExercise(supabase, day.id, {
      ...input,
      exerciseId: exerciseThree.id,
    });

    // Move the last one to the front — not reachable via a single adjacent swap.
    await reorderRoutineExercises(supabase, [
      routineExerciseThree.id,
      routineExerciseOne.id,
      routineExerciseTwo.id,
    ]);

    const { data: reordered } = await supabase
      .from('routine_exercises')
      .select('id')
      .in('id', [routineExerciseOne.id, routineExerciseTwo.id, routineExerciseThree.id])
      .order('order_index');
    expect(reordered!.map((r) => r.id)).toEqual([
      routineExerciseThree.id,
      routineExerciseOne.id,
      routineExerciseTwo.id,
    ]);
  });

  it('findOrCreateExercise deduplicates by name', async () => {
    const name = '[test-fixture] Dedup Exercise';
    const first = await findOrCreateExercise(supabase, name, 'core');
    const second = await findOrCreateExercise(supabase, name, 'core');
    expect(second.id).toBe(first.id);
    await supabase.from('exercises').delete().eq('id', first.id);
  });

  it('updateRoutine patches only the given fields', async () => {
    const { routine } = await seedTestRoutine(supabase, userId);
    const updated = await updateRoutine(supabase, routine.id, { suggestedDurationWeeks: 6 });
    expect(updated.suggested_duration_weeks).toBe(6);
    expect(updated.name).toBe(routine.name);

    const { data: row } = await supabase
      .from('routines')
      .select('suggested_duration_weeks, name')
      .eq('id', routine.id)
      .single();
    expect(row!.suggested_duration_weeks).toBe(6);
    expect(row!.name).toBe(routine.name);
  });

  it('updateDay patches only the given fields', async () => {
    const { day } = await seedTestRoutine(supabase, userId);
    const updated = await updateDay(supabase, day.id, { isRestDay: true });
    expect(updated.is_rest_day).toBe(true);
    expect(updated.name).toBe(day.name);

    const { data: row } = await supabase
      .from('routine_days')
      .select('is_rest_day, name')
      .eq('id', day.id)
      .single();
    expect(row!.is_rest_day).toBe(true);
    expect(row!.name).toBe(day.name);
  });

  it('updateRoutineExercise patches only the given fields', async () => {
    const { routineExercise } = await seedTestRoutine(supabase, userId);
    const updated = await updateRoutineExercise(supabase, routineExercise.id, { repMax: 15 });
    expect(updated.rep_max).toBe(15);
    expect(updated.rep_min).toBe(routineExercise.rep_min);

    const { data: row } = await supabase
      .from('routine_exercises')
      .select('rep_max, rep_min')
      .eq('id', routineExercise.id)
      .single();
    expect(row!.rep_max).toBe(15);
    expect(row!.rep_min).toBe(routineExercise.rep_min);
  });
});
