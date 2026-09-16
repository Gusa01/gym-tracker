import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseRoutineMarkdown } from './parseRoutineMarkdown';

export interface ImportResult {
  imported: boolean;
  reason?: string;
  routineIds?: Record<string, string>;
}

const MUSCLE_GROUP_BY_EXERCISE: Record<string, 'upper' | 'lower' | 'core'> = {
  'Sentadilla (o Prensa)': 'lower',
  'Press banca': 'upper',
  'Remo en máquina o mancuerna': 'upper',
  'Press militar mancuernas': 'upper',
  'Curl bíceps': 'upper',
  'Extensión tríceps': 'upper',
  'Peso muerto rumano': 'lower',
  'Jalón al pecho o Dominada asistida': 'upper',
  'Press inclinado mancuernas': 'upper',
  Zancadas: 'lower',
  'Elevaciones laterales': 'upper',
  'Curl femoral o gemelos': 'lower',
  Plancha: 'core',
  'Elevación de piernas colgado o en banco': 'core',
  'Rueda abdominal o Pallof press': 'core',
  'Anti-rotación (Pallof press o similar)': 'core',
  'Remo con barra o mancuerna': 'upper',
  'Press militar': 'upper',
  'Dominadas o Jalón': 'upper',
  Sentadilla: 'lower',
  Prensa: 'lower',
  'Elevación de talón': 'lower',
  'Elevación de piernas': 'core',
  'Aperturas o Cruces en polea': 'upper',
  'Jalón al pecho': 'upper',
  'Remo en máquina': 'upper',
  'Face pulls': 'upper',
  'Curl martillo': 'upper',
  'Anti-rotación': 'core',
  'Prensa o Sentadilla': 'lower',
  'Curl femoral': 'lower',
  Gemelos: 'lower',
};

function muscleGroupForExercise(name: string): 'upper' | 'lower' | 'core' {
  const group = MUSCLE_GROUP_BY_EXERCISE[name];
  if (!group) {
    throw new Error(
      `No muscle_group mapping for exercise "${name}" — add it to MUSCLE_GROUP_BY_EXERCISE.`
    );
  }
  return group;
}

async function findOrCreateExercise(supabase: SupabaseClient, name: string): Promise<string> {
  const { data: existing, error: existingError } = await supabase
    .from('exercises')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing.id;

  const { data: created, error: createError } = await supabase
    .from('exercises')
    .insert({ name, muscle_group: muscleGroupForExercise(name) })
    .select()
    .single();
  if (createError) {
    // Another concurrent caller created the same name between our select and insert —
    // fetch what they created instead of failing on the unique constraint.
    if (createError.code === '23505') {
      const { data: raceWinner, error: raceError } = await supabase
        .from('exercises')
        .select('id')
        .eq('name', name)
        .single();
      if (raceError) throw raceError;
      return raceWinner.id;
    }
    throw createError;
  }
  return created.id;
}

export async function importRoutine(
  supabase: SupabaseClient,
  userId: string,
  markdown: string
): Promise<ImportResult> {
  const routines = parseRoutineMarkdown(markdown);

  for (const routine of routines) {
    const { data: existing, error: existingError } = await supabase
      .from('routines')
      .select('id')
      .eq('user_id', userId)
      .eq('name', routine.name)
      .eq('is_deleted', false)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return { imported: false, reason: `Routine "${routine.name}" already exists for this user.` };
    }
  }

  const routineIdsByName: Record<string, string> = {};

  for (const routine of routines) {
    const { data: routineRow, error: routineError } = await supabase
      .from('routines')
      .insert({
        user_id: userId,
        name: routine.name,
        uses_top_set_backoff: routine.usesTopSetBackoff,
        suggested_duration_weeks: routine.suggestedDurationWeeks,
      })
      .select()
      .single();
    if (routineError) throw routineError;
    routineIdsByName[routine.name] = routineRow.id;

    const dayIdsByName: Record<string, string> = {};

    for (const [dayIndex, day] of routine.days.entries()) {
      const { data: dayRow, error: dayError } = await supabase
        .from('routine_days')
        .insert({
          routine_id: routineRow.id,
          name: day.name,
          order_index: dayIndex,
          is_rest_day: day.isRestDay,
        })
        .select()
        .single();
      if (dayError) throw dayError;
      dayIdsByName[day.name] = dayRow.id;

      for (const [exerciseIndex, exercise] of day.exercises.entries()) {
        const exerciseId = await findOrCreateExercise(supabase, exercise.name);
        const { error: routineExerciseError } = await supabase.from('routine_exercises').insert({
          routine_day_id: dayRow.id,
          exercise_id: exerciseId,
          order_index: exerciseIndex,
          role: exercise.role,
          scheme_type: exercise.schemeType,
          rep_unit: exercise.repUnit,
          sets: exercise.sets,
          rep_min: exercise.repMin,
          rep_max: exercise.repMax,
          rir_min: exercise.rirMin,
          rir_max: exercise.rirMax,
          top_set_reps: exercise.topSetReps,
          backoff_sets: exercise.backoffSets,
          backoff_rep_min: exercise.backoffRepMin,
          backoff_rep_max: exercise.backoffRepMax,
        });
        if (routineExerciseError) throw routineExerciseError;
      }
    }

    const weekdaySchedule: Record<string, unknown> = {};
    for (const [weekday, entry] of Object.entries(routine.weekdayScheduleByDayName)) {
      weekdaySchedule[weekday] =
        typeof entry === 'string'
          ? dayIdsByName[entry]
          : { even_week: dayIdsByName[entry.evenWeek], odd_week: dayIdsByName[entry.oddWeek] };
    }

    const { error: scheduleError } = await supabase
      .from('routines')
      .update({ weekday_schedule: weekdaySchedule })
      .eq('id', routineRow.id);
    if (scheduleError) throw scheduleError;
  }

  for (const routine of routines) {
    if (!routine.nextRoutineName) continue;
    const { error } = await supabase
      .from('routines')
      .update({ next_routine_id: routineIdsByName[routine.nextRoutineName] })
      .eq('id', routineIdsByName[routine.name]);
    if (error) throw error;
  }

  return { imported: true, routineIds: routineIdsByName };
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/import-routine.ts <user-email>');
    process.exit(1);
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey);

  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  const user = users.users.find((u) => u.email === email);
  if (!user) {
    console.error(`No user found with email ${email}. Sign up in the app first.`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(
    path.join(__dirname, '..', 'rutina_gym_top_set_back_off.md'),
    'utf-8'
  );
  const result = await importRoutine(supabase, user.id, markdown);
  if (!result.imported) {
    console.log(`Import skipped: ${result.reason}`);
    return;
  }
  console.log('Imported routines:', result.routineIds);
}

const isMainModule = process.argv[1]?.endsWith('import-routine.ts') ?? false;
if (isMainModule) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
