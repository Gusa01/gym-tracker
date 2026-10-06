import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { importRoutine } from './import-routine';
import { addDays, DemoDay, DemoPhase, generateDemoHistory } from './generateDemoHistory';
import { formatDateOnly } from '../src/lib/sessions/weekResolution';

// Full Body for 4 weeks, then Split 5 días for 8, mirroring rutina_gym_top_set_back_off.md.
// Week 9 (Split's 5th week) is a deload so the trend arrows show a real dip and recovery.
const PHASES = [
  { routineName: 'Full Body', weeks: 4 },
  { routineName: 'Split 5 días', weeks: 8 },
];
const DELOAD_WEEKS = [9];
const SEED = 20261004;
const INSERT_CHUNK = 500;

async function findUserByEmail(supabase: SupabaseClient, email: string) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) ?? null;
}

async function loadPhase(supabase: SupabaseClient, routineId: string, weeks: number): Promise<DemoPhase> {
  const { data: routine, error: routineError } = await supabase
    .from('routines')
    .select('weekday_schedule')
    .eq('id', routineId)
    .single();
  if (routineError) throw routineError;

  const { data: days, error: daysError } = await supabase
    .from('routine_days')
    .select('id, is_rest_day')
    .eq('routine_id', routineId)
    .eq('is_deleted', false)
    .order('order_index');
  if (daysError) throw daysError;

  const demoDays: DemoDay[] = [];
  for (const day of days ?? []) {
    const { data: exercises, error: exercisesError } = await supabase
      .from('routine_exercises')
      .select('*, exercises(muscle_group)')
      .eq('routine_day_id', day.id)
      .eq('is_deleted', false)
      .order('order_index');
    if (exercisesError) throw exercisesError;
    demoDays.push({
      dayId: day.id,
      isRestDay: day.is_rest_day,
      exercises: (exercises ?? []).map((e) => ({
        routineExerciseId: e.id,
        exerciseId: e.exercise_id,
        muscleGroup: e.exercises.muscle_group,
        role: e.role,
        scheme_type: e.scheme_type,
        rep_unit: e.rep_unit,
        sets: e.sets,
        rep_min: e.rep_min,
        rep_max: e.rep_max,
        rir_min: e.rir_min,
        rir_max: e.rir_max,
        top_set_reps: e.top_set_reps,
        backoff_sets: e.backoff_sets,
        backoff_rep_min: e.backoff_rep_min,
        backoff_rep_max: e.backoff_rep_max,
      })),
    });
  }

  return { weekdaySchedule: routine.weekday_schedule ?? {}, days: demoDays, weeks };
}

async function insertInChunks(supabase: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + INSERT_CHUNK));
    if (error) throw error;
  }
}

function mondayOf(date: Date): string {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return addDays(formatDateOnly(date), -daysSinceMonday);
}

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!url || !serviceKey || !email || !password) {
    console.error(
      'Missing EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_USER_EMAIL or DEMO_USER_PASSWORD in .env.local.'
    );
    process.exit(1);
  }
  // This script deletes and recreates the user it targets. Refuse anything that doesn't look
  // like a demo account, so a misconfigured .env.local can never wipe a real user.
  if (!email.toLowerCase().includes('demo')) {
    console.error(`Refusing to reset "${email}": DEMO_USER_EMAIL must contain "demo".`);
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const existing = await findUserByEmail(supabase, email);
  if (existing) {
    const { error } = await supabase.auth.admin.deleteUser(existing.id);
    if (error) throw error;
    console.log(`Deleted previous demo user and all of its data.`);
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;
  const userId = created.user.id;

  const markdown = fs.readFileSync(path.join(__dirname, '..', 'rutina_gym_top_set_back_off.md'), 'utf-8');
  const imported = await importRoutine(supabase, userId, markdown);
  if (!imported.imported || !imported.routineIds) throw new Error(`Routine import failed: ${imported.reason}`);
  const routineIds = imported.routineIds;

  const today = new Date();
  const totalWeeks = PHASES.reduce((sum, p) => sum + p.weeks, 0);
  const firstMonday = addDays(mondayOf(today), -7 * (totalWeeks - 1));

  const phases: DemoPhase[] = [];
  for (const p of PHASES) {
    const routineId = routineIds[p.routineName];
    if (!routineId) throw new Error(`Imported routines don't include "${p.routineName}".`);
    phases.push(await loadPhase(supabase, routineId, p.weeks));
  }

  const { sessions, finalStates } = generateDemoHistory({
    phases,
    firstMonday,
    today: formatDateOnly(today),
    seed: SEED,
    deloadWeeks: DELOAD_WEEKS,
  });

  const sessionRows = sessions.map((s) => ({
    id: randomUUID(),
    user_id: userId,
    routine_day_id: s.routineDayId,
    session_date: s.sessionDate,
    week_number: s.weekNumber,
    status: 'completed',
  }));
  await insertInChunks(supabase, 'workout_sessions', sessionRows);

  const setRows = sessions.flatMap((s, i) =>
    s.sets.map((set) => ({
      session_id: sessionRows[i].id,
      routine_exercise_id: set.routineExerciseId,
      set_index: set.setIndex,
      set_type: set.setType,
      weight: set.weight,
      reps: set.reps,
      rir: set.rir,
      created_at: `${s.sessionDate}T18:${String(10 + set.setIndex).padStart(2, '0')}:00Z`,
    }))
  );
  await insertInChunks(supabase, 'logged_sets', setRows);

  const { error: stateError } = await supabase.from('user_exercise_state').upsert(
    finalStates.map(({ exerciseId, ...state }) => ({
      user_id: userId,
      exercise_id: exerciseId,
      ...state,
      updated_at: today.toISOString(),
    })),
    { onConflict: 'user_id,exercise_id' }
  );
  if (stateError) throw stateError;

  // Activate the last phase's routine with backdated start dates so week numbers and the
  // Home calendar line up with the generated history.
  let phaseStart = firstMonday;
  for (const [index, p] of PHASES.entries()) {
    const routineId = routineIds[p.routineName];
    const startedAt = new Date(`${phaseStart}T09:00:00`).toISOString();
    const isActive = index === PHASES.length - 1;
    const { error: routineError } = await supabase
      .from('routines')
      .update({ is_active: isActive, started_at: startedAt })
      .eq('id', routineId);
    if (routineError) throw routineError;
    const { error: historyError } = await supabase
      .from('routine_history')
      .insert({ user_id: userId, routine_id: routineId, event_type: 'started', occurred_at: startedAt });
    if (historyError) throw historyError;
    phaseStart = addDays(phaseStart, 7 * p.weeks);
  }

  console.log(
    `Demo user ready (${email}): ${sessionRows.length} sessions, ${setRows.length} sets, ` +
      `${finalStates.length} exercise states, history since ${firstMonday}.`
  );
}

const isMainModule = process.argv[1]?.endsWith('seed-demo-user.ts') ?? false;
if (isMainModule) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
