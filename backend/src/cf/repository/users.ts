import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { D1DB } from '../db';
import type { CFConfig } from '../config';
import { hashPassword, hashPasswordSync, hashPasswords } from '../password';
import type { CreateUserResult, UserRole, UserSummary } from '../../models';
import { userRoles } from '../../models';
import { getPinyinInitials } from '../../pinyin';
import { generatePlainPassword, nowIso } from './helpers';
import { classStudents, classTeachers, practiceRecords, users } from '../../db/schema';

function toUser(row: typeof users.$inferSelect) {
  return {
    id: row.id, uid: row.id, password: row.password,
    role: row.role as 'admin' | 'teacher' | 'student',
    name: row.name, english_name: row.englishName, created_at: row.createdAt
  };
}

function toUserSummary(row: Pick<typeof users.$inferSelect, 'id' | 'role' | 'name' | 'englishName' | 'createdAt'>): UserSummary {
  return { id: row.id, uid: row.id, role: row.role as UserRole, name: row.name, english_name: row.englishName, created_at: row.createdAt };
}

function toStudentSummary(row: Pick<typeof users.$inferSelect, 'id' | 'name' | 'englishName' | 'createdAt'>) {
  return { id: row.id, uid: row.id, name: row.name, english_name: row.englishName, created_at: row.createdAt };
}

function activeById(id: number) { return and(eq(users.id, id), isNull(users.deletedAt)); }

function userSearchCondition(query: string) {
  const q = query.trim().replace(/[%_]/g, (c) => `\\${c}`);
  if (!q) return undefined;
  const p = `%${q}%`;
  return sql`(${users.id} like ${p} escape '\\' or ${users.name} like ${p} escape '\\' or coalesce(${users.englishName},'') like ${p} escape '\\' or ${users.nameInitials} like ${p} escape '\\')`;
}

export async function findUserById(db: D1DB, id: number) {
  const row = await db.select().from(users).where(activeById(id)).get();
  return row ? toUser(row) : undefined;
}

export async function findUserByUid(db: D1DB, uid: number) {
  const row = await db.select().from(users).where(and(eq(users.id, uid), isNull(users.deletedAt))).get();
  return row ? toUser(row) : undefined;
}

export async function findStudentByUid(db: D1DB, uid: number) {
  const row = await db.select().from(users).where(and(eq(users.id, uid), eq(users.role, 'student'), isNull(users.deletedAt))).get();
  return row ? toUser(row) : undefined;
}

export async function findStudentsByClassAndName(db: D1DB, classId: number, name: string) {
  const rows = await db.select({ user: users }).from(classStudents)
    .innerJoin(users, eq(classStudents.studentId, users.id))
    .where(and(eq(classStudents.classId, classId), eq(users.role, 'student'), eq(users.name, name), isNull(users.deletedAt)))
    .all();
  return rows.map((r) => toUser(r.user));
}

export async function findStaffByIdentifier(db: D1DB, identifier: string) {
  const trimmed = identifier.trim();
  const parsedId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const cond = parsedId ? sql`(${users.id} = ${parsedId} or ${users.name} = ${trimmed})` : eq(users.name, trimmed);
  const rows = await db.select().from(users)
    .where(and(inArray(users.role, ['teacher', 'admin']), cond, isNull(users.deletedAt))).all();
  return rows.map(toUser);
}

export async function findTeachersByUids(db: D1DB, uids: number[]) {
  if (!uids.length) return [];
  const rows = await db.select({ id: users.id }).from(users)
    .where(and(inArray(users.id, uids), eq(users.role, 'teacher'), isNull(users.deletedAt))).all();
  return rows.map((r) => ({ ...r, uid: r.id }));
}

export async function getUsersByRole(db: D1DB, role?: UserRole) {
  const where = role ? and(eq(users.role, role), isNull(users.deletedAt)) : isNull(users.deletedAt);
  const rows = await db.select({ id: users.id, role: users.role, name: users.name, englishName: users.englishName, createdAt: users.createdAt })
    .from(users).where(where).orderBy(desc(users.id)).all();
  return rows.map(toUserSummary);
}

export async function searchUsersByRole(db: D1DB, role: UserRole, query: string) {
  const sc = userSearchCondition(query);
  const where = sc ? and(eq(users.role, role), isNull(users.deletedAt), sc) : and(eq(users.role, role), isNull(users.deletedAt));
  const rows = await db.select({ id: users.id, role: users.role, name: users.name, englishName: users.englishName, createdAt: users.createdAt })
    .from(users).where(where).orderBy(desc(users.id)).all();
  return rows.map(toUserSummary);
}

export async function getAllStudents(db: D1DB) {
  const rows = await db.select({ id: users.id, name: users.name, englishName: users.englishName, createdAt: users.createdAt })
    .from(users).where(and(eq(users.role, 'student'), isNull(users.deletedAt))).orderBy(desc(users.id)).all();
  return rows.map(toStudentSummary);
}

