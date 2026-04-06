import type { Context } from 'hono';
import { z } from 'zod';

import type { PublicUser, RecordFilters, RecordStatus, UserRole } from './models';
import { notificationTypes, recordStatuses, userRoles } from './models';
import type { AppBindings } from './plugins/auth';

const positiveIdPattern = /^[1-9]\d*$/;
const uploadPathPattern = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const USER_NAME_MAX_LENGTH = 40;
export const TITLE_MAX_LENGTH = 120;
export const LOCATION_MAX_LENGTH = 120;
export const CONTENT_MAX_LENGTH = 5000;
export const COMMENT_MAX_LENGTH = 500;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 32;
export const UID_MAX_LENGTH = 32;
export const MAX_RECORD_DURATION = 24;

export const userRoleSchema = z.enum(userRoles);
export const recordStatusSchema = z.enum(recordStatuses);
export const notificationTypeSchema = z.enum(notificationTypes);
const requiredPasswordSchema = z
  .string()
  .min(1, '密码不能为空。')
  .max(PASSWORD_MAX_LENGTH, `密码不能超过 ${PASSWORD_MAX_LENGTH} 位。`);
const optionalPasswordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, `密码不能超过 ${PASSWORD_MAX_LENGTH} 位。`);

export const idParamSchema = z.object({
  id: z.string().regex(positiveIdPattern)
});

export const roleQuerySchema = z.object({
  role: userRoleSchema.optional()
});

export const loginBodySchema = z.object({
  uid: z.string().min(1).max(UID_MAX_LENGTH),
  password: requiredPasswordSchema
});

export const profileBodySchema = z.object({
  current_password: requiredPasswordSchema,
  name: z.string().min(1).max(USER_NAME_MAX_LENGTH)
});

export const passwordBodySchema = z.object({
  current_password: requiredPasswordSchema,
  new_password: requiredPasswordSchema
});

export const updateUserBodySchema = z.object({
  name: z.string().min(1).max(USER_NAME_MAX_LENGTH).optional(),
  password: optionalPasswordSchema.optional()
});

export const batchResetPasswordBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1)
});

export const batchDeleteUsersBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1)
});

export const assignmentBodySchema = z.object({
  teacher_id: z.number().int().positive(),
  student_ids: z.array(z.number().int().positive()).min(1)
});

export const createRecordBodySchema = z.object({
  title: z.string().min(1).max(TITLE_MAX_LENGTH),
  content: z.string().min(1).max(CONTENT_MAX_LENGTH),
  practice_date: z.string().min(1).max(10),
  location: z.string().max(LOCATION_MAX_LENGTH).nullable().optional(),
  duration: z.union([z.string().min(1).max(16), z.number()]),
  image_path: z.string().nullable().optional()
});

export const updateRecordBodySchema = z.object({
  title: z.string().min(1).max(TITLE_MAX_LENGTH).optional(),
  content: z.string().min(1).max(CONTENT_MAX_LENGTH).optional(),
  practice_date: z.string().min(1).max(10).optional(),
  location: z.string().max(LOCATION_MAX_LENGTH).nullable().optional(),
  duration: z.union([z.string().min(1).max(16), z.number()]).optional(),
  image_path: z.string().nullable().optional()
});

export const reviewRecordBodySchema = z.object({
  status: recordStatusSchema,
  comment: z.string().max(COMMENT_MAX_LENGTH).optional()
});

export const batchReviewBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  action: z.enum(['approved', 'rejected', 'pending', 'deleted'])
});

export const recordQuerySchema = z.object({
  student_id: z.string().regex(positiveIdPattern).optional(),
  teacher_id: z.string().regex(positiveIdPattern).optional(),
  status: recordStatusSchema.optional(),
  practice_after: z.string().optional(),
  practice_before: z.string().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  updated_after: z.string().optional(),
  updated_before: z.string().optional()
});

export function apiError(c: Context, code: number, message: string) {
  return c.json({ error: message }, code as 400);
}

export function validationHook(result: { success: boolean; error?: { issues?: Array<{ message?: string }> } }, c: Context) {
  if (result.success) {
    return;
  }

  return apiError(c, 400, result.error?.issues?.[0]?.message ?? '请求参数无效。');
}

export function toPublicUser(user: PublicUser) {
  return {
    id: user.id,
    uid: user.uid,
    role: user.role,
    name: user.name,
    password_setup_required: user.password_setup_required
  };
}

