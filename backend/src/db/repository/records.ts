import fs from 'node:fs';

import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import type { CreateRecordInput, RecordFilters, RecordSort, StudentRecord, TeacherRecord, TeacherRecordExport, TeacherRecordSummary, UpdateRecordInput } from '../../models';
import { MAX_RECORD_IMAGES } from '../../models';
import { db } from '../client';
import {
  nowIso, toPracticeRecord, practiceRecordColumns, serializeImagePaths,
  recordHasImagePathCondition, recordIdentitySelect, buildRecordWhere,
  normalizeRecordImagePaths, normalizeIncomingRecordImagePaths, toFiniteNumber,
  deletedUserName, uploadPathPattern, tmpUploadPathPattern
} from '../helpers';
import { classes, classStudents, users, practiceRecords, tempUploadDeletions } from '../schema';
import { createUploadPathFromSource, removeUploadFile, resolveTmpUploadFilePath, resolveUploadFilePath } from './uploads';

export function createRecord(input: CreateRecordInput) {
  const student = db.select({ id: users.id }).from(users).where(eq(users.id, input.student_id)).get();
  const createdAt = nowIso();
  const images = prepareRecordImages(input.image_paths, input.cover_image_path);
  const result = db.insert(practiceRecords).values({
    taskId: input.task_id ?? null,
    studentId: input.student_id,
    studentUidSnapshot: student?.id ?? null,
    title: input.title, content: input.content,
    practiceDate: input.practice_date, location: input.location,
    duration: input.duration,
    imagePaths: serializeImagePaths(images.imagePaths),
    coverImagePath: images.coverImagePath,
    status: 'pending', teacherComment: null, score: null, createdAt
  }).run();
  return getRecordById(Number(result.lastInsertRowid))!;
}

export function getRecordById(id: number) {
  const row = db.select().from(practiceRecords).where(eq(practiceRecords.id, id)).get();
  return row ? toPracticeRecord(row) : null;
}

export function canAccessUpload(imagePath: string, userId: number, role: string) {
  const pathCondition = recordHasImagePathCondition(imagePath);
  if (role === 'admin') {
    return Boolean(db.select({ id: practiceRecords.id }).from(practiceRecords).where(pathCondition).limit(1).get());
  }
  if (role === 'student') {
    return Boolean(db.select({ id: practiceRecords.id }).from(practiceRecords).where(and(pathCondition, eq(practiceRecords.studentId, userId))).limit(1).get());
  }
  return Boolean(
    db.select({ id: practiceRecords.id }).from(practiceRecords)
      .innerJoin(sql`class_students`, eq(practiceRecords.studentId, sql`class_students.student_id`))
      .innerJoin(sql`class_teachers`, eq(sql`class_students.class_id`, sql`class_teachers.class_id`))
      .where(and(pathCondition, eq(sql`class_teachers.teacher_id`, userId)))
      .limit(1).get()
  );
}

export function getRecordsByStudent(studentId: number): StudentRecord[] {
  return db
    .select({
      record: practiceRecordColumns,
      student_name: sql<string>`case when ${users.id} is null or ${users.deletedAt} is not null then ${deletedUserName} else ${users.name} end`
    })
    .from(practiceRecords)
    .leftJoin(users, eq(practiceRecords.studentId, users.id))
    .where(eq(practiceRecords.studentId, studentId))
    .orderBy(desc(practiceRecords.createdAt))
    .all()
    .map((row) => ({ ...toPracticeRecord(row.record), student_name: String(row.student_name) }));
}

export function getRecordsByStudentTask(studentId: number, taskId: number): StudentRecord[] {
  return db
    .select({
      record: practiceRecordColumns,
      student_name: sql<string>`case when ${users.id} is null or ${users.deletedAt} is not null then ${deletedUserName} else ${users.name} end`
    })
    .from(practiceRecords)
    .leftJoin(users, eq(practiceRecords.studentId, users.id))
    .where(and(eq(practiceRecords.studentId, studentId), eq(practiceRecords.taskId, taskId)))
    .orderBy(desc(practiceRecords.createdAt))
    .all()
    .map((row) => ({ ...toPracticeRecord(row.record), student_name: String(row.student_name) }));
}

