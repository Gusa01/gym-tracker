import { BrokenRecord, Metric } from './types';

/** Labels for the detail screen's metric toggle. */
export const TOGGLE_LABEL: Record<'e1rm' | 'weight', string> = { e1rm: '1RM est.', weight: 'Peso' };

/** Labels for the detail screen's records card. */
export const RECORD_LABEL: Record<Metric, string> = {
  e1rm: 'Mejor 1RM est.',
  weight: 'Mejor peso',
  seconds: 'Mejor tiempo',
  reps: 'Más reps',
};

const BANNER_LABEL: Record<Metric, string> = { e1rm: '1RM est.', weight: 'Peso', seconds: 'Tiempo', reps: 'Máx.' };

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatMetricValue(value: number, metric: Metric): string {
  const n = formatNumber(value);
  if (metric === 'seconds') return `${n} s`;
  if (metric === 'reps') return `${n} reps`;
  return `${n} kg`;
}

export function formatSourceSet(set: { weight: number; reps: number }, metric: Metric): string {
  if (metric === 'e1rm' || metric === 'weight') return `${formatNumber(set.weight)} kg × ${set.reps}`;
  return formatMetricValue(set.reps, metric);
}

export function formatShortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

export function formatDaysAgo(date: string, today: Date): string {
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dateUtc = Date.parse(`${date}T00:00:00Z`);
  const days = Math.round((todayUtc - dateUtc) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

export function buildPrBannerText(exerciseName: string, broken: BrokenRecord[]): { title: string; detail: string } {
  const title = `🏆 ¡Nuevo PR en ${exerciseName}!`;
  if (broken.length === 1) {
    const [record] = broken;
    return {
      title,
      detail: `${BANNER_LABEL[record.metric]} ${formatMetricValue(record.value, record.metric)} (antes ${formatMetricValue(record.previous, record.metric)})`,
    };
  }
  return {
    title,
    detail: broken.map((r) => `${BANNER_LABEL[r.metric]} ${formatMetricValue(r.value, r.metric)}`).join(' · '),
  };
}
