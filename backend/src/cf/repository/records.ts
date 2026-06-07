import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { D1DB } from '../db';
import type { CreateRecordInput, PracticeRecord, RecordFilters, RecordSort, StudentRecord, TeacherRecord, TeacherRecordExport, TeacherRecordSummary, UpdateRecordInput } from '../../models';
import { MAX_RECORD_IMAGES } from '../../models';
import { startOfUtcTodayIso } from '../../time';
import { classes, classStudents, practiceRecords, tempUploadDeletions, users } from '../../db/schema';
import { getTableColumns } from 'drizzle-orm';
import { normalizeRecordImagePaths, serializeImagePaths, toFiniteNumber, uploadPathPattern, tmpUploadPathPattern } from './helpers';
import { buildRecordWhere, deletedUserName, recordHasImagePathCondition, recordIdentitySelect } from './records-helpers';
import { moveToPermUpload, deleteR2Upload, r2Key } from './uploads';

const practiceRecordColumns = getTableColumns(practiceRecords);

function toPracticeRecord(row: typeof practiceRecords.$inferSelect, maxImages = MAX_RECORD_IMAGES): PracticeRecord {
  const imagePaths = normalizeRecordImagePaths(row.imagePaths, maxImages);
  return {
    id: row.id, task_id: row.taskId, student_id: row.studentId, student_uid_snapshot: row.studentUidSnapshot,
    title: row.title, content: row.content, practice_date: row.practiceDate, location: row.location,
    duration: row.duration, image_paths: imagePaths,
    cover_image_path: row.coverImagePath && imagePaths.includes(row.coverImagePath) ? row.coverImagePath : imagePaths[0] ?? null,
    status: row.status as PracticeRecord['status'], teacher_comment: row.teacherComment, score: row.score, created_at: row.createdAt
  };
}

async function prepareRecordImages(bucket: R2Bucket, imagePathsInput: string[], coverImagePathInput: string | null | undefined, reusableImagePaths: string[] = []) {
  const reusable = new Set(reusableImagePaths);
  const movedMap = new Map<string, string>();
  const imagePaths: string[] = [];

  for (const src of [...new Set(imagePathsInput)].slice(0, MAX_RECORD_IMAGES)) {
    if (uploadPathPattern.test(src)) {
      if (!reusable.has(src)) throw new Error('图片路径无效。');
      const obj = await bucket.head(r2Key(src));
      if (!obj) throw new Error('图片文件不存在或已过期。');
      movedMap.set(src, src);
      imagePaths.push(src);
      continue;
    }
    if (!tmpUploadPathPattern.test(src)) throw new Error('图片路径无效。');
    const dest = await moveToPermUpload(bucket, src);
    movedMap.set(src, dest);
    imagePaths.push(dest);
  }

  const coverImagePath = coverImagePathInput && movedMap.has(coverImagePathInput)
    ? movedMap.get(coverImagePathInput)!
    : imagePaths[0] ?? null;
  return { imagePaths, coverImagePath };
}

export async function createRecord(db: D1DB, bucket: R2Bucket, input: CreateRecordInput): Promise<PracticeRecord> {
  const createdAt = new Date().toISOString();
  const images = await prepareRecordImages(bucket, input.image_paths, input.cover_image_path);
  const studentRow = await db.select({ id: users.id }).from(users).where(eq(users.id, input.student_id)).get();
  const [row] = await db.insert(practiceRecords).values({
    taskId: input.task_id ?? null, studentId: input.student_id,
    studentUidSnapshot: studentRow?.id ?? null,
    title: input.title, content: input.content, practiceDate: input.practice_date,
    location: input.location, duration: input.duration,
    imagePaths: serializeImagePaths(images.imagePaths, MAX_RECORD_IMAGES),
    coverImagePath: images.coverImagePath,
    status: 'pending', teacherComment: null, score: null, createdAt
  }).returning({ id: practiceRecords.id });
  return getRecordById(db, row!.id) as Promise<PracticeRecord>;
}

export async function getRecordById(db: D1DB, id: number) {
  const row = await db.select().from(practiceRecords).where(eq(practiceRecords.id, id)).get();
  return row ? toPracticeRecord(row) : null;
}

