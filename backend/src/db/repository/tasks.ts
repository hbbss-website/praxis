import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { CreatePracticeTaskInput, PracticeTaskDetail, PracticeTaskSummary, UpdatePracticeTaskInput } from '../../models';
import { db } from '../client';
import { nowIso, toFiniteNumber, toPracticeTask, practiceTaskColumns, uniquePositiveIds } from '../helpers';
import { classStudents, practiceRecords, practiceTaskClasses, practiceTasks } from '../schema';
import { getClassesForTask, getStudentClassId } from './classes';
import { calculateRecordStatistics } from './statistics';
import { countStudentTaskRecords } from './records';
import { removeUploadFile } from './uploads';

export function getClassIdsForTask(taskId: number) {
  return db
    .select({ classId: practiceTaskClasses.classId })
    .from(practiceTaskClasses)
    .where(eq(practiceTaskClasses.taskId, taskId))
    .all()
    .map((row) => row.classId);
}

export function getStudentTaskById(taskId: number, studentId: number) {
  const classId = getStudentClassId(studentId);
  if (!classId) return null;
  const row = db
    .select({ task: practiceTaskColumns })
    .from(practiceTasks)
    .innerJoin(practiceTaskClasses, eq(practiceTaskClasses.taskId, practiceTasks.id))
    .where(and(eq(practiceTasks.id, taskId), eq(practiceTaskClasses.classId, classId)))
    .get();
  return row ? decorateTask(row.task, studentId) : null;
}

export function getManageableTaskById(taskId: number, visibleClassIds?: Set<number>) {
  const task = getTaskDetail(taskId);
  if (!task) return null;
  if (!visibleClassIds) return task;
  return task.classes.some((item) => visibleClassIds.has(item.id)) ? task : null;
}

export function createTask(input: CreatePracticeTaskInput) {
  const classIds = uniquePositiveIds(input.class_ids);
  if (classIds.length === 0) throw new Error('请选择至少一个班级。');
  const createdAt = nowIso();
  const result = db.transaction((tx) => {
    const inserted = tx.insert(practiceTasks).values({
      title: input.title, description: input.description,
      startAt: input.start_at, endAt: input.end_at,
      minWords: input.min_words, minImages: input.min_images,
      maxRecordsPerStudent: input.max_records_per_student,
      scoreEnabled: input.score_enabled,
      createdById: input.created_by_id, createdAt
    }).run();
    const taskId = Number(inserted.lastInsertRowid);
    tx.insert(practiceTaskClasses).values(classIds.map((classId) => ({ taskId, classId, createdAt }))).run();
    return taskId;
  });
  return getTaskDetail(result)!;
}

export function updateTask(taskId: number, input: UpdatePracticeTaskInput) {
  const current = getTaskDetail(taskId);
  if (!current) return null;
  const values: Partial<typeof practiceTasks.$inferInsert> = {};
  if (input.title !== undefined) values.title = input.title;
  if (input.description !== undefined) values.description = input.description;
  if (input.start_at !== undefined) values.startAt = input.start_at;
  if (input.end_at !== undefined) values.endAt = input.end_at;
  if (input.min_words !== undefined) values.minWords = input.min_words;
  if (input.min_images !== undefined) values.minImages = input.min_images;
  if (input.max_records_per_student !== undefined) values.maxRecordsPerStudent = input.max_records_per_student;
  db.transaction((tx) => {
    if (Object.keys(values).length > 0) {
      tx.update(practiceTasks).set(values).where(eq(practiceTasks.id, taskId)).run();
    }
    if (input.class_ids !== undefined) {
      const currentClassIds = new Set(current.classes.map((item) => item.id));
      const nextClassIds = uniquePositiveIds(input.class_ids).filter((classId) => !currentClassIds.has(classId));
      if (nextClassIds.length > 0) {
        const createdAt = nowIso();
        tx.insert(practiceTaskClasses).values(nextClassIds.map((classId) => ({ taskId, classId, createdAt }))).onConflictDoNothing().run();
      }
    }
  });
  return getTaskDetail(taskId);
}

