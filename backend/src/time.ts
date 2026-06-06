function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

export function getUtcDateString(date = new Date()) {
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

export function getUtcMonthString(date = new Date()) {
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}`;
}

export function startOfUtcTodayIso(date = new Date()) {
  return `${getUtcDateString(date)}T00:00:00.000Z`;
}

export function recentUtcMonths(count: number, date = new Date()) {
  const start = new Date(`${getUtcMonthString(date)}-01T00:00:00.000Z`);
  start.setUTCMonth(start.getUTCMonth() - count + 1);

  return Array.from({ length: count }, (_, index) => {
    const next = new Date(start);
    next.setUTCMonth(start.getUTCMonth() + index);
    return getUtcMonthString(next);
  });
}

export function utcMonthRangeIso(month: string) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

export function formatUtcDateTimeMinute(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return [
    `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`,
    `${padDatePart(date.getUTCHours())}:${padDatePart(date.getUTCMinutes())}`
  ].join(' ');
}
