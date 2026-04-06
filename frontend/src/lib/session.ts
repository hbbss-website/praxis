import type { StoredUser, UserRole } from './types';

const tokenStorageKey = 'auth.token';
const userStorageKey = 'auth.user';
const passwordSetupCurrentPasswordStorageKey = 'auth.password-setup-current-password';
const passwordSetupPath = '/setup-password';

export function getToken() {
  return sessionStorage.getItem(tokenStorageKey);
}

export function getPasswordSetupPath() {
  return passwordSetupPath;
}

export function getPasswordSetupCurrentPassword() {
  return sessionStorage.getItem(passwordSetupCurrentPasswordStorageKey);
}

export function getStoredUser(): StoredUser | null {
  const rawUser = sessionStorage.getItem(userStorageKey);
  if (!rawUser) return null;

  try {
    const user = JSON.parse(rawUser) as Partial<StoredUser>;
    if (
      typeof user.id !== 'number' ||
      typeof user.uid !== 'string' ||
      typeof user.name !== 'string' ||
      (user.password_setup_required !== undefined && typeof user.password_setup_required !== 'boolean') ||
      (user.role !== 'admin' && user.role !== 'teacher' && user.role !== 'student')
    ) {
      return null;
    }

    return {
      ...user,
      password_setup_required: user.password_setup_required ?? false
    } as StoredUser;
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: StoredUser, passwordSetupCurrentPassword?: string | null) {
  sessionStorage.setItem(tokenStorageKey, token);
  sessionStorage.setItem(userStorageKey, JSON.stringify(user));

  if (passwordSetupCurrentPassword) {
    sessionStorage.setItem(passwordSetupCurrentPasswordStorageKey, passwordSetupCurrentPassword);
    return;
  }

  sessionStorage.removeItem(passwordSetupCurrentPasswordStorageKey);
}

export function clearSession() {
  sessionStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(userStorageKey);
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
  if (passwordSetupRequired) {
    return getPasswordSetupPath();
  }

  return role === 'admin'
    ? '/admin/records'
    : role === 'teacher'
      ? '/teacher/dashboard'
      : '/student/dashboard';
}
