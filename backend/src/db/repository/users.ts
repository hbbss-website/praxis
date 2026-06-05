import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { hashPassword, hashPasswordSync, hashPasswords } from '../../auth/password';
import { appConfig } from '../../config';
import type { CreateUserResult, UserRole, UserSummary } from '../../models';
import { userRoles } from '../../models';
import { getPinyinInitials } from '../../pinyin';
import { db } from '../client';
import { activeUserById, activeUserByUid, generatePlainPassword, nowIso, parseUidNumber, rolePrefixes, toUser, toUserSummary, userSearchCondition, toStudentSummary } from '../helpers';
import { classStudents, classTeachers, practiceRecords, users } from '../schema';

export function findUserById(id: number) {
  const row = db.select().from(users).where(activeUserById(id)).get();
  return row ? toUser(row) : undefined;
}

export function findUserByUid(uid: string) {
  const row = db.select().from(users).where(activeUserByUid(uid)).get();
  return row ? toUser(row) : undefined;
}

export function findTeachersByUids(uids: string[]) {
  if (uids.length === 0) return [];
  return db
    .select({ id: users.id, uid: users.uid })
    .from(users)
    .where(and(inArray(users.uid, uids), eq(users.role, 'teacher'), isNull(users.deletedAt)))
    .all();
}

export function getUsersByRole(role?: UserRole) {
  const where = role
    ? and(eq(users.role, role), isNull(users.deletedAt))
    : isNull(users.deletedAt);
  return db
    .select({ id: users.id, uid: users.uid, role: users.role, name: users.name, createdAt: users.createdAt })
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
    .select({ id: users.id, uid: users.uid, role: users.role, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(where)
    .orderBy(desc(users.id))
    .all()
    .map(toUserSummary);
}

export function getAllStudents() {
  return db
    .select({ id: users.id, uid: users.uid, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.role, 'student'), isNull(users.deletedAt)))
    .orderBy(desc(users.id))
    .all()
    .map(toStudentSummary);
}

export async function createUser(name: string, role: UserRole): Promise<CreateUserResult> {
  const password = generatePlainPassword();
  const createdAt = nowIso();
  const uid = allocateUids([role])[0]!;
  const hashedPassword = await hashPassword(password, 'low');
  const result = db.insert(users).values({
    uid, password: hashedPassword, role, name,
    nameInitials: getPinyinInitials(name),
    createdAt, deletedAt: null
  }).run();
  return { id: Number(result.lastInsertRowid), uid, role, name, password };
}

export async function createUsers(entries: Array<{ name: string; role: UserRole; classId?: number | null }>) {
  if (entries.length === 0) return [];
  const passwords = entries.map(() => generatePlainPassword());
  const hashes = await hashPasswords(passwords, 'low');
  const createdAt = nowIso();
  const uids = allocateUids(entries.map((entry) => entry.role));
  const rows = entries.map((entry, index) => ({
    uid: uids[index]!, password: hashes[index]!, role: entry.role,
    name: entry.name, nameInitials: getPinyinInitials(entry.name),
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
      id: firstInsertedId + index, uid: row.uid, role: row.role, name: row.name, password: passwords[index]!
    }));
  });
}

export function updateUserName(id: number, name: string) {
  const result = db.update(users).set({ name, nameInitials: getPinyinInitials(name) }).where(activeUserById(id)).run();
  return result.changes > 0;
}

export function updateUserPassword(id: number, hashedPassword: string) {
  const result = db.update(users).set({ password: hashedPassword }).where(activeUserById(id)).run();
  return result.changes > 0;
}

export async function resetUserPasswords(ids: number[]) {
  if (ids.length === 0) return [];
  const activeUsers = db
    .select({ id: users.id, uid: users.uid, role: users.role, name: users.name })
    .from(users).where(and(inArray(users.id, ids), isNull(users.deletedAt))).all();
  if (activeUsers.length === 0) return [];
  const passwords = activeUsers.map(() => generatePlainPassword());
  const hashes = await hashPasswords(passwords, 'low');
  return db.transaction((tx) => activeUsers.map((user, index) => {
    tx.update(users).set({ password: hashes[index]! }).where(eq(users.id, user.id)).run();
    return { id: user.id, uid: user.uid, role: user.role as UserRole, name: user.name, password: passwords[index]! };
  }));
}

export function deleteUser(id: number) {
  const user = db.select().from(users).where(activeUserById(id)).get();
  if (!user) return false;
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(practiceRecords)
      .set({ studentUidSnapshot: user.uid })
      .where(and(eq(practiceRecords.studentId, user.id), sql`${practiceRecords.studentUidSnapshot} is null`))
      .run();
    if (user.role === 'teacher') tx.delete(classTeachers).where(eq(classTeachers.teacherId, user.id)).run();
    tx.update(users).set({ deletedAt: now }).where(eq(users.id, user.id)).run();
  });
  return true;
}

export function isValidRole(role: unknown): role is UserRole {
  return userRoles.includes(role as UserRole);
}

export function allocateUids(roles: UserRole[]) {
  const nextNumbers = new Map<UserRole, number>();
  for (const role of new Set(roles)) {
    const latest = db
      .select({ uid: users.uid }).from(users)
      .where(eq(users.role, role))
      .orderBy(desc(users.id)).limit(1).get();
    nextNumbers.set(role, latest ? parseUidNumber(latest.uid) + 1 : 1);
  }
  return roles.map((role) => {
    const nextNumber = nextNumbers.get(role) ?? 1;
    nextNumbers.set(role, nextNumber + 1);
    return `${rolePrefixes[role]}${nextNumber.toString(16).padStart(5, '0')}`;
  });
}

export function seedDefaultAdmin() {
  const row = db.select({ count: sql<number>`count(*)` }).from(users).get();
  if (row?.count && Number(row.count) > 0) return;
  const password = appConfig.initial_admin_password;
  db.insert(users).values([{
    uid: 'A00001',
    password: hashPasswordSync(password, 'low'),
    role: 'admin',
    name: '超级奶龙',
    nameInitials: getPinyinInitials('超级奶龙'),
    createdAt: nowIso(),
    deletedAt: null
  }]).run();
  console.log("欢迎使用 Praxis，初始 uid：A00001，初始密码：%s", password);
}
