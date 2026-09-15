import { SupabaseClient } from '@supabase/supabase-js';
import { seedTestRoutine } from './seedTestRoutine';
import { activateRoutine } from '../../src/lib/routines/mutations';

export async function seedActiveRoutine(supabase: SupabaseClient, userId: string) {
  const seeded = await seedTestRoutine(supabase, userId);
  await activateRoutine(supabase, userId, seeded.routine.id);
  const { data: routine, error } = await supabase
    .from('routines')
    .select('*')
    .eq('id', seeded.routine.id)
    .single();
  if (error) throw error;
  return { ...seeded, routine };
}
