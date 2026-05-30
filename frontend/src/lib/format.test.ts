// @vitest-environment node
import { expect, test } from 'vitest';

import { formatDate, formatDateTime, formatDuration, normalizeDateInputValue, notificationLabel, statusLabel } from './format';

test('normalizeDateInputValue returns date-only strings unchanged', () => {
  expect(normalizeDateInputValue('2026-03-28')).toBe('2026-03-28');
});

test('normalizeDateInputValue extracts date from ISO datetime strings', () => {
  expect(normalizeDateInputValue('2026-03-28T08:30:00.000Z')).toBe('2026-03-28');
});

test('normalizeDateInputValue formats Date instances safely', () => {
  expect(normalizeDateInputValue(new Date(2026, 2, 28))).toBe('2026-03-28');
});

test('normalizeDateInputValue handles timestamp numbers', () => {
  const date = new Date(2026, 2, 10);
  expect(normalizeDateInputValue(date.getTime())).toBe('2026-03-10');
});

test('normalizeDateInputValue rejects unsupported values', () => {
  expect(normalizeDateInputValue({ practice_date: '2026-03-28' })).toBe('');
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

test('formatDateTime returns fallback for null/empty', () => {
  expect(formatDateTime(null)).toBe('-');
  expect(formatDateTime('')).toBe('-');
  expect(formatDateTime(undefined)).toBe('-');
});

test('formatDateTime formats ISO string', () => {
  const result = formatDateTime('2026-03-28T08:30:00.000Z');
  expect(result).not.toBe('-');
  expect(result).toContain('2026');
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
