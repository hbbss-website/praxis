import { hc } from 'hono/client';

import type { Api } from '../../../backend/src/app';
import { API_URL, type CreatedUser, type CsvImportPreview, type StoredUser, type UploadResult, type UserRole } from './types';

export class ApiResponseError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ApiResult = Promise<{ data: unknown; error: unknown; status: number }>;

const uploadImageMaxSize = 5 * 1024 * 1024;
const uploadImageTypes = new Set(['image/jpeg', 'image/png', 'image/gif']);
const uploadImageNamePattern = /\.(jpe?g|png|gif)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeErrorText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed === '[object Object]') {
    return null;
  }

  return trimmed;
}

function extractErrorMessage(error: unknown): string | null {
  const directText = normalizeErrorText(error);

  if (directText) {
    return directText;
  }

  if (error instanceof Error) {
    const nestedValueMessage = extractErrorMessage((error as Error & { value?: unknown }).value);

    if (nestedValueMessage) {
      return nestedValueMessage;
    }

    return normalizeErrorText(error.message);
  }

  if (Array.isArray(error)) {
    for (const item of error) {
      const message = extractErrorMessage(item);

      if (message) {
        return message;
      }
    }

    return null;
  }

  if (!isRecord(error)) {
    return null;
  }

  const keys = ['error', 'message', 'value', 'cause'] as const;

  for (const key of keys) {
    const message = extractErrorMessage(error[key]);

    if (message) {
      return message;
    }
  }

  if (Array.isArray(error.errors)) {
    for (const item of error.errors) {
      const message = extractErrorMessage(item);

      if (message) {
        return message;
      }
    }
  }

  return null;
}

function wrapRpcResponse(responsePromise: Promise<Response>): ApiResult {
  return responsePromise
    .then(async (response) => {
      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text().catch(() => null);

      if (!response.ok) {
        return {
          data: null,
          error: payload ?? { error: '请求失败。' },
          status: response.status
        };
      }

      return {
        data: payload,
        error: null,
        status: response.status
      };
    })
    .catch((error) => ({
      data: null,
      error,
      status: 0
    }));
}

function toPathParam(value: number | string) {
  return String(value);
}

export function getApiOrigin() {
  const apiBase = API_URL.replace(/\/api$/, '');

  if (/^https?:\/\//.test(apiBase)) {
    return apiBase;
  }

  if (typeof window !== 'undefined') {
    return apiBase ? new URL(apiBase, window.location.origin).toString().replace(/\/$/, '') : window.location.origin;
  }

  return apiBase ? `http://localhost${apiBase}` : 'http://localhost';
}

