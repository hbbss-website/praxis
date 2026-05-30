// @vitest-environment node
import { expect, test } from 'vitest';
import { cn } from './utils';

test('cn merges class strings', () => {
  expect(cn('foo', 'bar')).toBe('foo bar');
});

test('cn filters falsy values', () => {
  expect(cn('foo', false && 'bar', undefined, null, 'baz')).toBe('foo baz');
});

test('cn handles conditional objects', () => {
  expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
});

test('cn handles tailwind-merge conflicts', () => {
  expect(cn('px-2', 'px-4')).toBe('px-4');
  expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
});
