import { expect, test } from 'vitest';

import { fromLocalMinute, toLocalMinute } from './task-form';

test('task datetime form values preserve local minutes', () => {
  expect(toLocalMinute('2026-03-28T08:30:00.000Z', 8 * 60 * 60 * 1000)).toBe('2026-03-28T16:30');
  expect(fromLocalMinute('2026-03-28T16:30', 8 * 60 * 60 * 1000)).toBe('2026-03-28T08:30:00.000Z');
  expect(toLocalMinute('2026-03-28T08:30:00.000Z', -5 * 60 * 60 * 1000)).toBe('2026-03-28T03:30');
  expect(fromLocalMinute('2026-03-28T03:30', -5 * 60 * 60 * 1000)).toBe('2026-03-28T08:30:00.000Z');
});
