import crypto from 'node:crypto';

import { and, eq, getTableColumns, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { appConfig } from '../config';
import type { PracticeRecord, PracticeTask, RecordFilters, User, UserRole, UserSummary } from '../models';
import { MAX_RECORD_IMAGES, userRoles } from '../models';
import { db } from './client';
import { classes, classStudents, notifications, practiceRecords, practiceTasks, users, tempUploadDeletions } from './schema';

export const deletedUserName = '已删除用户';
export const uploadPathPattern = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const tmpUploadPathPattern = /^\/tmp-uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const rolePrefixes: Record<UserRole, string> = {
  admin: 'A',
  teacher: 'T',
  student: 'S'
};

type UserRow = typeof users.$inferSelect;
type ClassRow = typeof classes.$inferSelect;
type PracticeTaskRow = typeof practiceTasks.$inferSelect;

export const practiceRecordColumns = getTableColumns(practiceRecords);
export const practiceTaskColumns = getTableColumns(practiceTasks);

export function nowIso() {
  return new Date().toISOString();
}

export function generatePlainPassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(appConfig.generated_password_length);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    uid: row.uid,
    password: row.password,
    role: row.role as UserRole,
    name: row.name,
    created_at: row.createdAt
  };
}

export function toPracticeRecord(row: typeof practiceRecords.$inferSelect): PracticeRecord {
  const imagePaths = normalizeRecordImagePaths(row.imagePaths);

  return {
    id: row.id,
    task_id: row.taskId,
    student_id: row.studentId,
    student_uid_snapshot: row.studentUidSnapshot,
    title: row.title,
    content: row.content,
    practice_date: row.practiceDate,
    location: row.location,
    duration: row.duration,
    image_paths: imagePaths,
    cover_image_path: row.coverImagePath && imagePaths.includes(row.coverImagePath) ? row.coverImagePath : imagePaths[0] ?? null,
    status: row.status as PracticeRecord['status'],
    teacher_comment: row.teacherComment,
    created_at: row.createdAt
  };
}

export function toPracticeTask(row: PracticeTaskRow): PracticeTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    start_at: row.startAt,
    end_at: row.endAt,
    min_words: row.minWords,
    min_images: row.minImages,
    max_records_per_student: row.maxRecordsPerStudent,
    created_by_id: row.createdById,
    created_at: row.createdAt
  };
}

export function toStudentSummary(row: Pick<UserRow, 'id' | 'uid' | 'name' | 'createdAt'>) {
  return {
    id: row.id,
    uid: row.uid,
    name: row.name,
    created_at: row.createdAt
  };
}

export function toUserSummary(row: Pick<UserRow, 'id' | 'uid' | 'role' | 'name' | 'createdAt'>): UserSummary {
  return {
    id: row.id,
    uid: row.uid,
    role: row.role as UserRole,
    name: row.name,
    created_at: row.createdAt
  };
}

export function toClassSummary(row: Pick<ClassRow, 'id' | 'cid' | 'name' | 'createdAt'>) {
  return {
    id: row.id,
    cid: row.cid,
    name: row.name,
    created_at: row.createdAt
  };
}

export function toNotification(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    student_id: row.studentId,
    type: row.type,
    is_read: row.isRead,
    message: row.message,
    created_at: row.createdAt
  };
}

export function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

export function activeUserById(id: number) {
  return and(eq(users.id, id), isNull(users.deletedAt));
}

export function activeUserByUid(uid: string) {
  return and(eq(users.uid, uid), isNull(users.deletedAt));
}

export function parseImagePaths(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && uploadPathPattern.test(item)) : [];
  } catch {
    return [];
  }
}

export function parseRecordImagePaths(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && tmpUploadPathPattern.test(item))
      : [];
  } catch {
    return [];
  }
}

export function normalizeRecordImagePaths(value: string | null) {
  const imagePaths = parseImagePaths(value);
  return [...new Set(imagePaths)].slice(0, MAX_RECORD_IMAGES);
}

export function normalizeIncomingRecordImagePaths(value: string | null) {
  const imagePaths = parseRecordImagePaths(value);
  return [...new Set(imagePaths)].slice(0, MAX_RECORD_IMAGES);
}

export function serializeImagePaths(imagePaths: string[]) {
  return JSON.stringify([...new Set(imagePaths)].slice(0, MAX_RECORD_IMAGES));
}

export function recordHasImagePathCondition(imagePath: string) {
  return sql`(${practiceRecords.coverImagePath} = ${imagePath} or ${practiceRecords.imagePaths} like ${`%"${imagePath}"%`})`;
}

export function userSearchCondition(query: string) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return undefined;
  const pattern = `%${normalized}%`;
  return sql`(${users.uid} like ${pattern} escape '\\' or ${users.name} like ${pattern} escape '\\' or ${users.nameInitials} like ${pattern} escape '\\')`;
}

export function normalizeSearchQuery(query: string) {
  return query.trim().replace(/[%_]/g, (value) => `\\${value}`);
}

export function uniquePositiveIds(ids: number[]) {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseUidNumber(uid: string) {
  const numeric = Number.parseInt(uid.slice(1), 16);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function countWords(value: string) {
  const normalized = value.trim();
  if (!normalized) return 0;
  const latinWords = normalized.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  const cjkChars = normalized.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return latinWords + cjkChars;
}

export function buildRecordWhere(filters: RecordFilters = {}, visibleStudentIds?: Set<number>) {
  const conditions = [];
  if (filters.task_id !== undefined) {
    if (filters.task_id === null) conditions.push(isNull(practiceRecords.taskId));
    else conditions.push(eq(practiceRecords.taskId, filters.task_id));
  }
  if (visibleStudentIds) {
    const ids = [...visibleStudentIds];
    if (ids.length === 0) conditions.push(sql`1 = 0`);
    else conditions.push(inArray(practiceRecords.studentId, ids));
  }
  if (filters.student_id) conditions.push(eq(practiceRecords.studentId, filters.student_id));
  if (filters.student_ids) {
    conditions.push(filters.student_ids.length > 0 ? inArray(practiceRecords.studentId, filters.student_ids) : sql`1 = 0`);
  }
  if (filters.class_id) {
    conditions.push(sql`${practiceRecords.studentId} in (select ${classStudents.studentId} from ${classStudents} where ${classStudents.classId} = ${filters.class_id})`);
  }
  if (filters.class_ids) {
    conditions.push(
      filters.class_ids.length > 0
        ? sql`${practiceRecords.studentId} in (select ${classStudents.studentId} from ${classStudents} where ${inArray(classStudents.classId, filters.class_ids)})`
        : sql`1 = 0`
    );
  }
  if (filters.status) conditions.push(eq(practiceRecords.status, filters.status));
  if (filters.practice_after) conditions.push(gte(practiceRecords.practiceDate, filters.practice_after));
  if (filters.practice_before) conditions.push(lte(practiceRecords.practiceDate, filters.practice_before));
  if (filters.created_after) conditions.push(gte(practiceRecords.createdAt, filters.created_after));
  if (filters.created_before) conditions.push(lte(practiceRecords.createdAt, filters.created_before));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function recordIdentitySelect() {
  return {
    student_name: sql<string>`case when ${users.id} is null or ${users.deletedAt} is not null then ${deletedUserName} else ${users.name} end`,
    student_uid: sql<string>`case when ${users.id} is null then coalesce(${practiceRecords.studentUidSnapshot}, '') else ${users.uid} end`
  };
}
