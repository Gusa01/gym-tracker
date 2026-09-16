function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const jsDay = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function computeConsecutiveActiveWeeks(sessionDates: string[], now: Date): number {
  const activeMondayKeys = new Set(sessionDates.map((iso) => dateKey(mondayOf(parseDateOnly(iso)))));

  let cursor = mondayOf(now);
  if (!activeMondayKeys.has(dateKey(cursor))) {
    cursor = addDays(cursor, -7);
  }

  let count = 0;
  while (activeMondayKeys.has(dateKey(cursor))) {
    count++;
    cursor = addDays(cursor, -7);
  }
  return count;
}
