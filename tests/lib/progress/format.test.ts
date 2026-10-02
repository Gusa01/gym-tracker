import {
  formatNumber,
  formatMetricValue,
  formatSourceSet,
  formatShortDate,
  formatDaysAgo,
  buildPrBannerText,
} from '../../../src/lib/progress/format';

describe('formatNumber', () => {
  it('drops a trailing .0 and keeps one decimal otherwise', () => {
    expect(formatNumber(96)).toBe('96');
    expect(formatNumber(97.5)).toBe('97.5');
    expect(formatNumber(96.04)).toBe('96');
  });
});

describe('formatMetricValue', () => {
  it('adds the unit for each metric', () => {
    expect(formatMetricValue(96, 'e1rm')).toBe('96 kg');
    expect(formatMetricValue(85, 'weight')).toBe('85 kg');
    expect(formatMetricValue(75, 'seconds')).toBe('75 s');
    expect(formatMetricValue(12, 'reps')).toBe('12 reps');
  });
});

describe('formatSourceSet', () => {
  it('shows weight x reps for weight-based metrics', () => {
    expect(formatSourceSet({ weight: 80, reps: 6 }, 'e1rm')).toBe('80 kg × 6');
    expect(formatSourceSet({ weight: 82.5, reps: 3 }, 'weight')).toBe('82.5 kg × 3');
  });

  it('shows the single value otherwise', () => {
    expect(formatSourceSet({ weight: 0, reps: 75 }, 'seconds')).toBe('75 s');
    expect(formatSourceSet({ weight: 0, reps: 12 }, 'reps')).toBe('12 reps');
  });
});

describe('formatShortDate', () => {
  it('formats YYYY-MM-DD as DD/MM', () => {
    expect(formatShortDate('2026-09-12')).toBe('12/09');
  });
});

describe('formatDaysAgo', () => {
  const today = new Date(2026, 9, 1, 18, 30); // 1 Oct 2026, local time
  it('says hoy, ayer, or hace N días', () => {
    expect(formatDaysAgo('2026-10-01', today)).toBe('hoy');
    expect(formatDaysAgo('2026-09-30', today)).toBe('ayer');
    expect(formatDaysAgo('2026-09-27', today)).toBe('hace 4 días');
  });
});

describe('buildPrBannerText', () => {
  it('shows value and previous for a single record', () => {
    expect(buildPrBannerText('Press banca', [{ metric: 'e1rm', value: 98, previous: 96 }])).toEqual({
      title: '🏆 ¡Nuevo PR en Press banca!',
      detail: '1RM est. 98 kg (antes 96 kg)',
    });
  });

  it('joins several records without the previous values', () => {
    expect(
      buildPrBannerText('Press banca', [
        { metric: 'e1rm', value: 98, previous: 96 },
        { metric: 'weight', value: 85, previous: 82.5 },
      ]).detail
    ).toBe('1RM est. 98 kg · Peso 85 kg');
  });

  it('labels time and rep records', () => {
    expect(buildPrBannerText('Plancha', [{ metric: 'seconds', value: 75, previous: 60 }]).detail).toBe(
      'Tiempo 75 s (antes 60 s)'
    );
    expect(buildPrBannerText('Dominadas', [{ metric: 'reps', value: 13, previous: 12 }]).detail).toBe(
      'Máx. 13 reps (antes 12 reps)'
    );
  });
});
