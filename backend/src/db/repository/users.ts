import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { hashPassword, hashPasswordSync, hashPasswords } from '../../auth/password';
import { appConfig } from '../../config';
import type { CreateUserResult, UserRole, UserSummary } from '../../models';
import { userRoles } from '../../models';
import { getPinyinInitials } from '../../pinyin';
import { db } from '../client';
import { activeUserById, activeUserByUid, generatePlainPassword, nowIso, toUser, toUserSummary, userSearchCondition, toStudentSummary } from '../helpers';
import { classStudents, classTeachers, practiceRecords, users } from '../schema';

export function findUserById(id: number) {
  const row = db.select().from(users).where(activeUserById(id)).get();
  return row ? toUser(row) : undefined;
}

export function findUserByUid(uid: number) {
  const row = db.select().from(users).where(activeUserByUid(uid)).get();
  return row ? toUser(row) : undefined;
}

export function findStudentByUid(uid: number) {
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.id, uid), eq(users.role, 'student'), isNull(users.deletedAt)))
    .get();
  return row ? toUser(row) : undefined;
}

export function findStudentsByClassAndName(classId: number, name: string) {
  return db
    .select({ user: users })
    .from(classStudents)
    .innerJoin(users, eq(classStudents.studentId, users.id))
    .where(and(eq(classStudents.classId, classId), eq(users.role, 'student'), eq(users.name, name), isNull(users.deletedAt)))
    .all()
    .map((row) => toUser(row.user));
}

export function findStaffByIdentifier(identifier: string) {
  const trimmed = identifier.trim();
  const parsedId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const identityCondition = parsedId
    ? sql`(${users.id} = ${parsedId} or ${users.name} = ${trimmed})`
    : eq(users.name, trimmed);
  return db
    .select()
    .from(users)
    .where(and(inArray(users.role, ['teacher', 'admin']), identityCondition, isNull(users.deletedAt)))
    .all()
    .map(toUser);
}

export function findTeachersByUids(uids: number[]) {
  if (uids.length === 0) return [];
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, uids), eq(users.role, 'teacher'), isNull(users.deletedAt)))
    .all()
    .map((row) => ({ ...row, uid: row.id }));
}

export function getUsersByRole(role?: UserRole) {
  const where = role
    ? and(eq(users.role, role), isNull(users.deletedAt))
    : isNull(users.deletedAt);
  return db
    .select({ id: users.id, role: users.role, name: users.name, englishName: users.englishName, createdAt: users.createdAt })
    .from(users)
    .where(where)
    .orderBy(desc(users.id))
    .all()
    .map(toUserSummary);
}

export function searchUsersByRole(role: UserRole, query: string) {
  const searchCondition = userSearchCondition(query);
  const where = searchCondition
    ? and(eq(users.role, role), isNull(users.deletedAt), searchCondition)
    : and(eq(users.role, role), isNull(users.deletedAt));
  return db
    .select({ id: users.id, role: users.role, name: users.name, englishName: users.englishName, createdAt: users.createdAt })
    .from(users)
    .where(where)
    .orderBy(desc(users.id))
    .all()
    .map(toUserSummary);
}

export function getAllStudents() {
  return db
    .select({ id: users.id, name: users.name, englishName: users.englishName, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.role, 'student'), isNull(users.deletedAt)))
    .orderBy(desc(users.id))
    .all()
    .map(toStudentSummary);
}

export async function createUser(name: string, role: UserRole, englishName: string | null = null): Promise<CreateUserResult> {
  const password = generatePlainPassword();
  const createdAt = nowIso();
  const hashedPassword = await hashPassword(password, 'low');
  const result = db.insert(users).values({
    password: hashedPassword, role, name, englishName,
    nameInitials: getPinyinInitials(name),
    createdAt, deletedAt: null
  }).run();
  const id = Number(result.lastInsertRowid);
  return { id, uid: id, role, name, english_name: englishName, password };
}