export async function createUser(db: D1DB, cfg: CFConfig, name: string, role: UserRole, englishName: string | null = null): Promise<CreateUserResult> {
  const password = generatePlainPassword(cfg.generated_password_length);
  const createdAt = nowIso();
  const hashed = await hashPassword(password, 'standard');
  const [row] = await db.insert(users).values({
    password: hashed, role, name, englishName,
    nameInitials: getPinyinInitials(name),
    createdAt, deletedAt: null
  }).returning({ id: users.id });
  const id = row!.id;
  return { id, uid: id, role, name, english_name: englishName, password };
}

export async function createUsers(db: D1DB, cfg: CFConfig, entries: Array<{ name: string; englishName?: string | null; role: UserRole; classId?: number | null }>) {
  if (!entries.length) return [];
  const passwords = entries.map(() => generatePlainPassword(cfg.generated_password_length));
  const hashes = await hashPasswords(passwords, 'standard');
  const createdAt = nowIso();
  const rows = entries.map((e, i) => ({
    password: hashes[i]!, role: e.role, name: e.name, englishName: e.englishName ?? null,
    nameInitials: getPinyinInitials(e.name), createdAt, deletedAt: null as null
  }));
  const inserted = await db.insert(users).values(rows).returning({ id: users.id });
  const studentAssignments = entries.flatMap((e, i) =>
    e.role === 'student' && e.classId ? [{ classId: e.classId, studentId: inserted[i]!.id, createdAt: nowIso() }] : []
  );
  const teacherAssignments = entries.flatMap((e, i) =>
    e.role === 'teacher' && e.classId ? [{ classId: e.classId, teacherId: inserted[i]!.id, createdAt: nowIso() }] : []
  );
  if (studentAssignments.length) await db.insert(classStudents).values(studentAssignments).run();
  if (teacherAssignments.length) await db.insert(classTeachers).values(teacherAssignments).run();
  return inserted.map((r, i) => ({ id: r.id, uid: r.id, role: rows[i]!.role, name: rows[i]!.name, english_name: rows[i]!.englishName, password: passwords[i]! }));
}

export async function updateUserName(db: D1DB, id: number, name: string, englishName?: string | null) {
  const values: Partial<typeof users.$inferInsert> = { name, nameInitials: getPinyinInitials(name) };
  if (englishName !== undefined) values.englishName = englishName;
  await db.update(users).set(values).where(activeById(id)).run();
  return true;
}

export async function updateUserPassword(db: D1DB, id: number, hashedPassword: string) {
  await db.update(users).set({ password: hashedPassword }).where(activeById(id)).run();
  return true;
}

export async function resetUserPasswords(db: D1DB, cfg: CFConfig, ids: number[]) {
  if (!ids.length) return [];
  const activeUsers = await db.select({ id: users.id, role: users.role, name: users.name, englishName: users.englishName })
    .from(users).where(and(inArray(users.id, ids), isNull(users.deletedAt))).all();
  if (!activeUsers.length) return [];
  const passwords = activeUsers.map(() => generatePlainPassword(cfg.generated_password_length));
  const hashes = await hashPasswords(passwords, 'standard');
  for (let i = 0; i < activeUsers.length; i++) {
    await db.update(users).set({ password: hashes[i]! }).where(eq(users.id, activeUsers[i]!.id)).run();
  }
  return activeUsers.map((u, i) => ({ id: u.id, uid: u.id, role: u.role as UserRole, name: u.name, english_name: u.englishName, password: passwords[i]! }));
}

export async function deleteUser(db: D1DB, id: number) {
  const user = await db.select().from(users).where(activeById(id)).get();
  if (!user) return false;
  const now = nowIso();
  await db.update(practiceRecords)
    .set({ studentUidSnapshot: user.id })
    .where(and(eq(practiceRecords.studentId, user.id), sql`${practiceRecords.studentUidSnapshot} is null`))
    .run();
  if (user.role === 'teacher') await db.delete(classTeachers).where(eq(classTeachers.teacherId, user.id)).run();
  if (user.role === 'student') await db.delete(classStudents).where(eq(classStudents.studentId, user.id)).run();
  await db.update(users).set({ deletedAt: now }).where(eq(users.id, user.id)).run();
  return true;
}

export function isValidRole(role: unknown): role is UserRole {
  return userRoles.includes(role as UserRole);
}

export async function seedDefaultAdmin(db: D1DB, cfg: CFConfig) {
  const admins = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.deletedAt)))
    .orderBy(users.id)
    .all();
  if (admins.length > 1) {
    const now = nowIso();
    for (let i = 1; i < admins.length; i++) {
      await db.update(users).set({ deletedAt: now }).where(eq(users.id, admins[i]!.id)).run();
      console.log('清理重复管理员账号 (UID %d)', admins[i]!.id);
    }
  }
  if (admins.length > 0) return;
  const password = cfg.initial_admin_password;
  const hashed = await hashPassword(password, 'standard');
  const [inserted] = await db.insert(users).values([{
    password: hashed, role: 'admin', name: 'admin', englishName: null,
    nameInitials: getPinyinInitials('admin'),
    createdAt: nowIso(), deletedAt: null
  }]).returning({ id: users.id });
  console.log('欢迎使用 Praxis，初始 uid：%s，初始密码：%s', inserted?.id, password);
}
