import type { UserRole } from './types';

const passwordSetupCurrentPasswordStorageKey = 'auth.password-setup-current-password';
const passwordSetupPath = '/setup-password';

export function getPasswordSetupPath() {
  return passwordSetupPath;
}

export function getPasswordSetupCurrentPassword() {
  return sessionStorage.getItem(passwordSetupCurrentPasswordStorageKey);
}

export function storePasswordSetupCurrentPassword(password: string) {
  sessionStorage.setItem(passwordSetupCurrentPasswordStorageKey, password);
}

export function clearPasswordSetupCurrentPassword() {
  sessionStorage.removeItem(passwordSetupCurrentPasswordStorageKey);
}

export function getAccountPathByRole(role: UserRole) {
  return role === 'admin'
    ? '/admin/account'
    : role === 'teacher'
      ? '/teacher/account'
      : '/student/account';
}

export function getDefaultPathByRole(role: UserRole, passwordSetupRequired = false) {
  if (passwordSetupRequired) return getPasswordSetupPath();
  return role === 'admin'
    ? '/admin/dashboard'
    : role === 'teacher'
      ? '/teacher/dashboard'
      : '/student/dashboard';
}