export async function createUsers(entries: Array<{ name: string; englishName?: string | null; role: UserRole; classId?: number | null }>) {
  if (entries.length === 0) return [];
  const passwords = entries.map(() => generatePlainPassword());
  const hashes = await hashPasswords(passwords, 'low');
  const createdAt = nowIso();
  const rows = entries.map((entry, index) => ({
    password: hashes[index]!, role: entry.role,
    name: entry.name, englishName: entry.englishName ?? null,
    nameInitials: getPinyinInitials(entry.name),
    createdAt, deletedAt: null as null
  }));
  return db.transaction((tx) => {
    const inserted = tx.insert(users).values(rows).run();
    const lastInsertedId = Number(inserted.lastInsertRowid);
    const firstInsertedId = lastInsertedId - rows.length + 1;
    const studentAssignments = entries.flatMap((entry, index) => {
      if (entry.role !== 'student' || !entry.classId) return [];
      return [{ classId: entry.classId, studentId: firstInsertedId + index, createdAt: nowIso() }];
    });
    const teacherAssignments = entries.flatMap((entry, index) => {
      if (entry.role !== 'teacher' || !entry.classId) return [];
      return [{ classId: entry.classId, teacherId: firstInsertedId + index, createdAt: nowIso() }];
    });
    if (studentAssignments.length > 0) tx.insert(classStudents).values(studentAssignments).run();
    if (teacherAssignments.length > 0) tx.insert(classTeachers).values(teacherAssignments).run();
    return rows.map((row, index) => ({
      id: firstInsertedId + index, uid: firstInsertedId + index, role: row.role, name: row.name,
      english_name: row.englishName, password: passwords[index]!
    }));
  });
}

export function updateUserName(id: number, name: string, englishName?: string | null) {
  const values: Partial<typeof users.$inferInsert> = { name, nameInitials: getPinyinInitials(name) };
  if (englishName !== undefined) values.englishName = englishName;
  const result = db.update(users).set(values).where(activeUserById(id)).run();
  return result.changes > 0;
}

export function updateUserPassword(id: number, hashedPassword: string) {
  const result = db.update(users).set({ password: hashedPassword }).where(activeUserById(id)).run();
  return result.changes > 0;
}

export async function resetUserPasswords(ids: number[]) {
  if (ids.length === 0) return [];
  const activeUsers = db
    .select({ id: users.id, role: users.role, name: users.name, englishName: users.englishName })
    .from(users).where(and(inArray(users.id, ids), isNull(users.deletedAt))).all();
  if (activeUsers.length === 0) return [];
  const passwords = activeUsers.map(() => generatePlainPassword());
  const hashes = await hashPasswords(passwords, 'low');
  return db.transaction((tx) => activeUsers.map((user, index) => {
    tx.update(users).set({ password: hashes[index]! }).where(eq(users.id, user.id)).run();
    return { id: user.id, uid: user.id, role: user.role as UserRole, name: user.name, english_name: user.englishName, password: passwords[index]! };
  }));
}

export function deleteUser(id: number) {
  const user = db.select().from(users).where(activeUserById(id)).get();
  if (!user) return false;
  const now = nowIso();
  db.update(practiceRecords)
    .set({ studentUidSnapshot: user.id })
    .where(and(eq(practiceRecords.studentId, user.id), sql`${practiceRecords.studentUidSnapshot} is null`))
    .run();
  if (user.role === 'teacher') db.delete(classTeachers).where(eq(classTeachers.teacherId, user.id)).run();
  if (user.role === 'student') db.delete(classStudents).where(eq(classStudents.studentId, user.id)).run();
  db.update(users).set({ deletedAt: now }).where(eq(users.id, user.id)).run();
  return true;
}

export function isValidRole(role: unknown): role is UserRole {
  return userRoles.includes(role as UserRole);
}

export function seedDefaultAdmin() {
  const admins = db.select({ id: users.id }).from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.deletedAt)))
    .orderBy(users.id)
    .all();
  if (admins.length > 1) {
    const now = nowIso();
    for (let i = 1; i < admins.length; i++) {
      db.update(users).set({ deletedAt: now }).where(eq(users.id, admins[i]!.id)).run();
      console.log("清理重复管理员账号 (UID %d)", admins[i]!.id);
    }
  }
  if (admins.length > 0) return;
  const password = appConfig.initial_admin_password;
  const result = db.insert(users).values([{
    password: hashPasswordSync(password, 'low'),
    role: 'admin',
    name: 'admin',
    englishName: null,
    nameInitials: getPinyinInitials('admin'),
    createdAt: nowIso(),
    deletedAt: null
  }]).run();
  console.log("欢迎使用 Praxis，初始 uid：%s，初始密码：%s", Number(result.lastInsertRowid), password);
}