export function deleteTask(taskId: number) {
  const rows = db
    .select({ imagePaths: practiceRecords.imagePaths })
    .from(practiceRecords)
    .where(eq(practiceRecords.taskId, taskId))
    .all();
  db.transaction((tx) => {
    tx.delete(practiceRecords).where(eq(practiceRecords.taskId, taskId)).run();
    tx.delete(practiceTaskClasses).where(eq(practiceTaskClasses.taskId, taskId)).run();
    tx.delete(practiceTasks).where(eq(practiceTasks.id, taskId)).run();
  });
  for (const row of rows) {
    const paths: string[] = JSON.parse(row.imagePaths || '[]');
    for (const imagePath of paths) removeUploadFile(imagePath);
  }
  return true;
}

export function countTaskClassRecords(taskId: number, classId: number) {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(practiceRecords)
    .innerJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
    .where(and(eq(practiceRecords.taskId, taskId), eq(classStudents.classId, classId)))
    .get();
  return toFiniteNumber(row?.count);
}

export function removeTaskClass(taskId: number, classId: number) {
  const rows = db
    .select({ imagePaths: practiceRecords.imagePaths })
    .from(practiceRecords)
    .innerJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
    .where(and(eq(practiceRecords.taskId, taskId), eq(classStudents.classId, classId)))
    .all()
    .map((row) => row.imagePaths);
  db.transaction((tx) => {
    tx.delete(practiceRecords)
      .where(sql`${practiceRecords.id} in (select practice_records.id from practice_records inner join class_students on practice_records.student_id = class_students.student_id where practice_records.task_id = ${taskId} and class_students.class_id = ${classId})`)
      .run();
    tx.delete(practiceTaskClasses)
      .where(and(eq(practiceTaskClasses.taskId, taskId), eq(practiceTaskClasses.classId, classId)))
      .run();
  });
  for (const imagePathsStr of rows) {
    const imagePaths: string[] = JSON.parse(imagePathsStr || '[]');
    for (const imagePath of imagePaths) removeUploadFile(imagePath);
  }
  return rows.length;
}

export function getStudentTasks(studentId: number): PracticeTaskSummary[] {
  const classId = getStudentClassId(studentId);
  if (!classId) return [];
  return db
    .select({ task: practiceTaskColumns })
    .from(practiceTasks)
    .innerJoin(practiceTaskClasses, eq(practiceTaskClasses.taskId, practiceTasks.id))
    .where(eq(practiceTaskClasses.classId, classId))
    .orderBy(asc(practiceTasks.startAt))
    .all()
    .map((row) => decorateTask(row.task, studentId));
}

export function getManageableTasks(visibleClassIds?: Set<number>): PracticeTaskSummary[] {
  const where = visibleClassIds
    ? (() => { const ids = [...visibleClassIds]; return ids.length > 0 ? inArray(practiceTaskClasses.classId, ids) : sql`1 = 0`; })()
    : undefined;
  return db
    .select({ task: practiceTaskColumns })
    .from(practiceTasks)
    .innerJoin(practiceTaskClasses, eq(practiceTaskClasses.taskId, practiceTasks.id))
    .where(where)
    .groupBy(practiceTasks.id)
    .orderBy(desc(practiceTasks.createdAt))
    .all()
    .map((row) => decorateTask(row.task));
}

function decorateTask(row: typeof practiceTasks.$inferSelect, studentId?: number): PracticeTaskSummary {
  const classCount = db
    .select({ count: sql<number>`count(*)` })
    .from(practiceTaskClasses)
    .where(eq(practiceTaskClasses.taskId, row.id))
    .get();
  const recordStats = calculateRecordStatistics(eq(practiceRecords.taskId, row.id));
  const myRecordCount = studentId ? countStudentTaskRecords(studentId, row.id) : undefined;
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

export function getTaskDetail(taskId: number, studentId?: number): PracticeTaskDetail | null {
  const row = db.select().from(practiceTasks).where(eq(practiceTasks.id, taskId)).get();
  if (!row) return null;
  return { ...decorateTask(row, studentId), classes: getClassesForTask(taskId) };
}