export function parsePositiveId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeRequiredString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function validateName(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    return '姓名不能为空。';
  }

  if (trimmed.length > USER_NAME_MAX_LENGTH) {
    return `姓名不能超过 ${USER_NAME_MAX_LENGTH} 个字符。`;
  }

  return null;
}

export function validatePassword(password: string) {
  if (!password) {
    return '密码不能为空。';
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `密码至少需要 ${PASSWORD_MIN_LENGTH} 位。`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `密码不能超过 ${PASSWORD_MAX_LENGTH} 位。`;
  }

  return null;
}

export function validateTitle(title: string) {
  const trimmed = title.trim();

  if (!trimmed) {
    return '标题不能为空。';
  }

  if (trimmed.length > TITLE_MAX_LENGTH) {
    return `标题不能超过 ${TITLE_MAX_LENGTH} 个字符。`;
  }

  return null;
}

export function validateContent(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return '实践内容不能为空。';
  }

  if (trimmed.length > CONTENT_MAX_LENGTH) {
    return `实践内容不能超过 ${CONTENT_MAX_LENGTH} 个字符。`;
  }

  return null;
}

export function validateLocation(location: string | null) {
  if (location && location.length > LOCATION_MAX_LENGTH) {
    return `地点不能超过 ${LOCATION_MAX_LENGTH} 个字符。`;
  }

  return null;
}

export function validateComment(comment: string | null) {
  if (comment && comment.length > COMMENT_MAX_LENGTH) {
    return `评语不能超过 ${COMMENT_MAX_LENGTH} 个字符。`;
  }

  return null;
}

export function isValidUploadPath(value: string) {
  return uploadPathPattern.test(value);
}

export function validatePracticeDate(value: string) {
  if (!dateOnlyPattern.test(value)) {
    return '实践日期格式无效。';
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return '实践日期格式无效。';
  }

  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  if (value > localToday) {
    return '不能记录未来的活动。';
  }

  return null;
}

export function parseDuration(value: unknown) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? Number(trimmed) : Number.NaN;
  }

  return Number.NaN;
}

export function validateDuration(duration: number) {
  if (!Number.isFinite(duration)) {
    return '时长不能为空。';
  }

  if (duration < 0.1) {
    return '时长不能少于 0.1 小时。';
  }

  if (duration > MAX_RECORD_DURATION) {
    return `单条记录时长不能超过 ${MAX_RECORD_DURATION} 小时。`;
  }

  if (!Number.isInteger(duration * 10)) {
    return '时长必须是 0.1 的倍数。';
  }

  return null;
}

export function validateDateTimeInput(value: string) {
  return Number.isFinite(Date.parse(value));
}

export function validateRecordFilters(query: Record<string, unknown>) {
  const dateFields = [
    'practice_after',
    'practice_before',
    'created_after',
    'created_before',
    'updated_after',
    'updated_before'
  ] as const;

  for (const field of dateFields) {
    const value = query[field];

    if (typeof value === 'string' && value && !validateDateTimeInput(value)) {
      return '筛选日期格式无效。';
    }
  }

  return null;
}

export function normalizeRecordFilters(query: RecordFilters): RecordFilters {
  return {
    student_id: query.student_id ?? null,
    teacher_id: query.teacher_id ?? null,
    status: query.status ?? null,
    practice_after: query.practice_after ?? null,
    practice_before: query.practice_before ?? null,
    created_after: query.created_after ?? null,
    created_before: query.created_before ?? null,
    updated_after: query.updated_after ?? null,
    updated_before: query.updated_before ?? null
  };
}

export function requireAuthenticatedUser(c: Context<AppBindings>) {
  const user = c.get('user');

  if (!user) {
    return apiError(c, 401, c.get('authError') ?? '缺少认证令牌。');
  }

  return undefined;
}

export function requireRole(c: Context<AppBindings>, roles: UserRole[]) {
  const authFailure = requireAuthenticatedUser(c);

  if (authFailure) {
    return authFailure;
  }

  if (!roles.includes(c.get('user')!.role)) {
    return apiError(c, 403, '没有权限访问该资源。');
  }

  return undefined;
}

export function buildReviewNotificationMessage(title: string, statusValue: RecordStatus) {
  if (statusValue === 'approved') {
    return `你的实践记录 "${title}" 已被通过。`;
  }

  if (statusValue === 'rejected') {
    return `你的实践记录 "${title}" 已被驳回。`;
  }

  return `你的实践记录 "${title}" 已被退回待审核。`;
}
