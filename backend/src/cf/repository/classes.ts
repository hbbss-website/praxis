import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { D1DB } from '../db';
import type { ClassAssignments, ClassSummary, StudentWithClassSummary } from '../../models';
import { classes, classStudents, classTeachers, practiceTaskClasses, users } from '../../db/schema';
import { nowIso } from './helpers';

function toClassSummary(row: Pick<typeof classes.$inferSelect, 'id' | 'name' | 'createdAt'>): ClassSummary {
  return { id: row.id, name: row.name, created_at: row.createdAt };
}

function toStudentSummary(row: Pick<typeof users.$inferSelect, 'id' | 'name' | 'englishName' | 'createdAt'>) {
  return { id: row.id, uid: row.id, name: row.name, english_name: row.englishName, created_at: row.createdAt };
}

function normalizeQuery(q: string) {
  return q.trim().replace(/[%_]/g, (c) => `\\${c}`);
}

function userSearchCondition(query: string) {
  const q = normalizeQuery(query);
  if (!q) return undefined;
  const p = `%${q}%`;
  return sql`(${users.id} like ${p} escape '\\' or ${users.name} like ${p} escape '\\' or coalesce(${users.englishName},'') like ${p} escape '\\' or ${users.nameInitials} like ${p} escape '\\')`;
}

export async function createClass(db: D1DB, name: string): Promise<ClassSummary> {
  const createdAt = nowIso();
  const [row] = await db.insert(classes).values({ name, createdAt }).returning({ id: classes.id });
  return { id: row!.id, name, created_at: createdAt };
}

export async function findClassById(db: D1DB, id: number) {
  const row = await db.select().from(classes).where(eq(classes.id, id)).get();
  return row ? toClassSummary(row) : null;
}

export async function findClassByName(db: D1DB, name: string) {
  const row = await db.select().from(classes).where(eq(classes.name, name)).get();
  return row ? toClassSummary(row) : null;
}

export async function updateClassName(db: D1DB, id: number, name: string) {
  const result = await db.update(classes).set({ name }).where(eq(classes.id, id)).run();
  return (result as any).rowsAffected > 0 || (result as any).changes > 0;
}

export async function getClasses(db: D1DB) {
  const rows = await db.select({ id: classes.id, name: classes.name, createdAt: classes.createdAt })
    .from(classes).orderBy(classes.name).all();
  return rows.map(toClassSummary);
}

export async function searchClasses(db: D1DB, query: string): Promise<ClassSummary[]> {
  const q = normalizeQuery(query);
  const where = q ? sql`${classes.name} like ${`%${q}%`} escape '\\'` : undefined;
  const rows = await db.select({ id: classes.id, name: classes.name, createdAt: classes.createdAt })
    .from(classes).where(where).orderBy(classes.name).all();
  return rows.map(toClassSummary);
}

export async function getTeacherClasses(db: D1DB, teacherId: number) {
  const rows = await db.select({ id: classes.id, name: classes.name, createdAt: classes.createdAt })
    .from(classTeachers)
    .innerJoin(classes, eq(classTeachers.classId, classes.id))
    .innerJoin(users, eq(classTeachers.teacherId, users.id))
    .where(and(eq(classTeachers.teacherId, teacherId), eq(users.role, 'teacher'), isNull(users.deletedAt)))
    .orderBy(classes.name).all();
  return rows.map(toClassSummary);
}

export async function assignTeachersToClass(db: D1DB, classId: number, teacherIds: number[]) {
  if (!teacherIds.length) return;
  const createdAt = nowIso();
  await db.insert(classTeachers).values(teacherIds.map((tid) => ({ classId, teacherId: tid, createdAt }))).onConflictDoNothing().run();
}

export async function removeTeachersFromClass(db: D1DB, classId: number, teacherIds: number[]) {
  if (!teacherIds.length) return;
  await db.delete(classTeachers).where(and(eq(classTeachers.classId, classId), inArray(classTeachers.teacherId, teacherIds))).run();
}

export async function assignStudentsToClass(db: D1DB, classId: number, studentIds: number[]) {
  if (!studentIds.length) return;
  const createdAt = nowIso();
  await db.transaction(async (tx) => {
    await tx.delete(classStudents).where(inArray(classStudents.studentId, studentIds)).run();
    await tx.insert(classStudents).values(studentIds.map((sid) => ({ classId, studentId: sid, createdAt }))).run();
  });
}

export async function removeStudentsFromClass(db: D1DB, classId: number, studentIds: number[]) {
  if (!studentIds.length) return;
  await db.delete(classStudents).where(and(eq(classStudents.classId, classId), inArray(classStudents.studentId, studentIds))).run();
}

export async function clearStudentClasses(db: D1DB, studentIds: number[]) {
  if (!studentIds.length) return;
  await db.delete(classStudents).where(inArray(classStudents.studentId, studentIds)).run();
}

export async function setStudentsClass(db: D1DB, studentIds: number[], classId: number | null) {
  if (!studentIds.length) return;
  if (classId) { await assignStudentsToClass(db, classId, studentIds); return; }
  await clearStudentClasses(db, studentIds);
}

export async function getAllClassAssignments(db: D1DB): Promise<ClassAssignments> {
  const teachers = await db.select({ class_id: classTeachers.classId, teacher_id: classTeachers.teacherId })
    .from(classTeachers).innerJoin(classes, eq(classTeachers.classId, classes.id))
    .innerJoin(users, eq(classTeachers.teacherId, users.id))
    .where(and(isNull(users.deletedAt), eq(users.role, 'teacher'))).all();
  const students = await db.select({ class_id: classStudents.classId, student_id: classStudents.studentId })
    .from(classStudents).innerJoin(classes, eq(classStudents.classId, classes.id))
    .innerJoin(users, eq(classStudents.studentId, users.id))
    .where(and(isNull(users.deletedAt), eq(users.role, 'student'))).all();
  return { teachers, students };
}

