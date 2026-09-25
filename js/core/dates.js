// Calendar dates are local YYYY-MM-DD values. Timestamps (createdAt, updatedAt)
// are UTC ISO strings; converting a date-only string through UTC can move it
// backwards a day on devices west of Greenwich.
const pad = n => String(n).padStart(2, '0');

export function toDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toISODate(value) {
  const date = toDate(value);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : null;
}

/** The device's calendar date, never the UTC date of the current timestamp. */
export function todayISO() { return toISODate(new Date()); }

export function startOfDay(value = new Date()) {
  const date = toDate(value) || new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}
export function endOfDay(value = new Date()) {
  const date = toDate(value) || new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}
export function addDays(value, days) {
  const date = toDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}
export function startOfWeek(value = new Date()) {
  const date = startOfDay(value);
  const day = date.getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}
export function endOfWeek(value = new Date()) { return endOfDay(addDays(startOfWeek(value), 6)); }
export function startOfMonth(value = new Date()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
export function endOfMonth(value = new Date()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}
export function startOfYear(value = new Date()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), 0, 1);
}
export function endOfYear(value = new Date()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

export function rangePreset(name, base = new Date()) {
  const date = toDate(base) || new Date();
  switch (name) {
    case 'today': return [startOfDay(date), endOfDay(date)];
    case 'yesterday': return [startOfDay(addDays(date, -1)), endOfDay(addDays(date, -1))];
    case 'tomorrow': return [startOfDay(addDays(date, 1)), endOfDay(addDays(date, 1))];
    case 'week': return [startOfWeek(date), endOfWeek(date)];
    case 'previous-week': { const start = startOfWeek(addDays(date, -7)); return [start, endOfWeek(start)]; }
    case 'next-week': { const start = startOfWeek(addDays(date, 7)); return [start, endOfWeek(start)]; }
    case 'month': return [startOfMonth(date), endOfMonth(date)];
    case 'previous-month': { const start = startOfMonth(new Date(date.getFullYear(), date.getMonth() - 1, 1)); return [start, endOfMonth(start)]; }
    case 'next-month': { const start = startOfMonth(new Date(date.getFullYear(), date.getMonth() + 1, 1)); return [start, endOfMonth(start)]; }
    case 'last-7': return [startOfDay(addDays(date, -6)), endOfDay(date)];
    case 'last-30': return [startOfDay(addDays(date, -29)), endOfDay(date)];
    case 'last-90': return [startOfDay(addDays(date, -89)), endOfDay(date)];
    case 'year': return [startOfYear(date), endOfYear(date)];
    case 'previous-year': {
      const year = date.getFullYear() - 1;
      return [new Date(year, 0, 1), new Date(year, 11, 31, 23, 59, 59, 999)];
    }
    case 'ytd': return [startOfYear(date), endOfDay(date)];
    default: return [null, null];
  }
}

export function formatDate(value, options = { dateStyle: 'medium' }) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat('ar-EG', options).format(date) : '—';
}
