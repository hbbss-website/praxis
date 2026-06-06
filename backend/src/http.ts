import type { Context } from 'hono';
import { z } from 'zod';

import { appConfig } from './config';
import type { PublicUser, RecordFilters, RecordSort, RecordStatus, UserRole } from './models';
import { MAX_RECORD_IMAGES, notificationTypes, recordStatuses, userRoles } from './models';
import type { AppBindings } from './plugins/auth';
import { getUtcDateString } from './time';

const positiveIdPattern = /^[1-9]\d*$/;
const uploadPathPattern = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const tmpUploadPathPattern = /^\/tmp-uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const USER_NAME_MAX_LENGTH = appConfig.user_name_max_length;
export const TITLE_MAX_LENGTH = appConfig.title_max_length;
export const LOCATION_MAX_LENGTH = appConfig.location_max_length;
export const CONTENT_MAX_LENGTH = appConfig.content_max_length;
export const COMMENT_MAX_LENGTH = appConfig.comment_max_length;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 32;
export const MAX_RECORD_DURATION = appConfig.max_record_duration;

export const userRoleSchema = z.enum(userRoles);
export const recordStatusSchema = z.enum(recordStatuses);
export const recordSortSchema = z.enum(['created_at_desc', 'created_at_asc', 'score_desc', 'score_asc'] satisfies [RecordSort, RecordSort, RecordSort, RecordSort]);
export const notificationTypeSchema = z.enum(notificationTypes);
const passwordEnvelopePattern = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){3}$/;
const requiredPasswordSchema = z
  .string()
  .min(1, '密码不能为空。')
  .max(4096, '密码格式无效。')
  .regex(passwordEnvelopePattern, '密码格式无效。');
const optionalPasswordSchema = z
  .string()
  .max(4096, '密码格式无效。')
  .refine((value) => value === '' || passwordEnvelopePattern.test(value), '密码格式无效。');

export const idParamSchema = z.object({
  id: z.string().regex(positiveIdPattern)
});

export const roleQuerySchema = z.object({
  role: userRoleSchema.optional()
});

export const userSearchQuerySchema = z.object({
  q: z.string().max(64).optional(),
  class_ids: z.string().regex(/^([1-9]\d*)(,[1-9]\d*)*$/).optional(),
  class_id: z.string().regex(positiveIdPattern).optional()
});

export const loginBodySchema = z.object({
  uid: z.string().min(1).max(32),
  password: requiredPasswordSchema
});

export const studentUidLoginBodySchema = z.object({
  uid: z.number().int().positive(),
  password: requiredPasswordSchema
});

export const studentNameLoginBodySchema = z.object({
  class_id: z.number().int().positive(),
  name: z.string().min(1).max(USER_NAME_MAX_LENGTH),
  password: requiredPasswordSchema
});

export const staffLoginBodySchema = z.object({
  identifier: z.string().min(1).max(64),
  password: requiredPasswordSchema
});

export const loginSelectionBodySchema = z.object({
  challenge: z.string().min(16).max(128),
  uid: z.number().int().positive()
});

export const classSearchQuerySchema = z.object({
  q: z.string().max(64).optional()
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
  english_name: z.string().max(USER_NAME_MAX_LENGTH).nullable().optional(),
  password: optionalPasswordSchema.optional(),
  class_id: z.number().int().positive().nullable().optional()
});

export const batchResetPasswordBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1)
});

export const batchUpdateStudentClassBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  class_id: z.number().int().positive().nullable()
});

export const batchDeleteUsersBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1)
});

export const createRecordBodySchema = z.object({
  task_id: z.number().int().positive().optional(),
  title: z.string().min(1).max(TITLE_MAX_LENGTH),
  content: z.string().min(1).max(CONTENT_MAX_LENGTH),
  practice_date: z.string().min(1).max(10),
  location: z.string().max(LOCATION_MAX_LENGTH).nullable().optional(),
  duration: z.union([z.string().min(1).max(16), z.number()]),
  image_paths: z.array(z.string()).max(MAX_RECORD_IMAGES).optional(),
  cover_image_path: z.string().nullable().optional()
});

export const updateRecordBodySchema = z.object({
  title: z.string().min(1).max(TITLE_MAX_LENGTH).optional(),
  content: z.string().min(1).max(CONTENT_MAX_LENGTH).optional(),
  practice_date: z.string().min(1).max(10).optional(),
  location: z.string().max(LOCATION_MAX_LENGTH).nullable().optional(),
  duration: z.union([z.string().min(1).max(16), z.number()]).optional(),
  image_paths: z.array(z.string()).max(MAX_RECORD_IMAGES).optional(),
  cover_image_path: z.string().nullable().optional()
});

export const reviewRecordBodySchema = z.object({
  status: recordStatusSchema,
  comment: z.string().max(COMMENT_MAX_LENGTH).optional(),
  score: z.number().int().min(0).max(100).optional()
});