export async function getClassStudents(db: D1DB, classId: number) {
  const rows = await db.select({ id: users.id, name: users.name, englishName: users.englishName, createdAt: users.createdAt })
    .from(classStudents).innerJoin(users, eq(classStudents.studentId, users.id))
    .where(and(eq(classStudents.classId, classId), eq(users.role, 'student'), isNull(users.deletedAt)))
    .orderBy(desc(users.id)).all();
  return rows.map(toStudentSummary);
}

export async function getTeacherStudents(db: D1DB, teacherId: number) {
  const rows = await db.select({ id: users.id, name: users.name, englishName: users.englishName, createdAt: users.createdAt })
    .from(classTeachers).innerJoin(classStudents, eq(classTeachers.classId, classStudents.classId))
    .innerJoin(users, eq(classStudents.studentId, users.id))
    .where(and(eq(classTeachers.teacherId, teacherId), eq(users.role, 'student'), isNull(users.deletedAt)))
    .orderBy(desc(users.id)).all();
  return rows.map(toStudentSummary);
}

export async function searchStudents(db: D1DB, query: string, visibleStudentIds?: Set<number>, classIds?: number[]): Promise<StudentWithClassSummary[]> {
  const conditions = [eq(users.role, 'student'), isNull(users.deletedAt)];
  const sc = userSearchCondition(query);
  if (sc) conditions.push(sc);
  if (visibleStudentIds) {
    const ids = [...visibleStudentIds];
    conditions.push(ids.length > 0 ? inArray(users.id, ids) : sql`1 = 0`);
  }
  if (classIds) conditions.push(classIds.length > 0 ? inArray(classStudents.classId, classIds) : sql`1 = 0`);
  const rows = await db.select({ id: users.id, name: users.name, englishName: users.englishName, createdAt: users.createdAt, class_id: classStudents.classId, class_name: classes.name })
    .from(users).leftJoin(classStudents, eq(classStudents.studentId, users.id))
    .leftJoin(classes, eq(classStudents.classId, classes.id))
    .where(and(...conditions)).orderBy(desc(users.id)).all();
  return rows.map((r) => ({ id: r.id, uid: r.id, name: r.name, english_name: r.englishName, created_at: r.createdAt, class_id: r.class_id, class_name: r.class_name }));
}

export async function searchStudentsForClassAssignment(db: D1DB, query: string, classId: number | null): Promise<StudentWithClassSummary[]> {
  const conditions = [eq(users.role, 'student'), isNull(users.deletedAt)];
  const sc = userSearchCondition(query);
  if (sc) conditions.push(sc);
  conditions.push(classId ? sql`(${classStudents.classId} is null or ${classStudents.classId} = ${classId})` : sql`${classStudents.classId} is null`);
  const rows = await db.select({ id: users.id, name: users.name, englishName: users.englishName, createdAt: users.createdAt, class_id: classStudents.classId, class_name: classes.name })
    .from(users).leftJoin(classStudents, eq(classStudents.studentId, users.id))
    .leftJoin(classes, eq(classStudents.classId, classes.id))
    .where(and(...conditions)).orderBy(desc(users.id)).all();
  return rows.map((r) => ({ id: r.id, uid: r.id, name: r.name, english_name: r.englishName, created_at: r.createdAt, class_id: r.class_id, class_name: r.class_name }));
}

export async function getAssignedStudents(db: D1DB): Promise<StudentWithClassSummary[]> {
  const rows = await db.select({ id: users.id, name: users.name, englishName: users.englishName, createdAt: users.createdAt, class_id: classStudents.classId, class_name: classes.name })
    .from(classStudents).innerJoin(users, eq(classStudents.studentId, users.id))
    .innerJoin(classes, eq(classStudents.classId, classes.id))
    .where(and(eq(users.role, 'student'), isNull(users.deletedAt))).orderBy(desc(users.id)).all();
  return rows.map((r) => ({ id: r.id, uid: r.id, name: r.name, english_name: r.englishName, created_at: r.createdAt, class_id: r.class_id, class_name: r.class_name }));
}

export async function getTeacherStudentIds(db: D1DB, teacherId: number) {
  const rows = await db.select({ studentId: classStudents.studentId })
    .from(classTeachers).innerJoin(classStudents, eq(classTeachers.classId, classStudents.classId))
    .where(eq(classTeachers.teacherId, teacherId)).all();
  return rows.map((r) => r.studentId);
}

export async function getTeacherClassIds(db: D1DB, teacherId: number) {
  const rows = await db.select({ classId: classTeachers.classId }).from(classTeachers)
    .where(eq(classTeachers.teacherId, teacherId)).all();
  return rows.map((r) => r.classId);
}

export async function getStudentClassId(db: D1DB, studentId: number) {
  const row = await db.select({ classId: classStudents.classId }).from(classStudents)
    .where(eq(classStudents.studentId, studentId)).get();
  return row?.classId ?? null;
}

export async function getClassesForTask(db: D1DB, taskId: number): Promise<ClassSummary[]> {
  const rows = await db.select({ id: classes.id, name: classes.name, createdAt: classes.createdAt })
    .from(practiceTaskClasses).innerJoin(classes, eq(practiceTaskClasses.classId, classes.id))
    .where(eq(practiceTaskClasses.taskId, taskId)).orderBy(classes.name).all();
  return rows.map(toClassSummary);
}
