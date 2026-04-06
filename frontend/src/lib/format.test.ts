import { expect, test } from 'vitest';

import { formatDate, normalizeDateInputValue } from './format';

test('normalizeDateInputValue returns date-only strings unchanged', () => {
  expect(normalizeDateInputValue('2026-03-28')).toBe('2026-03-28');
});

test('normalizeDateInputValue extracts date from ISO datetime strings', () => {
  expect(normalizeDateInputValue('2026-03-28T08:30:00.000Z')).toBe('2026-03-28');
});

test('normalizeDateInputValue formats Date instances safely', () => {
  expect(normalizeDateInputValue(new Date(2026, 2, 28))).toBe('2026-03-28');
});

test('normalizeDateInputValue rejects unsupported values', () => {
  expect(normalizeDateInputValue({ practice_date: '2026-03-28' })).toBe('');
  expect(normalizeDateInputValue('not-a-date')).toBe('');
});

test('formatDate falls back for invalid values', () => {
  expect(formatDate({ practice_date: '2026-03-28' })).toBe('-');
  expect(formatDate('')).toBe('-');
});
