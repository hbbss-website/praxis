import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import type { D1DB } from '../db';
import type { CreatePracticeTaskInput, PracticeTaskDetail, PracticeTaskSummary, UpdatePracticeTaskInput } from '../../models';
import { classStudents, practiceRecords, practiceTaskClasses, practiceTasks } from '../../db/schema';
import { toFiniteNumber, nowIso } from './helpers';
import { getClassesForTask, getStudentClassId } from './classes';
import { calculateRecordStatistics } from './statistics';
import { countStudentTaskRecords } from './records';
import { deleteR2Upload } from './uploads';
import { buildRecordWhere } from './records-helpers';

const practiceTaskColumns = getTableColumns(practiceTasks);

function toPracticeTask(row: typeof practiceTasks.$inferSelect) {
  return {
    id: row.id, title: row.title, description: row.description,
    start_at: row.startAt, end_at: row.endAt, min_words: row.minWords, min_images: row.minImages,
    max_records_per_student: row.maxRecordsPerStudent, score_enabled: row.scoreEnabled,
    created_by_id: row.createdById, created_at: row.createdAt
  };
}

function uniquePositiveIds(ids: number[]) {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

async function decorateTask(db: D1DB, row: typeof practiceTasks.$inferSelect, studentId?: number): Promise<PracticeTaskSummary> {
  const [classCount, recordStats] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(practiceTaskClasses).where(eq(practiceTaskClasses.taskId, row.id)).get(),
    calculateRecordStatistics(db, eq(practiceRecords.taskId, row.id))
  ]);
  const myRecordCount = studentId !== undefined ? await countStudentTaskRecords(db, studentId, row.id) : undefined;
  return {
    ...toPracticeTask(row),
    class_count: toFiniteNumber(classCount?.count),
    record_count: recordStats.total_records,
    pending_count: recordStats.pending_count,
    approved_count: recordStats.approved_count,
    rejected_count: recordStats.rejected_count,
    ...(myRecordCount === undefined ? {} : { my_record_count: myRecordCount })
  };
}

export async function getClassIdsForTask(db: D1DB, taskId: number) {
  const rows = await db.select({ classId: practiceTaskClasses.classId }).from(practiceTaskClasses)
    .where(eq(practiceTaskClasses.taskId, taskId)).all();
  return rows.map((r) => r.classId);
}

export async function getStudentTaskById(db: D1DB, taskId: number, studentId: number): Promise<PracticeTaskSummary | null> {
  const classId = await getStudentClassId(db, studentId);
  if (!classId) return null;
  const row = await db.select({ task: practiceTaskColumns }).from(practiceTasks)
    .innerJoin(practiceTaskClasses, eq(practiceTaskClasses.taskId, practiceTasks.id))
    .where(and(eq(practiceTasks.id, taskId), eq(practiceTaskClasses.classId, classId))).get();
  return row ? decorateTask(db, row.task, studentId) : null;
}

export async function getManageableTaskById(db: D1DB, taskId: number, visibleClassIds?: Set<number>): Promise<PracticeTaskDetail | null> {
  const task = await getTaskDetail(db, taskId);
  if (!task) return null;
  if (!visibleClassIds) return task;
  return task.classes.some((item) => visibleClassIds.has(item.id)) ? task : null;
}

export async function createTask(db: D1DB, input: CreatePracticeTaskInput): Promise<PracticeTaskDetail> {
  const classIds = uniquePositiveIds(input.class_ids);
  if (!classIds.length) throw new Error('请选择至少一个班级。');
  const createdAt = nowIso();
  const [inserted] = await db.insert(practiceTasks).values({
    title: input.title, description: input.description,
    startAt: input.start_at, endAt: input.end_at,
    minWords: input.min_words, minImages: input.min_images,
    maxRecordsPerStudent: input.max_records_per_student,
    scoreEnabled: input.score_enabled,
    createdById: input.created_by_id, createdAt
  }).returning({ id: practiceTasks.id });
  const taskId = inserted!.id;
  await db.insert(practiceTaskClasses).values(classIds.map((cid) => ({ taskId, classId: cid, createdAt }))).run();
  return getTaskDetail(db, taskId) as Promise<PracticeTaskDetail>;
}

