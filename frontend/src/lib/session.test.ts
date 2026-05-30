// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import {
  clearPasswordSetupCurrentPassword,
  getAccountPathByRole,
  getDefaultPathByRole,
  getPasswordSetupCurrentPassword,
  getPasswordSetupPath,
  storePasswordSetupCurrentPassword
} from './session';

afterEach(() => {
  sessionStorage.clear();
});

describe('password setup helpers', () => {
  test('getPasswordSetupPath returns /setup-password', () => {
    expect(getPasswordSetupPath()).toBe('/setup-password');
  });

  test('store/retrieve/clear password setup current password', () => {
    expect(getPasswordSetupCurrentPassword()).toBeNull();
    storePasswordSetupCurrentPassword('my-password');
    expect(getPasswordSetupCurrentPassword()).toBe('my-password');
    clearPasswordSetupCurrentPassword();
    expect(getPasswordSetupCurrentPassword()).toBeNull();
  });

  test('overwrites existing password', () => {
    storePasswordSetupCurrentPassword('first');
    storePasswordSetupCurrentPassword('second');
    expect(getPasswordSetupCurrentPassword()).toBe('second');
  });
});

describe('getAccountPathByRole', () => {
  test('returns admin path', () => {
    expect(getAccountPathByRole('admin')).toBe('/admin/account');
  });

  test('returns teacher path', () => {
    expect(getAccountPathByRole('teacher')).toBe('/teacher/account');
  });

  test('returns student path', () => {
    expect(getAccountPathByRole('student')).toBe('/student/account');
  });
});

describe('getDefaultPathByRole', () => {
  test('redirects to password setup when required', () => {
    expect(getDefaultPathByRole('admin', true)).toBe('/setup-password');
    expect(getDefaultPathByRole('teacher', true)).toBe('/setup-password');
    expect(getDefaultPathByRole('student', true)).toBe('/setup-password');
  });

  test('returns dashboard for admin', () => {
    expect(getDefaultPathByRole('admin')).toBe('/admin/dashboard');
  });

  test('returns dashboard for teacher', () => {
    expect(getDefaultPathByRole('teacher')).toBe('/teacher/dashboard');
  });

  test('returns dashboard for student', () => {
    expect(getDefaultPathByRole('student')).toBe('/student/dashboard');
  });
});
