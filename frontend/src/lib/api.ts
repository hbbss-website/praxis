import { API_URL, type CsvImportPreview, type StoredUser, type UploadResult } from './types';

export class ApiResponseError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });
  const data = await readJson<{ error?: string } & T>(response);

  if (!response.ok) {
    throw new ApiResponseError(response.status, data?.error ?? '请求失败。');
  }

  return (data ?? {}) as T;
}

export async function login(uid: string, password: string) {
  return apiRequest<{ token: string; user: StoredUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ uid, password })
  });
}

export async function uploadImage(file: File, token: string) {
  const formData = new FormData();
  formData.append('image', file);
  return apiRequest<UploadResult>('/upload', { method: 'POST', body: formData }, token);
}

export async function previewUserImportCsv(file: File, token: string) {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest<CsvImportPreview>('/admin/users/import/preview', { method: 'POST', body: formData }, token);
}

export function getApiOrigin() {
  return API_URL.replace(/\/api$/, '');
}