export async function updateTask(db: D1DB, taskId: number, input: UpdatePracticeTaskInput): Promise<PracticeTaskDetail | null> {
  const current = await getTaskDetail(db, taskId);
  if (!current) return null;
  const values: Partial<typeof practiceTasks.$inferInsert> = {};
  if (input.title !== undefined) values.title = input.title;
  if (input.description !== undefined) values.description = input.description;
  if (input.start_at !== undefined) values.startAt = input.start_at;
  if (input.end_at !== undefined) values.endAt = input.end_at;
  if (input.min_words !== undefined) values.minWords = input.min_words;
  if (input.min_images !== undefined) values.minImages = input.min_images;
  if (input.max_records_per_student !== undefined) values.maxRecordsPerStudent = input.max_records_per_student;
  if (Object.keys(values).length > 0) await db.update(practiceTasks).set(values).where(eq(practiceTasks.id, taskId)).run();
  if (input.class_ids !== undefined) {
    const currentClassIds = new Set(current.classes.map((c) => c.id));
    const next = uniquePositiveIds(input.class_ids).filter((id) => !currentClassIds.has(id));
    if (next.length > 0) {
      const createdAt = nowIso();
      await db.insert(practiceTaskClasses).values(next.map((cid) => ({ taskId, classId: cid, createdAt }))).onConflictDoNothing().run();
    }
  }
  return getTaskDetail(db, taskId);
}

export async function deleteTask(db: D1DB, bucket: R2Bucket, taskId: number) {
  const rows = await db.select({ imagePaths: practiceRecords.imagePaths }).from(practiceRecords)
    .where(eq(practiceRecords.taskId, taskId)).all();
  await db.delete(practiceRecords).where(eq(practiceRecords.taskId, taskId)).run();
  await db.delete(practiceTaskClasses).where(eq(practiceTaskClasses.taskId, taskId)).run();
  await db.delete(practiceTasks).where(eq(practiceTasks.id, taskId)).run();
  for (const row of rows) {
    try { const paths: string[] = JSON.parse(row.imagePaths || '[]'); await Promise.all(paths.map((p) => deleteR2Upload(bucket, p))); } catch {}
  }
  return true;
}

export async function countTaskClassRecords(db: D1DB, taskId: number, classId: number) {
  const row = await db.select({ count: sql<number>`count(*)` }).from(practiceRecords)
    .innerJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
    .where(and(eq(practiceRecords.taskId, taskId), eq(classStudents.classId, classId))).get();
  return toFiniteNumber(row?.count);
}

export async function removeTaskClass(db: D1DB, bucket: R2Bucket, taskId: number, classId: number) {
  const rows = await db.select({ imagePaths: practiceRecords.imagePaths }).from(practiceRecords)
    .innerJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
    .where(and(eq(practiceRecords.taskId, taskId), eq(classStudents.classId, classId))).all();
  await db.delete(practiceRecords).where(sql`${practiceRecords.id} in (select practice_records.id from practice_records inner join class_students on practice_records.student_id = class_students.student_id where practice_records.task_id = ${taskId} and class_students.class_id = ${classId})`).run();
  await db.delete(practiceTaskClasses).where(and(eq(practiceTaskClasses.taskId, taskId), eq(practiceTaskClasses.classId, classId))).run();
  for (const row of rows) {
    try { const paths: string[] = JSON.parse(row.imagePaths || '[]'); await Promise.all(paths.map((p) => deleteR2Upload(bucket, p))); } catch {}
  }
  return rows.length;
}

export async function getStudentTasks(db: D1DB, studentId: number): Promise<PracticeTaskSummary[]> {
  const classId = await getStudentClassId(db, studentId);
  if (!classId) return [];
  const rows = await db.select({ task: practiceTaskColumns }).from(practiceTasks)
    .innerJoin(practiceTaskClasses, eq(practiceTaskClasses.taskId, practiceTasks.id))
    .where(eq(practiceTaskClasses.classId, classId)).orderBy(asc(practiceTasks.startAt)).all();
  return Promise.all(rows.map((r) => decorateTask(db, r.task, studentId)));
}

export async function getManageableTasks(db: D1DB, visibleClassIds?: Set<number>): Promise<PracticeTaskSummary[]> {
  const where = visibleClassIds
    ? (() => { const ids = [...visibleClassIds]; return ids.length > 0 ? inArray(practiceTaskClasses.classId, ids) : sql`1 = 0`; })()
    : undefined;
  const rows = await db.select({ task: practiceTaskColumns }).from(practiceTasks)
    .innerJoin(practiceTaskClasses, eq(practiceTaskClasses.taskId, practiceTasks.id))
    .where(where).groupBy(practiceTasks.id).orderBy(desc(practiceTasks.createdAt)).all();
  return Promise.all(rows.map((r) => decorateTask(db, r.task)));
}

export async function getTaskDetail(db: D1DB, taskId: number, studentId?: number): Promise<PracticeTaskDetail | null> {
  const row = await db.select().from(practiceTasks).where(eq(practiceTasks.id, taskId)).get();
  if (!row) return null;
  const [decorated, taskClasses] = await Promise.all([decorateTask(db, row, studentId), getClassesForTask(db, taskId)]);
  return { ...decorated, classes: taskClasses };
}
