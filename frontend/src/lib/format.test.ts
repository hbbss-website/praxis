// @vitest-environment node
import { expect, test, vi } from 'vitest';

import { dateTimeInputValueToIso, formatDate, formatDateTime, formatDateTimeInputValue, formatDuration, getServerNowIso, getServerUtcDateInputValue, localDateBoundaryIso, normalizeDateInputValue, notificationLabel, statusLabel } from './format';

test('normalizeDateInputValue returns date-only strings unchanged', () => {
  expect(normalizeDateInputValue('2026-03-28')).toBe('2026-03-28');
});

test('normalizeDateInputValue extracts UTC date from ISO datetime strings', () => {
  expect(normalizeDateInputValue('2026-03-28T08:30:00.000Z')).toBe('2026-03-28');
});

test('normalizeDateInputValue formats Date instances safely', () => {
  expect(normalizeDateInputValue(new Date(Date.UTC(2026, 2, 28)))).toBe('2026-03-28');
});

test('normalizeDateInputValue handles timestamp numbers', () => {
  const date = new Date(Date.UTC(2026, 2, 10));
  expect(normalizeDateInputValue(date.getTime())).toBe('2026-03-10');
});

test('normalizeDateInputValue rejects unsupported values', () => {
  expect(normalizeDateInputValue({ practice_date: '2026-03-28' })).toBe('');
  expect(normalizeDateInputValue('2026-02-31')).toBe('');
  expect(normalizeDateInputValue('not-a-date')).toBe('');
  expect(normalizeDateInputValue(null)).toBe('');
  expect(normalizeDateInputValue(undefined)).toBe('');
});

test('formatDate falls back for invalid values', () => {
  expect(formatDate({ practice_date: '2026-03-28' })).toBe('-');
  expect(formatDate('')).toBe('-');
  expect(formatDate(null)).toBe('-');
  expect(formatDate(undefined)).toBe('-');
});

test('formatDate returns formatted string for valid input', () => {
  expect(formatDate('2026-03-28')).toBe('2026-03-28');
});

test('localDateBoundaryIso subtracts client offset from selected date boundaries', () => {
  expect(localDateBoundaryIso('2026-03-28', 'start', 8 * 60 * 60 * 1000)).toBe('2026-03-27T16:00:00.000Z');
  expect(localDateBoundaryIso('2026-03-28', 'end', 8 * 60 * 60 * 1000)).toBe('2026-03-28T15:59:59.999Z');
  expect(localDateBoundaryIso('2026-03-28', 'start', -5 * 60 * 60 * 1000)).toBe('2026-03-28T05:00:00.000Z');
  expect(localDateBoundaryIso('not-a-date', 'start')).toBe('');
});

test('formatDateTime returns fallback for null/empty', () => {
  expect(formatDateTime(null)).toBe('-');
  expect(formatDateTime('')).toBe('-');
  expect(formatDateTime(undefined)).toBe('-');
});

test('formatDateTime formats ISO string with client offset to minutes', () => {
  expect(formatDateTime('2026-03-28T08:30:00.000Z', '-', 8 * 60 * 60 * 1000)).toBe('2026-03-28 16:30');
  expect(formatDateTime('2026-03-28T08:30:00.000Z', '-', -5 * 60 * 60 * 1000)).toBe('2026-03-28 03:30');
});

test('datetime input helpers use client offset', () => {
  expect(formatDateTimeInputValue('2026-03-28T08:30:00.000Z', 8 * 60 * 60 * 1000)).toBe('2026-03-28T16:30');
  expect(formatDateTimeInputValue('2026-03-28T08:30:00.000Z', -5 * 60 * 60 * 1000)).toBe('2026-03-28T03:30');
  expect(dateTimeInputValueToIso('2026-03-28T16:30', 8 * 60 * 60 * 1000)).toBe('2026-03-28T08:30:00.000Z');
  expect(dateTimeInputValueToIso('2026-03-28T03:30', -5 * 60 * 60 * 1000)).toBe('2026-03-28T08:30:00.000Z');
  expect(dateTimeInputValueToIso('2026-02-31T16:30', 8 * 60 * 60 * 1000)).toBe('');
});

test('server now helpers subtract client offset', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-28T08:30:00.000Z'));

  try {
    expect(getServerNowIso(8 * 60 * 60 * 1000)).toBe('2026-03-28T00:30:00.000Z');
    expect(getServerUtcDateInputValue(9 * 60 * 60 * 1000)).toBe('2026-03-27');
  } finally {
    vi.useRealTimers();
  }
});

test('formatDuration handles various inputs', () => {
  expect(formatDuration(2)).toBe('2');
  expect(formatDuration(2.5)).toBe('2.5');
  expect(formatDuration(null)).toBe('0');
  expect(formatDuration(undefined)).toBe('0');
  expect(formatDuration(NaN)).toBe('0');
});

test('statusLabel returns Chinese labels', () => {
  expect(statusLabel('approved')).toBe('已通过');
  expect(statusLabel('rejected')).toBe('已驳回');
  expect(statusLabel('pending')).toBe('待审核');
});

test('notificationLabel returns Chinese labels', () => {
  expect(notificationLabel('approved')).toBe('审核通过');
  expect(notificationLabel('rejected')).toBe('审核驳回');
  expect(notificationLabel('deleted')).toBe('记录删除');
  expect(notificationLabel('unknown')).toBe('系统通知');
});
