export const API_URL = 'http://localhost:3000/api';
const tokenStorageKey = 'auth.token';
const userStorageKey = 'auth.user';

export type UserRole = 'admin' | 'teacher' | 'student';

export interface StoredUser {
  id: number;
  uid: string;
  role: UserRole;
  name: string;
}

export interface ApiError {
  error?: string;
}

export function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export function getStoredUser(): StoredUser | null {
  const rawUser = sessionStorage.getItem(userStorageKey);
  if (!rawUser) return null;

  try {
    const user = JSON.parse(rawUser) as Partial<StoredUser>;
    if (
      typeof user.id !== 'number' ||
      typeof user.uid !== 'string' ||
      (user.role !== 'student' && user.role !== 'teacher' && user.role !== 'admin') ||
      typeof user.name !== 'string'
    ) return null;
    return { id: user.id, uid: user.uid, role: user.role, name: user.name };
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(tokenStorageKey);
}

export function storeSession(token: string, user: StoredUser): void {
  sessionStorage.setItem(tokenStorageKey, token);
  sessionStorage.setItem(userStorageKey, JSON.stringify(user));
}

export function clearSession(): void {
  sessionStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(userStorageKey);
}

export function logout(redirectPath: string): void {
  clearSession();
  window.location.href = redirectPath;
}

export function redirectByRole(role: UserRole): void {
  const paths: Record<UserRole, string> = {
    admin: 'admin/records.html',
    teacher: 'teacher/dashboard.html',
    student: 'student/dashboard.html'
  };
  window.location.href = paths[role];
}

export function requireRole(
  expectedRole: UserRole,
  loginPath: string
): { token: string; user: StoredUser } | null {
  const token = getToken();
  const user = getStoredUser();

  if (!token || !user) { logout(loginPath); return null; }

  // Admin can access teacher pages
  if (user.role !== expectedRole && !(expectedRole === 'teacher' && user.role === 'admin')) {
    logout(loginPath);
    return null;
  }

  return { token, user };
}

export function escapeHtml(value: string | null | undefined): string {
  if (!value) return '';
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

export function formatDate(value: string | null | undefined, fallback = ''): string {
  if (!value) return fallback;
  return new Date(value).toLocaleDateString('sv-SE');
}

export function formatDateTime(value: string | null | undefined, fallback = '-'): string {
  if (!value) return fallback;
  return new Date(value).toLocaleString('sv-SE');
}

export function getApiOrigin(): string {
  return API_URL.replace(/\/api$/, '');
}

export async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

export async function updateNotificationBadge(token: string): Promise<void> {
  const badge = document.querySelector<HTMLElement>('#nav-notification-badge');
  if (!badge) return;

  try {
    const response = await fetch(`${API_URL}/student/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return;

    const data = await readJson<{ unreadCount: number }>(response);
    if (data && data.unreadCount > 0) {
      badge.textContent = String(data.unreadCount);
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  } catch (error) {
    console.error('Failed to load notification count', error);
  }
}
