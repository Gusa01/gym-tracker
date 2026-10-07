import { RoutineExerciseRepUnit } from '../routines/types';
import { LoggedSet } from '../sessions/types';
import { formatNumber } from '../progress/format';

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function formatSessionTitle(date: string, dayName: string): string {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const [, month, day] = date.split('-');
  const base = `${weekday} ${day}/${month}`;
  return dayName ? `${base} · ${dayName}` : base;
}

export function formatSetLabel(set: LoggedSet): string {
  switch (set.set_type) {
    case 'top_set':
      return 'Top set';
    case 'back_off':
      return 'Back-off';
    case 'warmup':
      return 'Entrada en calor';
    case 'working':
      return `Serie ${set.set_index}`;
  }
}

export function formatSetValues(set: LoggedSet, repUnit: RoutineExerciseRepUnit): string {
  if (repUnit === 'seconds') return `${set.reps} s`;
  const main = set.weight > 0 ? `${formatNumber(set.weight)} kg × ${set.reps}` : `${set.reps} reps`;
  return set.rir !== null ? `${main} · RIR ${set.rir}` : main;
}
