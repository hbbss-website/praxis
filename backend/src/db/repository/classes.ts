import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { ClassAssignments, ClassSummary, StudentWithClassSummary, UserRole } from '../../models';
import { db } from '../client';
import { nowIso, toClassSummary, toStudentSummary, userSearchCondition, parseUidNumber } from '../helpers';
import { classes, classStudents, classTeachers, practiceTaskClasses, users } from '../schema';

export function createClass(name: string) {
  const createdAt = nowIso();
  const cid = allocateClassCid();
  const result = db.insert(classes).values({ cid, name, createdAt }).run();
  return { id: Number(result.lastInsertRowid), cid, name, created_at: createdAt } satisfies ClassSummary;
}

export function findClassById(id: number) {
  const row = db.select().from(classes).where(eq(classes.id, id)).get();
  return row ? toClassSummary(row) : null;
}

export function findClassByCid(cid: string) {
  const row = db.select().from(classes).where(eq(classes.cid, cid)).get();
  return row ? toClassSummary(row) : null;
}

export function updateClassName(id: number, name: string) {
  const result = db.update(classes).set({ name }).where(eq(classes.id, id)).run();
  return result.changes > 0;
}

export function getClasses() {
  return db
    .select({ id: classes.id, cid: classes.cid, name: classes.name, createdAt: classes.createdAt })
    .from(classes)
    .orderBy(classes.cid)
    .all()
    .map(toClassSummary);
}

export function getTeacherClasses(teacherId: number) {
  return db
    .select({ id: classes.id, cid: classes.cid, name: classes.name, createdAt: classes.createdAt })
    .from(classTeachers)
    .innerJoin(classes, eq(classTeachers.classId, classes.id))
    .innerJoin(users, eq(classTeachers.teacherId, users.id))
    .where(and(eq(classTeachers.teacherId, teacherId), eq(users.role, 'teacher'), isNull(users.deletedAt)))
    .orderBy(classes.cid)
    .all()
    .map(toClassSummary);
}

export function assignTeachersToClass(classId: number, teacherIds: number[]) {
  if (teacherIds.length === 0) return;
  const createdAt = nowIso();
  db.insert(classTeachers)
    .values(teacherIds.map((teacherId) => ({ classId, teacherId, createdAt })))
    .onConflictDoNothing()
    .run();
}

export function removeTeachersFromClass(classId: number, teacherIds: number[]) {
  if (teacherIds.length === 0) return;
  db.delete(classTeachers)
    .where(and(eq(classTeachers.classId, classId), inArray(classTeachers.teacherId, teacherIds)))
    .run();
}

export function assignStudentsToClass(classId: number, studentIds: number[]) {
  if (studentIds.length === 0) return;
  const createdAt = nowIso();
  db.transaction((tx) => {
    tx.delete(classStudents).where(inArray(classStudents.studentId, studentIds)).run();
    tx.insert(classStudents).values(studentIds.map((studentId) => ({ classId, studentId, createdAt }))).run();
  });
}

export function removeStudentsFromClass(classId: number, studentIds: number[]) {
  if (studentIds.length === 0) return;
  db.delete(classStudents)
    .where(and(eq(classStudents.classId, classId), inArray(classStudents.studentId, studentIds)))
    .run();
}

export function clearStudentClasses(studentIds: number[]) {
  if (studentIds.length === 0) return;
  db.delete(classStudents).where(inArray(classStudents.studentId, studentIds)).run();
}

export function setStudentsClass(studentIds: number[], classId: number | null) {
  if (studentIds.length === 0) return;
  if (classId) { assignStudentsToClass(classId, studentIds); return; }
  clearStudentClasses(studentIds);
}

export function getAllClassAssignments(): ClassAssignments {
  const teacherAssignments = db
    .select({ class_id: classTeachers.classId, teacher_id: classTeachers.teacherId })
    .from(classTeachers)
    .innerJoin(classes, eq(classTeachers.classId, classes.id))
    .innerJoin(users, eq(classTeachers.teacherId, users.id))
    .where(and(isNull(users.deletedAt), eq(users.role, 'teacher')))
    .all();
  const studentAssignments = db
    .select({ class_id: classStudents.classId, student_id: classStudents.studentId })
    .from(classStudents)
    .innerJoin(classes, eq(classStudents.classId, classes.id))
    .innerJoin(users, eq(classStudents.studentId, users.id))
    .where(and(isNull(users.deletedAt), eq(users.role, 'student')))
    .all();
  return { teachers: teacherAssignments, students: studentAssignments };
}

export function getClassStudents(classId: number) {
  return db
    .select({ id: users.id, uid: users.uid, name: users.name, createdAt: users.createdAt })
    .from(classStudents)
    .innerJoin(users, eq(classStudents.studentId, users.id))
    .where(and(eq(classStudents.classId, classId), eq(users.role, 'student'), isNull(users.deletedAt)))
    .orderBy(desc(users.id))
    .all()
    .map(toStudentSummary);
}