export function countStudentTaskRecords(studentId: number, taskId: number) {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(practiceRecords)
    .where(and(eq(practiceRecords.studentId, studentId), eq(practiceRecords.taskId, taskId)))
    .get();
  return toFiniteNumber(row?.count);
}

export function getTeacherRecordById(id: number, visibleStudentIds?: Set<number>) {
  const where = buildRecordWhere({ student_id: null }, visibleStudentIds);
  const record = db
    .select({
      record: practiceRecordColumns,
      ...recordIdentitySelect()
    })
    .from(practiceRecords)
    .leftJoin(users, eq(practiceRecords.studentId, users.id))
    .where(and(eq(practiceRecords.id, id), where))
    .get();
  if (!record) return null;
  return {
    ...toPracticeRecord(record.record),
    student_name: String(record.student_name),
    student_uid: record.student_uid
  } satisfies TeacherRecord;
}

export function getRecordsForExport(filters: RecordFilters = {}, visibleStudentIds?: Set<number>): TeacherRecordExport[] {
  const where = buildRecordWhere(filters, visibleStudentIds);
  return db
    .select({
      title: practiceRecords.title, content: practiceRecords.content,
      practice_date: practiceRecords.practiceDate, location: practiceRecords.location,
      duration: practiceRecords.duration, status: practiceRecords.status,
      score: practiceRecords.score, teacher_comment: practiceRecords.teacherComment, created_at: practiceRecords.createdAt,
      image_paths: practiceRecords.imagePaths,
      class_name: classes.name,
      ...recordIdentitySelect()
    })
    .from(practiceRecords)
    .leftJoin(users, eq(practiceRecords.studentId, users.id))
    .leftJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
    .leftJoin(classes, eq(classStudents.classId, classes.id))
    .where(where)
    .orderBy(desc(practiceRecords.createdAt))
    .all()
    .map((row) => ({
      class_label: row.class_name ?? '',
      student_name: row.student_name, student_uid: row.student_uid,
      title: row.title, practice_date: row.practice_date, duration: row.duration,
      location: row.location ?? '', status: row.status as TeacherRecordSummary['status'],
      score: row.score,
      teacher_comment: row.teacher_comment ?? '', created_at: row.created_at,
      content: row.content, image_count: normalizeRecordImagePaths(row.image_paths).length
    }));
}

export function getAllRecords(filters: RecordFilters = {}, visibleStudentIds?: Set<number>, sort: RecordSort = 'created_at_desc'): TeacherRecordSummary[] {
  const where = buildRecordWhere(filters, visibleStudentIds);
  return db
    .select({
      id: practiceRecords.id, task_id: practiceRecords.taskId,
      student_id: practiceRecords.studentId, title: practiceRecords.title,
      practice_date: practiceRecords.practiceDate, status: practiceRecords.status,
      score: practiceRecords.score,
      created_at: practiceRecords.createdAt,
      ...recordIdentitySelect()
    })
    .from(practiceRecords)
    .leftJoin(users, eq(practiceRecords.studentId, users.id))
    .where(where)
    .orderBy(...buildRecordOrderBy(sort))
    .all()
    .map((row) => ({
      id: row.id, task_id: row.task_id, student_id: row.student_id,
      title: row.title, practice_date: row.practice_date,
      status: row.status as TeacherRecordSummary['status'],
      score: row.score,
      created_at: row.created_at, student_name: row.student_name, student_uid: row.student_uid
    }));
}