export const batchReviewBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  action: z.enum(['approved', 'rejected', 'pending', 'deleted'])
});

export const recordQuerySchema = z.object({
  task_id: z.string().regex(positiveIdPattern).optional(),
  student_id: z.string().regex(positiveIdPattern).optional(),
  student_ids: z.string().optional(),
  class_id: z.string().regex(positiveIdPattern).optional(),
  class_ids: z.string().optional(),
  status: recordStatusSchema.optional(),
  sort: recordSortSchema.optional(),
  practice_after: z.string().optional(),
  practice_before: z.string().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional()
});

export const createTaskBodySchema = z.object({
  title: z.string().min(1).max(TITLE_MAX_LENGTH),
  description: z.string().max(CONTENT_MAX_LENGTH).nullable().optional(),
  start_at: z.string().min(1).max(40),
  end_at: z.string().min(1).max(40),
  min_words: z.number().int().min(0).max(CONTENT_MAX_LENGTH),
  min_images: z.number().int().min(0).max(MAX_RECORD_IMAGES),
  max_records_per_student: z.number().int().min(1).max(100),
  score_enabled: z.boolean(),
  class_ids: z.array(z.number().int().positive()).min(1)
});

export const updateTaskBodySchema = createTaskBodySchema.omit({ score_enabled: true }).partial().extend({
  class_ids: z.array(z.number().int().positive()).min(1).optional()
});

export const classIdsBodySchema = z.object({
  class_ids: z.array(z.number().int().positive()).min(1)
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
    english_name: user.english_name,
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

export function validateEnglishName(name: string | null | undefined) {
  const trimmed = name?.trim() ?? '';

  if (!trimmed) {
    return null;
  }

  if (trimmed.length > USER_NAME_MAX_LENGTH) {
    return `英文名不能超过 ${USER_NAME_MAX_LENGTH} 个字符。`;
  }

  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return '英文名不能包含控制字符。';
  }

  return null;
}

export function validatePassword(password: string) {
  if (!password) {
    return '密码不能为空。';
  }

  if (!appConfig.is_production) {
    return null;
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `密码至少需要 ${PASSWORD_MIN_LENGTH} 位。`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `密码不能超过 ${PASSWORD_MAX_LENGTH} 位。`;
  }

  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[!-/:-@[-`{-~]/.test(password)) {
    return '密码必须包含大写字母、小写字母、数字和特殊符号。';
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

export function isValidTmpUploadPath(value: string) {
  return tmpUploadPathPattern.test(value);
}

export function isValidRecordImagePath(value: string) {
  return isValidTmpUploadPath(value) || isValidUploadPath(value);
}

export function validatePracticeDate(value: string) {
  if (!dateOnlyPattern.test(value)) {
    return '实践日期格式无效。';
  }

  const parts = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

  if (
    parsed.getUTCFullYear() !== parts[0] ||
    parsed.getUTCMonth() + 1 !== parts[1] ||
    parsed.getUTCDate() !== parts[2]
  ) {
    return '实践日期格式无效。';
  }

  const today = getUtcDateString();

  if (value > today) {
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
  return parseDateTimeInput(value) !== null;
}

export function parseDateTimeInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const iso = new Date(timestamp).toISOString();
  return iso === value ? iso : null;
}

export function validateTaskTitle(title: string) {
  return validateTitle(title);
}

export function validateTaskDescription(description: string | null) {
  if (description && description.length > CONTENT_MAX_LENGTH) {
    return `任务说明不能超过 ${CONTENT_MAX_LENGTH} 个字符。`;
  }

  return null;
}

export function validateRecordFilters(query: Record<string, unknown>) {
  for (const field of ['practice_after', 'practice_before'] as const) {
    const value = query[field];

    if (typeof value === 'string' && value && !dateOnlyPattern.test(value)) {
      return '筛选日期格式无效。';
    }
  }

  for (const field of ['created_after', 'created_before'] as const) {
    const value = query[field];

    if (typeof value === 'string' && value && !validateDateTimeInput(value)) {
      return '筛选日期格式无效。';
    }
  }

  for (const field of ['student_ids', 'class_ids'] as const) {
    const value = query[field];

    if (typeof value === 'string' && value) {
      const values = value.split(',');

      if (values.some((item) => !positiveIdPattern.test(item))) {
        return field === 'student_ids' ? '筛选学生无效。' : '筛选班级无效。';
      }
    }
  }

  return null;
}

export function normalizeRecordFilters(query: RecordFilters): RecordFilters {
  return {
    task_id: query.task_id ?? null,
    student_id: query.student_id ?? null,
    student_ids: query.student_ids ?? null,
    class_id: query.class_id ?? null,
    class_ids: query.class_ids ?? null,
    status: query.status ?? null,
    practice_after: query.practice_after ?? null,
    practice_before: query.practice_before ?? null,
    created_after: query.created_after ?? null,
    created_before: query.created_before ?? null
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
