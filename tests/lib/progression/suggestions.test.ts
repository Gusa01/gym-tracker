import { createAdminClient } from '../../helpers/supabaseAdmin';
import { seedActiveRoutine } from '../../helpers/seedActiveRoutine';
import { listRecentTopSets } from '../../../src/lib/progression/queries';
import { recordDeload } from '../../../src/lib/progression/mutations';
import { computeSuggestions } from '../../../src/lib/progression/suggestions';
import { RoutineExerciseWithName } from '../../../src/lib/routines/types';

const supabase = createAdminClient();
const testEmail = `progression-suggestions-${Date.now()}@example.com`;
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

async function seedTopSetExercise(dayId: string): Promise<RoutineExerciseWithName> {
  const suffix = Date.now() + Math.random();
  const { data: exercise, error: exerciseError } = await supabase
    .from('exercises')
    .insert({ name: `Sentadilla ${suffix}`, muscle_group: 'lower' })
    .select()
    .single();
  if (exerciseError) throw exerciseError;

  const { data: routineExercise, error: routineExerciseError } = await supabase
    .from('routine_exercises')
    .insert({
      routine_day_id: dayId,
      exercise_id: exercise.id,
      order_index: 1,
      role: 'main',
      scheme_type: 'top_set_backoff',
      top_set_reps: 5,
      backoff_sets: 2,
      backoff_rep_min: 8,
      backoff_rep_max: 10,
      rir_min: 1,
      rir_max: 2,
    })
    .select('*, exercises(name)')
    .single();
  if (routineExerciseError) throw routineExerciseError;

  return { ...routineExercise, exercise_name: routineExercise.exercises.name };
}

async function seedCompletedSessionWithTopSet(
  dayId: string,
  routineExerciseId: string,
  sessionDate: string,
  reps: number,
  rir: number
) {
  const { data: sessionRow, error: sessionError } = await supabase
    .from('workout_sessions')
    .insert({ user_id: userId, routine_day_id: dayId, session_date: sessionDate, status: 'completed' })
    .select()
    .single();
  if (sessionError) throw sessionError;

  const { error: setError } = await supabase.from('logged_sets').insert({
    session_id: sessionRow.id,
    routine_exercise_id: routineExerciseId,
    set_index: 1,
    set_type: 'top_set',
    weight: 80,
    reps,
    rir,
  });
  if (setError) throw setError;
}

describe('listRecentTopSets', () => {
  it('returns completed-session top sets, most recent first, limited to 2', async () => {
    const { day } = await seedActiveRoutine(supabase, userId);
    const exercise = await seedTopSetExercise(day.id);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-03-01', 5, 2);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-03-08', 4, 1);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-03-15', 3, 0);

    const sets = await listRecentTopSets(supabase, exercise.id);
    expect(sets).toHaveLength(2);
    expect(sets.map((s) => s.reps)).toEqual([3, 4]);
  });
});

const NO_SUCH_ROUTINE_ID = '00000000-0000-0000-0000-000000000000';

describe('computeSuggestions', () => {
  it('suggests a deload when the top set missed in the last two completed sessions', async () => {
    const { day, routine } = await seedActiveRoutine(supabase, userId);
    const exercise = await seedTopSetExercise(day.id);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-04-01', 3, 0);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-04-08', 4, 0);

    const result = await computeSuggestions(
      supabase,
      [exercise],
      { started_at: null, suggested_duration_weeks: null, next_routine_id: null },
      routine.id,
      new Date()
    );
    expect(result.deloadExerciseName).toBe(exercise.exercise_name);
  });

  it('does not suggest a deload when only one of the last two sessions missed', async () => {
    const { day, routine } = await seedActiveRoutine(supabase, userId);
    const exercise = await seedTopSetExercise(day.id);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-05-01', 5, 2);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-05-08', 3, 0);

    const result = await computeSuggestions(
      supabase,
      [exercise],
      { started_at: null, suggested_duration_weeks: null, next_routine_id: null },
      routine.id,
      new Date()
    );
    expect(result.deloadExerciseName).toBeNull();
  });

  it('suppresses a deload suggestion once already accepted for that pair of sessions, but resurfaces after a new deficient session', async () => {
    const { day, routine } = await seedActiveRoutine(supabase, userId);
    const exercise = await seedTopSetExercise(day.id);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-06-01', 3, 0);
    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-06-08', 4, 0);

    const beforeAccept = await computeSuggestions(
      supabase,
      [exercise],
      { started_at: null, suggested_duration_weeks: null, next_routine_id: null },
      routine.id,
      new Date()
    );
    expect(beforeAccept.deloadExerciseName).toBe(exercise.exercise_name);

    await recordDeload(supabase, userId, routine.id);

    const afterAccept = await computeSuggestions(
      supabase,
      [exercise],
      { started_at: null, suggested_duration_weeks: null, next_routine_id: null },
      routine.id,
      new Date()
    );
    expect(afterAccept.deloadExerciseName).toBeNull();

    await seedCompletedSessionWithTopSet(day.id, exercise.id, '2026-06-15', 3, 0);

    const afterNewSession = await computeSuggestions(
      supabase,
      [exercise],
      { started_at: null, suggested_duration_weeks: null, next_routine_id: null },
      routine.id,
      new Date()
    );
    expect(afterNewSession.deloadExerciseName).toBe(exercise.exercise_name);
  });

  it('suggests a routine switch once the suggested duration is exceeded', async () => {
    const routine = {
      started_at: '2026-01-01T12:00:00.000Z',
      suggested_duration_weeks: 4,
      next_routine_id: 'next-routine-id',
    };
    const result = await computeSuggestions(supabase, [], routine, NO_SUCH_ROUTINE_ID, new Date(2026, 0, 29, 12));
    expect(result.routineSwitchAvailable).toBe(true);
  });

  it('does not suggest a routine switch with no next routine configured', async () => {
    const routine = {
      started_at: '2026-01-01T12:00:00.000Z',
      suggested_duration_weeks: 4,
      next_routine_id: null,
    };
    const result = await computeSuggestions(supabase, [], routine, NO_SUCH_ROUTINE_ID, new Date(2026, 0, 29, 12));
    expect(result.routineSwitchAvailable).toBe(false);
  });
});

describe('recordDeload', () => {
  it('inserts a deload event into routine_history', async () => {
    const { routine } = await seedActiveRoutine(supabase, userId);
    await recordDeload(supabase, userId, routine.id);
    const { data, error } = await supabase
      .from('routine_history')
      .select('*')
      .eq('routine_id', routine.id)
      .eq('event_type', 'deload');
    if (error) throw error;
    expect(data).toHaveLength(1);
  });
});