function createRpcClient(token?: string | null) {
  return hc<Api>(`${getApiOrigin()}/api`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

export function createApiClient(token?: string | null) {
  const client = createRpcClient(token);

  const adminUserRoute = ({ id }: { id: number }) => ({
    put: (body?: any) =>
      wrapRpcResponse(client.admin.users[':id'].$put({
        param: { id: toPathParam(id) },
        json: body
      })),
    delete: () =>
      wrapRpcResponse(client.admin.users[':id'].$delete({
        param: { id: toPathParam(id) }
      }))
  });

  const studentRecordRoute = ({ id }: { id: number }) => ({
    put: (body?: any) =>
      wrapRpcResponse(client.students.me.records[':id'].$put({
        param: { id: toPathParam(id) },
        json: body
      })),
    delete: () =>
      wrapRpcResponse(client.students.me.records[':id'].$delete({
        param: { id: toPathParam(id) }
      }))
  });

  const teacherRecordRoute = ({ id }: { id: number }) => ({
    get: () =>
      wrapRpcResponse(client.teacher.records[':id'].$get({
        param: { id: toPathParam(id) }
      })),
    put: (body?: any) =>
      wrapRpcResponse(client.teacher.records[':id'].$put({
        param: { id: toPathParam(id) },
        json: body
      })),
    delete: () =>
      wrapRpcResponse(client.teacher.records[':id'].$delete({
        param: { id: toPathParam(id) }
      })),
    review: {
      put: (body?: any) =>
        wrapRpcResponse(client.teacher.records[':id'].review.$put({
          param: { id: toPathParam(id) },
          json: body
        }))
    }
  });

  const teacherStudentRoute = ({ id }: { id: number }) => ({
    put: (body?: any) =>
      wrapRpcResponse(client.teacher.students[':id'].$put({
        param: { id: toPathParam(id) },
        json: body
      })),
    records: {
      get: () =>
        wrapRpcResponse(client.teacher.students[':id'].records.$get({
          param: { id: toPathParam(id) }
        }))
    }
  });

  return {
    auth: {
      login: {
        post: (body?: any) => wrapRpcResponse(client.auth.login.$post({ json: body }))
      },
      me: {
        get: () => wrapRpcResponse(client.auth.me.$get())
      },
      password: {
        put: (body?: any) => wrapRpcResponse(client.auth.password.$put({ json: body }))
      },
      profile: {
        put: (body?: any) => wrapRpcResponse(client.auth.profile.$put({ json: body }))
      }
    },
    upload: {
      post: ({ image }: { image: File }): ApiResult =>
        wrapRpcResponse(client.uploads.$post({
          form: { image }
        }))
    },
    admin: {
      users: Object.assign(adminUserRoute, {
        get: ({ query }: { query?: { role?: UserRole } } = {}) =>
          wrapRpcResponse(query ? client.admin.users.$get({ query }) : client.admin.users.$get({ query: {} })),
        post: (body?: any) => wrapRpcResponse(client.admin.users.$post({ json: body })),
        delete: (body?: any) => wrapRpcResponse(client.admin.users.$delete({ json: body })),
        batch: {
          post: (body?: any) => wrapRpcResponse(client.admin.users.batch.$post({ json: body }))
        },
        import: {
          post: ({ file }: { file: File }): ApiResult =>
            wrapRpcResponse(client.admin.users.import.$post({
              form: { file }
            })),
          preview: {
            post: ({ file }: { file: File }): ApiResult =>
              wrapRpcResponse(client.admin.users.import.preview.$post({
                form: { file }
              }))
          }
        },
        password: {
          patch: (body?: any) => wrapRpcResponse(client.admin.users['password-reset'].$patch({ json: body }))
        }
      }),
      assignments: {
        get: () => wrapRpcResponse(client.admin['teacher-student-assignments'].$get()),
        post: ({ teacher_id, student_ids }: { teacher_id: number; student_ids: number[] }) =>
          wrapRpcResponse(client.admin.teachers[':teacherId'].students.$put({
            param: { teacherId: toPathParam(teacher_id) },
            json: { student_ids }
          })),
        delete: ({ teacher_id, student_ids }: { teacher_id: number; student_ids: number[] }) =>
          wrapRpcResponse(client.admin.teachers[':teacherId'].students.$delete({
            param: { teacherId: toPathParam(teacher_id) },
            json: { student_ids }
          }))
      }
    },
    student: {
      records: Object.assign(studentRecordRoute, {
        get: () => wrapRpcResponse(client.students.me.records.$get()),
        post: (body?: any) => wrapRpcResponse(client.students.me.records.$post({ json: body }))
      }),
      notifications: {
        get: () => wrapRpcResponse(client.students.me.notifications.$get()),
        read: {
          post: () => wrapRpcResponse(client.students.me.notifications['read-status'].$post())
        }
      }
    },
    teacher: {
      records: Object.assign(teacherRecordRoute, {
        get: ({ query }: { query?: Record<string, string | number | undefined> } = {}) =>
          wrapRpcResponse(query ? client.teacher.records.$get({ query: query as Record<string, string> }) : client.teacher.records.$get({ query: {} })),
        ['batch-review']: {
          post: (body?: any) => wrapRpcResponse(client.teacher['record-reviews'].batch.$post({ json: body }))
        }
      }),
      students: Object.assign(teacherStudentRoute, {
        get: () => wrapRpcResponse(client.teacher.students.$get()),
        password: {
          patch: (body?: any) => wrapRpcResponse(client.teacher.students['password-reset'].$patch({ json: body }))
        }
      }),
      statistics: {
        get: () => wrapRpcResponse(client.teacher.statistics.$get())
      }
    }
  };
}

export async function unwrapResponse<T>(requestPromise: ApiResult): Promise<T> {
  const response = await requestPromise;

  if (response.error) {
    const message = extractErrorMessage(response.error) ?? '请求失败。';

    throw new ApiResponseError(response.status, message);
  }

  return response.data as T;
}

export async function login(uid: string, password: string): Promise<{ token: string; user: StoredUser }> {
  const api = createApiClient();
  return unwrapResponse(api.auth.login.post({ uid, password }));
}

export function validateUploadImageFile(file: File) {
  if (file.size > uploadImageMaxSize) {
    throw new Error('图片大小不能超过 5 MiB。');
  }

  if (uploadImageTypes.has(file.type) || (!file.type && uploadImageNamePattern.test(file.name))) {
    return;
  }

  throw new Error('仅支持上传 JPG、PNG、GIF 格式的图片。');
}

export async function uploadImage(file: File, token: string): Promise<UploadResult> {
  validateUploadImageFile(file);
  const api = createApiClient(token);
  return unwrapResponse(api.upload.post({ image: file }));
}

export async function importUserCsv(file: File, token: string): Promise<{ message: string; encoding: CsvImportPreview['encoding']; users: CreatedUser[] }> {
  const api = createApiClient(token);
  return unwrapResponse(api.admin.users.import.post({ file }));
}