export function getTeacherStudents(teacherId: number) {
  return db
    .select({ id: users.id, uid: users.uid, name: users.name, createdAt: users.createdAt })
    .from(classTeachers)
    .innerJoin(classStudents, eq(classTeachers.classId, classStudents.classId))
    .innerJoin(users, eq(classStudents.studentId, users.id))
    .where(and(eq(classTeachers.teacherId, teacherId), eq(users.role, 'student'), isNull(users.deletedAt)))
    .orderBy(desc(users.id))
    .all()
    .map(toStudentSummary);
}

export function searchStudents(query: string, visibleStudentIds?: Set<number>, classIds?: number[]): StudentWithClassSummary[] {
  const conditions = [eq(users.role, 'student'), isNull(users.deletedAt)];
  const searchCondition = userSearchCondition(query);
  if (searchCondition) conditions.push(searchCondition);
  if (visibleStudentIds) {
    const ids = [...visibleStudentIds];
    conditions.push(ids.length > 0 ? inArray(users.id, ids) : sql`1 = 0`);
  }
  if (classIds) {
    conditions.push(classIds.length > 0 ? inArray(classStudents.classId, classIds) : sql`1 = 0`);
  }
  return db
    .select({
      id: users.id, uid: users.uid, name: users.name, createdAt: users.createdAt,
      class_id: classStudents.classId, class_cid: classes.cid, class_name: classes.name
    })
    .from(users)
    .leftJoin(classStudents, eq(classStudents.studentId, users.id))
    .leftJoin(classes, eq(classStudents.classId, classes.id))
    .where(and(...conditions))
    .orderBy(desc(users.id))
    .all()
    .map((row) => ({
      id: row.id, uid: row.uid, name: row.name, created_at: row.createdAt,
      class_id: row.class_id, class_cid: row.class_cid, class_name: row.class_name
    }));
}

export function searchStudentsForClassAssignment(query: string, classId: number | null): StudentWithClassSummary[] {
  const conditions = [eq(users.role, 'student'), isNull(users.deletedAt)];
  const searchCondition = userSearchCondition(query);
  if (searchCondition) conditions.push(searchCondition);
  conditions.push(classId ? sql`(${classStudents.classId} is null or ${classStudents.classId} = ${classId})` : sql`${classStudents.classId} is null`);
  return db
    .select({
      id: users.id, uid: users.uid, name: users.name, createdAt: users.createdAt,
      class_id: classStudents.classId, class_cid: classes.cid, class_name: classes.name
    })
    .from(users)
    .leftJoin(classStudents, eq(classStudents.studentId, users.id))
    .leftJoin(classes, eq(classStudents.classId, classes.id))
    .where(and(...conditions))
    .orderBy(desc(users.id))
    .all()
    .map((row) => ({
      id: row.id, uid: row.uid, name: row.name, created_at: row.createdAt,
      class_id: row.class_id, class_cid: row.class_cid, class_name: row.class_name
    }));
}

export function getAssignedStudents(): StudentWithClassSummary[] {
  return db
    .select({
      id: users.id, uid: users.uid, name: users.name, createdAt: users.createdAt,
      class_id: classStudents.classId, class_cid: classes.cid, class_name: classes.name
    })
    .from(classStudents)
    .innerJoin(users, eq(classStudents.studentId, users.id))
    .innerJoin(classes, eq(classStudents.classId, classes.id))
    .where(and(eq(users.role, 'student'), isNull(users.deletedAt)))
    .orderBy(desc(users.id))
    .all()
    .map((row) => ({
      id: row.id, uid: row.uid, name: row.name, created_at: row.createdAt,
      class_id: row.class_id, class_cid: row.class_cid, class_name: row.class_name
    }));
}

export function getTeacherStudentIds(teacherId: number) {
  return db
    .select({ studentId: classStudents.studentId })
    .from(classTeachers)
    .innerJoin(classStudents, eq(classTeachers.classId, classStudents.classId))
    .where(eq(classTeachers.teacherId, teacherId))
    .all()
    .map((row) => row.studentId);
}

export function getTeacherClassIds(teacherId: number) {
  return db
    .select({ classId: classTeachers.classId })
    .from(classTeachers)
    .where(eq(classTeachers.teacherId, teacherId))
    .all()
    .map((row) => row.classId);
}

export function getStudentClassId(studentId: number) {
  return db
    .select({ classId: classStudents.classId })
    .from(classStudents)
    .where(eq(classStudents.studentId, studentId))
    .get()?.classId ?? null;
}

export function getClassesForTask(taskId: number): ClassSummary[] {
  return db
    .select({ id: classes.id, cid: classes.cid, name: classes.name, createdAt: classes.createdAt })
    .from(practiceTaskClasses)
    .innerJoin(classes, eq(practiceTaskClasses.classId, classes.id))
    .where(eq(practiceTaskClasses.taskId, taskId))
    .orderBy(classes.cid)
    .all()
    .map(toClassSummary);
}

export function allocateClassCid() {
  const latest = db
    .select({ cid: classes.cid }).from(classes)
    .orderBy(desc(classes.id)).limit(1).get();
  const nextNumber = latest ? parseUidNumber(latest.cid) + 1 : 1;
  return `C${nextNumber.toString(16).padStart(4, '0')}`;
}