export async function canAccessUpload(db: D1DB, imagePath: string, userId: number, role: string) {
  const pathCond = recordHasImagePathCondition(imagePath);
  if (role === 'admin') {
    return Boolean(await db.select({ id: practiceRecords.id }).from(practiceRecords).where(pathCond).limit(1).get());
  }
  if (role === 'student') {
    return Boolean(await db.select({ id: practiceRecords.id }).from(practiceRecords).where(and(pathCond, eq(practiceRecords.studentId, userId))).limit(1).get());
  }
  return Boolean(await db.select({ id: practiceRecords.id }).from(practiceRecords)
    .innerJoin(sql`class_students`, eq(practiceRecords.studentId, sql`class_students.student_id`))
    .innerJoin(sql`class_teachers`, eq(sql`class_students.class_id`, sql`class_teachers.class_id`))
    .where(and(pathCond, eq(sql`class_teachers.teacher_id`, userId))).limit(1).get());
}

export async function getRecordsByStudent(db: D1DB, studentId: number): Promise<StudentRecord[]> {
  const rows = await db.select({
    record: practiceRecordColumns,
    student_name: sql<string>`case when ${users.id} is null or ${users.deletedAt} is not null then ${deletedUserName} else ${users.name} end`
  }).from(practiceRecords).leftJoin(users, eq(practiceRecords.studentId, users.id))
    .where(eq(practiceRecords.studentId, studentId)).orderBy(desc(practiceRecords.createdAt)).all();
  return rows.map((r) => ({ ...toPracticeRecord(r.record), student_name: String(r.student_name) }));
}

export async function getRecordsByStudentTask(db: D1DB, studentId: number, taskId: number): Promise<StudentRecord[]> {
  const rows = await db.select({
    record: practiceRecordColumns,
    student_name: sql<string>`case when ${users.id} is null or ${users.deletedAt} is not null then ${deletedUserName} else ${users.name} end`
  }).from(practiceRecords).leftJoin(users, eq(practiceRecords.studentId, users.id))
    .where(and(eq(practiceRecords.studentId, studentId), eq(practiceRecords.taskId, taskId))).orderBy(desc(practiceRecords.createdAt)).all();
  return rows.map((r) => ({ ...toPracticeRecord(r.record), student_name: String(r.student_name) }));
}

export async function countStudentTaskRecords(db: D1DB, studentId: number, taskId: number) {
  const row = await db.select({ count: sql<number>`count(*)` }).from(practiceRecords)
    .where(and(eq(practiceRecords.studentId, studentId), eq(practiceRecords.taskId, taskId))).get();
  return toFiniteNumber(row?.count);
}

export async function getTeacherRecordById(db: D1DB, id: number, visibleStudentIds?: Set<number>): Promise<TeacherRecord | null> {
  const where = buildRecordWhere({ student_id: null }, visibleStudentIds);
  const record = await db.select({ record: practiceRecordColumns, ...recordIdentitySelect() })
    .from(practiceRecords).leftJoin(users, eq(practiceRecords.studentId, users.id))
    .where(and(eq(practiceRecords.id, id), where)).get();
  if (!record) return null;
  return { ...toPracticeRecord(record.record), student_name: String(record.student_name), student_uid: record.student_uid } satisfies TeacherRecord;
}

export async function getAllRecords(db: D1DB, filters: RecordFilters = {}, visibleStudentIds?: Set<number>, sort: RecordSort = 'created_at_desc'): Promise<TeacherRecordSummary[]> {
  const where = buildRecordWhere(filters, visibleStudentIds);
  const orderBy = sort === 'created_at_asc' ? [asc(practiceRecords.createdAt)]
    : sort === 'score_desc' ? [sql`case when ${practiceRecords.score} is null then 1 else 0 end`, desc(practiceRecords.score), desc(practiceRecords.createdAt)]
    : sort === 'score_asc' ? [sql`case when ${practiceRecords.score} is null then 1 else 0 end`, asc(practiceRecords.score), desc(practiceRecords.createdAt)]
    : [desc(practiceRecords.createdAt)];
  const rows = await db.select({
    id: practiceRecords.id, task_id: practiceRecords.taskId, student_id: practiceRecords.studentId,
    title: practiceRecords.title, practice_date: practiceRecords.practiceDate, status: practiceRecords.status,
    score: practiceRecords.score, created_at: practiceRecords.createdAt, ...recordIdentitySelect()
  }).from(practiceRecords).leftJoin(users, eq(practiceRecords.studentId, users.id)).where(where).orderBy(...orderBy).all();
  return rows.map((r) => ({
    id: r.id, task_id: r.task_id, student_id: r.student_id, title: r.title,
    practice_date: r.practice_date, status: r.status as TeacherRecordSummary['status'],
    score: r.score, created_at: r.created_at, student_name: r.student_name, student_uid: r.student_uid
  }));
}

