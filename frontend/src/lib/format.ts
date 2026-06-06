function isValidDate(date: Date) {
  return !Number.isNaN(date.getTime());
}

function padDatePart(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

function parseDateOnlyParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
  const parsed = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (
    parsed.getUTCFullYear() !== parts.year ||
    parsed.getUTCMonth() + 1 !== parts.month ||
    parsed.getUTCDate() !== parts.day
  ) {
    return null;
  }

  return parts;
}

function formatUtcDateOnly(date: Date) {
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

function formatUtcDateTimeMinute(date: Date) {
  return [
    formatUtcDateOnly(date),
    `${padDatePart(date.getUTCHours())}:${padDatePart(date.getUTCMinutes())}`
  ].join(' ');
}

function applyClientOffset(date: Date, clientOffsetMs = 0) {
  return new Date(date.getTime() + clientOffsetMs);
}

function removeClientOffset(timestamp: number, clientOffsetMs = 0) {
  return new Date(timestamp - clientOffsetMs).toISOString();
}

export function getServerNowIso(clientOffsetMs = 0) {
  return new Date(Date.now() - clientOffsetMs).toISOString();
}

export function getServerUtcDateInputValue(clientOffsetMs = 0) {
  return formatUtcDateOnly(new Date(Date.now() - clientOffsetMs));
}

export function normalizeDateInputValue(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return parseDateOnlyParts(trimmed) ? trimmed : '';
    }

    const parsed = new Date(trimmed);
    return isValidDate(parsed) ? formatUtcDateOnly(parsed) : '';
  }

  if (value instanceof Date) {
    return isValidDate(value) ? formatUtcDateOnly(value) : '';
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return isValidDate(parsed) ? formatUtcDateOnly(parsed) : '';
  }

  return '';
}

export function formatDate(value?: unknown, fallback = '-') {
  const normalized = normalizeDateInputValue(value);
  return normalized || fallback;
}

export function localDateBoundaryIso(value: string, boundary: 'start' | 'end', clientOffsetMs = 0) {
  const normalized = normalizeDateInputValue(value);
  const parts = parseDateOnlyParts(normalized);

  if (!parts) {
    return '';
  }

  const time = boundary === 'start'
    ? { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }
    : { hours: 23, minutes: 59, seconds: 59, milliseconds: 999 };
  const timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, time.hours, time.minutes, time.seconds, time.milliseconds);
  return removeClientOffset(timestamp, clientOffsetMs);
}

export function formatDateTime(value?: string | null, fallback = '-', clientOffsetMs = 0) {
  if (!value) return fallback;

  const parsed = new Date(value);
  return isValidDate(parsed) ? formatUtcDateTimeMinute(applyClientOffset(parsed, clientOffsetMs)) : fallback;
}

export function formatDateTimeInputValue(value: string, clientOffsetMs = 0) {
  if (!value) return '';
  const parsed = new Date(value);
  if (!isValidDate(parsed)) return '';
  const shifted = applyClientOffset(parsed, clientOffsetMs);
  return [
    shifted.getUTCFullYear(),
    padDatePart(shifted.getUTCMonth() + 1),
    padDatePart(shifted.getUTCDate())
  ].join('-') + `T${padDatePart(shifted.getUTCHours())}:${padDatePart(shifted.getUTCMinutes())}`;
}

export function dateTimeInputValueToIso(value: string, clientOffsetMs = 0) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);

  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);

  if (hours > 23 || minutes > 59) return '';

  const localDate = new Date(Date.UTC(year, month - 1, day, hours, minutes));

  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() + 1 !== month ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hours ||
    localDate.getUTCMinutes() !== minutes
  ) {
    return '';
  }

  return removeClientOffset(Date.UTC(year, month - 1, day, hours, minutes), clientOffsetMs);
}

export function formatDuration(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function statusLabel(status: string) {
  return status === 'approved' ? '已通过' : status === 'rejected' ? '已驳回' : '待审核';
}

export function notificationLabel(type: string) {
  return type === 'approved'
    ? '审核通过'
    : type === 'rejected'
      ? '审核驳回'
      : type === 'deleted'
        ? '记录删除'
        : '系统通知';
}
