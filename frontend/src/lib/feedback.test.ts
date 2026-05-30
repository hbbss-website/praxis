// @vitest-environment node
import { expect, test } from 'vitest';
import { getErrorMessage } from './feedback';

test('getErrorMessage extracts message from Error instance', () => {
  expect(getErrorMessage(new Error('错误信息'))).toBe('错误信息');
});

test('getErrorMessage returns fallback for non-Error input', () => {
  expect(getErrorMessage('string')).toBe('操作失败。');
});

test('getErrorMessage returns fallback for undefined', () => {
  expect(getErrorMessage(undefined)).toBe('操作失败。');
});

test('getErrorMessage returns custom fallback', () => {
  expect(getErrorMessage(null, '自定义错误')).toBe('自定义错误');
});

test('getErrorMessage returns empty string message from Error', () => {
  expect(getErrorMessage(new Error(''))).toBe('操作失败。');
});
