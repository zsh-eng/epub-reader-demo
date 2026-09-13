/** Statistics use the current device time zone. Each study day starts at 04:00. */
export function studyDayKey(value: Date | number | string): string {
  const date = new Date(value);
  if (date.getHours() < 4) date.setDate(date.getDate() - 1);
  return calendarKey(date);
}

function calendarKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Parse a calendar key in local time. Noon avoids midnight clock changes. */
export function studyDayDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function addStudyDays(key: string, days: number): string {
  const date = studyDayDate(key);
  date.setDate(date.getDate() + days);
  return calendarKey(date);
}

/** Clamp the date to the last day of the target month. */
export function addStudyMonths(key: string, months: number): string {
  const date = studyDayDate(key);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
    12,
  ).getDate();
  date.setDate(Math.min(day, lastDay));
  return calendarKey(date);
}

export function isInStudyRange(
  value: Date | number | string,
  first: string,
  last: string,
): boolean {
  const key = studyDayKey(value);
  return key >= first && key <= last;
}

export function nextStudyDayStart(value: Date | number): number {
  const date = new Date(value);
  const next = new Date(date);
  next.setHours(4, 0, 0, 0);
  if (next.getTime() <= date.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}