export async function getRecordsForExport(db: D1DB, filters: RecordFilters = {}, visibleStudentIds?: Set<number>): Promise<TeacherRecordExport[]> {
  const where = buildRecordWhere(filters, visibleStudentIds);
  const rows = await db.select({
    title: practiceRecords.title, content: practiceRecords.content,
    practice_date: practiceRecords.practiceDate, location: practiceRecords.location,
    duration: practiceRecords.duration, status: practiceRecords.status, score: practiceRecords.score,
    teacher_comment: practiceRecords.teacherComment, created_at: practiceRecords.createdAt,
    image_paths: practiceRecords.imagePaths, class_name: classes.name, ...recordIdentitySelect()
  }).from(practiceRecords).leftJoin(users, eq(practiceRecords.studentId, users.id))
    .leftJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
    .leftJoin(classes, eq(classStudents.classId, classes.id))
    .where(where).orderBy(desc(practiceRecords.createdAt)).all();
  return rows.map((r) => ({
    class_label: r.class_name ?? '', student_name: r.student_name, student_uid: r.student_uid,
    title: r.title, practice_date: r.practice_date, duration: r.duration, location: r.location ?? '',
    status: r.status as TeacherRecordSummary['status'], score: r.score, teacher_comment: r.teacher_comment ?? '',
    created_at: r.created_at, content: r.content, image_count: normalizeRecordImagePaths(r.image_paths, MAX_RECORD_IMAGES).length
  }));
}

export async function updateRecord(db: D1DB, bucket: R2Bucket, id: number, updates: UpdateRecordInput): Promise<PracticeRecord | null> {
  const current = await getRecordById(db, id);
  if (!current) return null;
  const nextValues: Partial<typeof practiceRecords.$inferInsert> = {};
  if (updates.title !== undefined) nextValues.title = updates.title;
  if (updates.content !== undefined) nextValues.content = updates.content;
  if (updates.practice_date !== undefined) nextValues.practiceDate = updates.practice_date;
  if (updates.location !== undefined) nextValues.location = updates.location;
  if (updates.duration !== undefined) nextValues.duration = updates.duration;
  if (updates.image_paths !== undefined || updates.cover_image_path !== undefined) {
    const images = await prepareRecordImages(
      bucket,
      updates.image_paths !== undefined ? updates.image_paths : current.image_paths,
      updates.cover_image_path !== undefined ? updates.cover_image_path : current.cover_image_path,
      current.image_paths
    );
    nextValues.imagePaths = serializeImagePaths(images.imagePaths, MAX_RECORD_IMAGES);
    nextValues.coverImagePath = images.coverImagePath;
    for (const path of current.image_paths) {
      if (!images.imagePaths.includes(path)) await deleteR2Upload(bucket, path);
    }
  }
  if (updates.status !== undefined) nextValues.status = updates.status;
  if (updates.teacher_comment !== undefined) nextValues.teacherComment = updates.teacher_comment;
  if (updates.score !== undefined) nextValues.score = updates.score;
  await db.update(practiceRecords).set(nextValues).where(eq(practiceRecords.id, id)).run();
  return getRecordById(db, id);
}

export async function deleteRecord(db: D1DB, bucket: R2Bucket, id: number, imagePaths?: string[]) {
  const current = imagePaths ? { image_paths: imagePaths } : await getRecordById(db, id);
  if (!current) return false;
  await db.delete(practiceRecords).where(eq(practiceRecords.id, id)).run();
  await Promise.all(current.image_paths.map((p) => deleteR2Upload(bucket, p)));
  return true;
}

export async function countStudentRecordsToday(db: D1DB, studentId: number) {
  const row = await db.select({ count: sql<number>`count(*)` }).from(practiceRecords)
    .where(and(eq(practiceRecords.studentId, studentId), gte(practiceRecords.createdAt, startOfUtcTodayIso()))).get();
  return toFiniteNumber(row?.count);
}