export function updateRecord(id: number, updates: UpdateRecordInput) {
  const current = getRecordById(id);
  if (!current) return null;
  const nextValues: Partial<typeof practiceRecords.$inferInsert> = {};
  if (updates.title !== undefined) nextValues.title = updates.title;
  if (updates.content !== undefined) nextValues.content = updates.content;
  if (updates.practice_date !== undefined) nextValues.practiceDate = updates.practice_date;
  if (updates.location !== undefined) nextValues.location = updates.location;
  if (updates.duration !== undefined) nextValues.duration = updates.duration;
  if (updates.image_paths !== undefined || updates.cover_image_path !== undefined) {
    const images = prepareRecordImages(
      updates.image_paths !== undefined ? updates.image_paths : current.image_paths,
      updates.cover_image_path !== undefined ? updates.cover_image_path : current.cover_image_path,
      current.image_paths
    );
    nextValues.imagePaths = serializeImagePaths(images.imagePaths);
    nextValues.coverImagePath = images.coverImagePath;
    for (const imagePath of current.image_paths) {
      if (!images.imagePaths.includes(imagePath)) removeUploadFile(imagePath);
    }
  }
  if (updates.status !== undefined) nextValues.status = updates.status;
  if (updates.teacher_comment !== undefined) nextValues.teacherComment = updates.teacher_comment;
  if (updates.score !== undefined) nextValues.score = updates.score;
  db.update(practiceRecords).set(nextValues).where(eq(practiceRecords.id, id)).run();
  return getRecordById(id);
}

export function deleteRecord(id: number, imagePaths?: string[]) {
  const current = imagePaths ? { image_paths: imagePaths } : getRecordById(id);
  if (!current) return false;
  db.delete(practiceRecords).where(eq(practiceRecords.id, id)).run();
  for (const imagePath of current.image_paths) removeUploadFile(imagePath);
  return true;
}

export function countStudentRecordsToday(studentId: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(practiceRecords)
    .where(and(eq(practiceRecords.studentId, studentId), gte(practiceRecords.createdAt, start.toISOString())))
    .get();
  return toFiniteNumber(row?.count);
}

function prepareRecordImages(imagePathsInput: string[], coverImagePathInput: string | null | undefined, reusableImagePaths: string[] = []) {
  const sourceImagePaths = [...new Set(imagePathsInput)].slice(0, MAX_RECORD_IMAGES);
  const reusableImagePathSet = new Set(reusableImagePaths);
  const movedImagePaths = new Map<string, string>();
  const imagePaths: string[] = [];
  for (const sourceImagePath of sourceImagePaths) {
    if (uploadPathPattern.test(sourceImagePath)) {
      if (!reusableImagePathSet.has(sourceImagePath)) throw new Error('图片路径无效。');
      const sourceFilePath = resolveUploadFilePath(sourceImagePath);
      if (!sourceFilePath || !fs.existsSync(sourceFilePath)) throw new Error('图片文件不存在或已过期。');
      movedImagePaths.set(sourceImagePath, sourceImagePath);
      imagePaths.push(sourceImagePath);
      continue;
    }
    if (!tmpUploadPathPattern.test(sourceImagePath)) throw new Error('图片路径无效。');
    const sourceFilePath = resolveTmpUploadFilePath(sourceImagePath);
    if (!sourceFilePath || !fs.existsSync(sourceFilePath)) throw new Error('图片文件不存在或已过期。');
    const target = createUploadPathFromSource(sourceFilePath);
    fs.renameSync(sourceFilePath, target.filePath);
    db.delete(tempUploadDeletions).where(eq(tempUploadDeletions.filePath, sourceImagePath)).run();
    movedImagePaths.set(sourceImagePath, target.imagePath);
    imagePaths.push(target.imagePath);
  }
  const coverImagePath = coverImagePathInput && movedImagePaths.has(coverImagePathInput)
    ? movedImagePaths.get(coverImagePathInput)!
    : imagePaths[0] ?? null;
  return { imagePaths, coverImagePath };
}

function buildRecordOrderBy(sort: RecordSort) {
  if (sort === 'created_at_asc') return [asc(practiceRecords.createdAt)];
  if (sort === 'score_desc') return [sql`case when ${practiceRecords.score} is null then 1 else 0 end`, desc(practiceRecords.score), desc(practiceRecords.createdAt)];
  if (sort === 'score_asc') return [sql`case when ${practiceRecords.score} is null then 1 else 0 end`, asc(practiceRecords.score), desc(practiceRecords.createdAt)];
  return [desc(practiceRecords.createdAt)];
}
