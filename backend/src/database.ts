import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { and, desc, eq, getTableColumns, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { hashPassword, hashPasswordSync, hashPasswords } from './auth/password';
import { appConfig } from './config';
import { db } from './db/client';
import { ensureDatabaseSchema } from './db/setup';
import { classes, classStudents, classTeachers, notifications, practiceRecords, tempUploadDeletions, users } from './db/schema';
import type {
  AppNotification,
  ClassAssignments,
  ClassSummary,
  CreateRecordInput,
  CreateUserResult,
  NotificationType,
  PracticeRecord,
  RecordFilters,
  RecordStatistics,
  StudentRecord,
  StudentSummary,
  StudentWithClassSummary,
  TeacherRecord,
  TeacherRecordSummary,
  TeacherStatistics,
  UpdateRecordInput,
  User,
  UserRole,
  UserSummary
} from './models';
import { MAX_RECORD_IMAGES, userRoles } from './models';
import { getPinyinInitials } from './pinyin';

const uploadDir = path.resolve(process.cwd(), 'backend/data/uploads');
const tmpUploadDir = path.resolve(process.cwd(), 'backend/data/tmp-uploads');
const uploadPathPattern = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const tmpUploadPathPattern = /^\/tmp-uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const deletedUserName = '已删除用户';
const generatedPasswordLength = 8;
const rolePrefixes: Record<UserRole, string> = {
  admin: 'A',
  teacher: 'T',
  student: 'S'
};

type UserRow = typeof users.$inferSelect;
type ClassRow = typeof classes.$inferSelect;
type PracticeRecordRow = typeof practiceRecords.$inferSelect;
const practiceRecordColumns = getTableColumns(practiceRecords);

function nowIso() {
  return new Date().toISOString();
}

function generatePlainPassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(generatedPasswordLength);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    uid: row.uid,
    password: row.password,
    role: row.role as UserRole,
    name: row.name,
    created_at: row.createdAt
  };
}

function toPracticeRecord(row: PracticeRecordRow): PracticeRecord {
  const imagePaths = normalizeRecordImagePaths(row.imagePaths);

  return {
    id: row.id,
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

function toStudentSummary(row: Pick<UserRow, 'id' | 'uid' | 'name' | 'createdAt'>): StudentSummary {
  return {
    id: row.id,
    uid: row.uid,
    name: row.name,
    created_at: row.createdAt
  };
}

function toUserSummary(row: Pick<UserRow, 'id' | 'uid' | 'role' | 'name' | 'createdAt'>): UserSummary {
  return {
    id: row.id,
    uid: row.uid,
    role: row.role as UserRole,
    name: row.name,
    created_at: row.createdAt
  };
}

function toClassSummary(row: Pick<ClassRow, 'id' | 'cid' | 'name' | 'createdAt'>): ClassSummary {
  return {
    id: row.id,
    cid: row.cid,
    name: row.name,
    created_at: row.createdAt
  };
}

function toNotification(row: typeof notifications.$inferSelect): AppNotification {
  return {
    id: row.id,
    student_id: row.studentId,
    type: row.type as NotificationType,
    message: row.message,
    is_read: row.isRead,
    created_at: row.createdAt
  };
}

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function activeUserById(id: number) {
  return and(eq(users.id, id), isNull(users.deletedAt));
}

function activeUserByUid(uid: string) {
  return and(eq(users.uid, uid), isNull(users.deletedAt));
}

function buildRecordWhere(filters: RecordFilters = {}, visibleStudentIds?: Set<number>) {
  const conditions = [];

  if (visibleStudentIds) {
    const ids = [...visibleStudentIds];

    if (ids.length === 0) {
      conditions.push(sql`1 = 0`);
    } else {
      conditions.push(inArray(practiceRecords.studentId, ids));
    }
  }

  if (filters.student_id) {
    conditions.push(eq(practiceRecords.studentId, filters.student_id));
  }

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

  if (filters.status) {
    conditions.push(eq(practiceRecords.status, filters.status));
  }

  if (filters.practice_after) {
    conditions.push(gte(practiceRecords.practiceDate, filters.practice_after));
  }

  if (filters.practice_before) {
    conditions.push(lte(practiceRecords.practiceDate, filters.practice_before));
  }

  if (filters.created_after) {
    conditions.push(gte(practiceRecords.createdAt, filters.created_after));
  }

  if (filters.created_before) {
    conditions.push(lte(practiceRecords.createdAt, filters.created_before));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function recordIdentitySelect() {
  return {
    student_name: sql<string>`case when ${users.id} is null or ${users.deletedAt} is not null then ${deletedUserName} else ${users.name} end`,
    student_uid: sql<string>`case when ${users.id} is null then coalesce(${practiceRecords.studentUidSnapshot}, '') else ${users.uid} end`
  };
}

function normalizeSearchQuery(query: string) {
  return query.trim().replace(/[%_]/g, (value) => `\\${value}`);
}

function parseImagePaths(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && uploadPathPattern.test(item)) : [];
  } catch {
    return [];
  }
}

function parseRecordImagePaths(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && tmpUploadPathPattern.test(item))
      : [];
  } catch {
    return [];
  }
}

function normalizeRecordImagePaths(value: string | null) {
  const imagePaths = parseImagePaths(value);
  return [...new Set(imagePaths)].slice(0, MAX_RECORD_IMAGES);
}

function normalizeIncomingRecordImagePaths(value: string | null) {
  const imagePaths = parseRecordImagePaths(value);
  return [...new Set(imagePaths)].slice(0, MAX_RECORD_IMAGES);
}

function serializeImagePaths(imagePaths: string[]) {
  return JSON.stringify([...new Set(imagePaths)].slice(0, MAX_RECORD_IMAGES));
}

function recordHasImagePathCondition(imagePath: string) {
  return sql`(${practiceRecords.coverImagePath} = ${imagePath} or ${practiceRecords.imagePaths} like ${`%"${imagePath}"%`})`;
}

function userSearchCondition(query: string) {
  const normalized = normalizeSearchQuery(query);

  if (!normalized) {
    return undefined;
  }

  const pattern = `%${normalized}%`;
  return sql`(${users.uid} like ${pattern} escape '\\' or ${users.name} like ${pattern} escape '\\' or ${users.nameInitials} like ${pattern} escape '\\')`;
}

class SQLiteDatabase {
  readonly MAX_DAILY_RECORDS = 50;

  constructor() {
    ensureDatabaseSchema();
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.mkdirSync(tmpUploadDir, { recursive: true });
    this.seedDefaults();
  }

  isValidRole(role: unknown): role is UserRole {
    return userRoles.includes(role as UserRole);
  }

  findUserById(id: number) {
    const row = db.select().from(users).where(activeUserById(id)).get();
    return row ? toUser(row) : undefined;
  }

  findUserByUid(uid: string) {
    const row = db.select().from(users).where(activeUserByUid(uid)).get();
    return row ? toUser(row) : undefined;
  }

  findTeachersByUids(uids: string[]) {
    if (uids.length === 0) {
      return [];
    }

    return db
      .select({
        id: users.id,
        uid: users.uid
      })
      .from(users)
      .where(and(inArray(users.uid, uids), eq(users.role, 'teacher'), isNull(users.deletedAt)))
      .all();
  }

  getUsersByRole(role?: UserRole) {
    const where = role
      ? and(eq(users.role, role), isNull(users.deletedAt))
      : isNull(users.deletedAt);

    return db
      .select({
        id: users.id,
        uid: users.uid,
        role: users.role,
        name: users.name,
        createdAt: users.createdAt
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.id))
      .all()
      .map(toUserSummary);
  }

  searchUsersByRole(role: UserRole, query: string) {
    const searchCondition = userSearchCondition(query);
    const where = searchCondition
      ? and(eq(users.role, role), isNull(users.deletedAt), searchCondition)
      : and(eq(users.role, role), isNull(users.deletedAt));

    return db
      .select({
        id: users.id,
        uid: users.uid,
        role: users.role,
        name: users.name,
        createdAt: users.createdAt
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.id))
      .all()
      .map(toUserSummary);
  }

  getAllStudents() {
    return db
      .select({
        id: users.id,
        uid: users.uid,
        name: users.name,
        createdAt: users.createdAt
      })
      .from(users)
      .where(and(eq(users.role, 'student'), isNull(users.deletedAt)))
      .orderBy(desc(users.id))
      .all()
      .map(toStudentSummary);
  }

  async createUser(name: string, role: UserRole): Promise<CreateUserResult> {
    const password = generatePlainPassword();
    const createdAt = nowIso();
    const uid = this.allocateUids([role])[0]!;
    const hashedPassword = await hashPassword(password, 'low');
    const result = db.insert(users).values({
      uid,
      password: hashedPassword,
      role,
      name,
      nameInitials: getPinyinInitials(name),
      createdAt,
      deletedAt: null
    }).run();

    return {
      id: Number(result.lastInsertRowid),
      uid,
      role,
      name,
      password
    };
  }

  async createUsers(entries: Array<{ name: string; role: UserRole; classId?: number | null }>) {
    if (entries.length === 0) {
      return [];
    }

    const passwords = entries.map(() => generatePlainPassword());
    const hashes = await hashPasswords(passwords, 'low');
    const createdAt = nowIso();
    const uids = this.allocateUids(entries.map((entry) => entry.role));
    const rows = entries.map((entry, index) => ({
      uid: uids[index]!,
      password: hashes[index]!,
      role: entry.role,
      name: entry.name,
      nameInitials: getPinyinInitials(entry.name),
      createdAt,
      deletedAt: null as null
    }));

    return db.transaction((tx) => {
      const inserted = tx.insert(users).values(rows).run();
      const lastInsertedId = Number(inserted.lastInsertRowid);
      const firstInsertedId = lastInsertedId - rows.length + 1;

      const createdAt = nowIso();
      const studentAssignments = entries.flatMap((entry, index) => {
        const classId = entry.classId;

        if (entry.role !== 'student' || !classId) {
          return [];
        }

        return [{
          classId,
          studentId: firstInsertedId + index,
          createdAt
        }];
      });
      const teacherAssignments = entries.flatMap((entry, index) => {
        const classId = entry.classId;

        if (entry.role !== 'teacher' || !classId) {
          return [];
        }

        return [{
          classId,
          teacherId: firstInsertedId + index,
          createdAt
        }];
      });

      if (studentAssignments.length > 0) {
        tx.insert(classStudents).values(studentAssignments).run();
      }

      if (teacherAssignments.length > 0) {
        tx.insert(classTeachers).values(teacherAssignments).run();
      }

      return rows.map((row, index) => ({
        id: firstInsertedId + index,
        uid: row.uid,
        role: row.role,
        name: row.name,
        password: passwords[index]!
      }));
    });
  }

  updateUserName(id: number, name: string) {
    const result = db.update(users).set({ name, nameInitials: getPinyinInitials(name) }).where(activeUserById(id)).run();
    return result.changes > 0;
  }

  updateUserPassword(id: number, hashedPassword: string) {
    const result = db.update(users).set({ password: hashedPassword }).where(activeUserById(id)).run();
    return result.changes > 0;
  }

  async resetUserPasswords(ids: number[]) {
    if (ids.length === 0) {
      return [];
    }

    const activeUsers = db
      .select({
        id: users.id,
        uid: users.uid,
        role: users.role,
        name: users.name
      })
      .from(users)
      .where(and(inArray(users.id, ids), isNull(users.deletedAt)))
      .all();

    if (activeUsers.length === 0) {
      return [];
    }

    const passwords = activeUsers.map(() => generatePlainPassword());
    const hashes = await hashPasswords(passwords, 'low');

    return db.transaction((tx) => {
      return activeUsers.map((user, index) => {
        tx.update(users).set({ password: hashes[index]! }).where(eq(users.id, user.id)).run();

        return {
          id: user.id,
          uid: user.uid,
          role: user.role as UserRole,
          name: user.name,
          password: passwords[index]!
        };
      });
    });
  }

  deleteUser(id: number) {
    const user = db.select().from(users).where(activeUserById(id)).get();

    if (!user) {
      return false;
    }

    db.transaction((tx) => {
      tx.update(practiceRecords)
        .set({ studentUidSnapshot: user.uid })
        .where(and(eq(practiceRecords.studentId, user.id), sql`${practiceRecords.studentUidSnapshot} is null`))
        .run();

      if (user.role === 'teacher') {
        tx.delete(classTeachers).where(eq(classTeachers.teacherId, user.id)).run();
      }

      tx.update(users).set({ deletedAt: nowIso() }).where(eq(users.id, user.id)).run();
    });

    return true;
  }

  createClass(name: string) {
    const createdAt = nowIso();
    const cid = this.allocateClassCid();
    const result = db.insert(classes).values({
      cid,
      name,
      createdAt
    }).run();

    return {
      id: Number(result.lastInsertRowid),
      cid,
      name,
      created_at: createdAt
    } satisfies ClassSummary;
  }

  findClassById(id: number) {
    const row = db.select().from(classes).where(eq(classes.id, id)).get();
    return row ? toClassSummary(row) : null;
  }

  findClassByCid(cid: string) {
    const row = db.select().from(classes).where(eq(classes.cid, cid)).get();
    return row ? toClassSummary(row) : null;
  }

  updateClassName(id: number, name: string) {
    const result = db.update(classes).set({ name }).where(eq(classes.id, id)).run();
    return result.changes > 0;
  }

  getClasses() {
    return db
      .select({
        id: classes.id,
        cid: classes.cid,
        name: classes.name,
        createdAt: classes.createdAt
      })
      .from(classes)
      .orderBy(classes.cid)
      .all()
      .map(toClassSummary);
  }

  getTeacherClasses(teacherId: number) {
    return db
      .select({
        id: classes.id,
        cid: classes.cid,
        name: classes.name,
        createdAt: classes.createdAt
      })
      .from(classTeachers)
      .innerJoin(classes, eq(classTeachers.classId, classes.id))
      .innerJoin(users, eq(classTeachers.teacherId, users.id))
      .where(and(eq(classTeachers.teacherId, teacherId), eq(users.role, 'teacher'), isNull(users.deletedAt)))
      .orderBy(classes.cid)
      .all()
      .map(toClassSummary);
  }

  assignTeachersToClass(classId: number, teacherIds: number[]) {
    if (teacherIds.length === 0) {
      return;
    }

    const createdAt = nowIso();

    db.insert(classTeachers)
      .values(teacherIds.map((teacherId) => ({
        classId,
        teacherId,
        createdAt
      })))
      .onConflictDoNothing()
      .run();
  }

  removeTeachersFromClass(classId: number, teacherIds: number[]) {
    if (teacherIds.length === 0) {
      return;
    }

    db.delete(classTeachers)
      .where(and(eq(classTeachers.classId, classId), inArray(classTeachers.teacherId, teacherIds)))
      .run();
  }

  assignStudentsToClass(classId: number, studentIds: number[]) {
    if (studentIds.length === 0) {
      return;
    }

    const createdAt = nowIso();

    db.transaction((tx) => {
      tx.delete(classStudents).where(inArray(classStudents.studentId, studentIds)).run();
      tx.insert(classStudents).values(studentIds.map((studentId) => ({
        classId,
        studentId,
        createdAt
      }))).run();
    });
  }

  removeStudentsFromClass(classId: number, studentIds: number[]) {
    if (studentIds.length === 0) {
      return;
    }

    db.delete(classStudents)
      .where(and(eq(classStudents.classId, classId), inArray(classStudents.studentId, studentIds)))
      .run();
  }

  clearStudentClasses(studentIds: number[]) {
    if (studentIds.length === 0) {
      return;
    }

    db.delete(classStudents).where(inArray(classStudents.studentId, studentIds)).run();
  }

  setStudentsClass(studentIds: number[], classId: number | null) {
    if (studentIds.length === 0) {
      return;
    }

    if (classId) {
      this.assignStudentsToClass(classId, studentIds);
      return;
    }

    this.clearStudentClasses(studentIds);
  }

  getAllClassAssignments(): ClassAssignments {
    const teacherAssignments = db
      .select({
        class_id: classTeachers.classId,
        teacher_id: classTeachers.teacherId
      })
      .from(classTeachers)
      .innerJoin(classes, eq(classTeachers.classId, classes.id))
      .innerJoin(users, eq(classTeachers.teacherId, users.id))
      .where(and(isNull(users.deletedAt), eq(users.role, 'teacher')))
      .all();

    const studentAssignments = db
      .select({
        class_id: classStudents.classId,
        student_id: classStudents.studentId
      })
      .from(classStudents)
      .innerJoin(classes, eq(classStudents.classId, classes.id))
      .innerJoin(users, eq(classStudents.studentId, users.id))
      .where(and(isNull(users.deletedAt), eq(users.role, 'student')))
      .all();

    return {
      teachers: teacherAssignments,
      students: studentAssignments
    };
  }

  getClassStudents(classId: number) {
    return db
      .select({
        id: users.id,
        uid: users.uid,
        name: users.name,
        createdAt: users.createdAt
      })
      .from(classStudents)
      .innerJoin(users, eq(classStudents.studentId, users.id))
      .where(and(eq(classStudents.classId, classId), eq(users.role, 'student'), isNull(users.deletedAt)))
      .orderBy(desc(users.id))
      .all()
      .map(toStudentSummary);
  }

  getTeacherStudents(teacherId: number) {
    return db
      .select({
        id: users.id,
        uid: users.uid,
        name: users.name,
        createdAt: users.createdAt
      })
      .from(classTeachers)
      .innerJoin(classStudents, eq(classTeachers.classId, classStudents.classId))
      .innerJoin(users, eq(classStudents.studentId, users.id))
      .where(and(eq(classTeachers.teacherId, teacherId), eq(users.role, 'student'), isNull(users.deletedAt)))
      .orderBy(desc(users.id))
      .all()
      .map(toStudentSummary);
  }

  searchStudents(query: string, visibleStudentIds?: Set<number>, classIds?: number[]): StudentWithClassSummary[] {
    const conditions = [eq(users.role, 'student'), isNull(users.deletedAt)];
    const searchCondition = userSearchCondition(query);

    if (searchCondition) {
      conditions.push(searchCondition);
    }

    if (visibleStudentIds) {
      const ids = [...visibleStudentIds];
      conditions.push(ids.length > 0 ? inArray(users.id, ids) : sql`1 = 0`);
    }

    if (classIds) {
      conditions.push(classIds.length > 0 ? inArray(classStudents.classId, classIds) : sql`1 = 0`);
    }

    return db
      .select({
        id: users.id,
        uid: users.uid,
        name: users.name,
        createdAt: users.createdAt,
        class_id: classStudents.classId,
        class_cid: classes.cid,
        class_name: classes.name
      })
      .from(users)
      .leftJoin(classStudents, eq(classStudents.studentId, users.id))
      .leftJoin(classes, eq(classStudents.classId, classes.id))
      .where(and(...conditions))
      .orderBy(desc(users.id))
      .all()
      .map((row) => ({
        id: row.id,
        uid: row.uid,
        name: row.name,
        created_at: row.createdAt,
        class_id: row.class_id,
        class_cid: row.class_cid,
        class_name: row.class_name
      }));
  }

  searchStudentsForClassAssignment(query: string, classId: number | null): StudentWithClassSummary[] {
    const conditions = [eq(users.role, 'student'), isNull(users.deletedAt)];
    const searchCondition = userSearchCondition(query);

    if (searchCondition) {
      conditions.push(searchCondition);
    }

    conditions.push(classId ? sql`(${classStudents.classId} is null or ${classStudents.classId} = ${classId})` : sql`${classStudents.classId} is null`);

    return db
      .select({
        id: users.id,
        uid: users.uid,
        name: users.name,
        createdAt: users.createdAt,
        class_id: classStudents.classId,
        class_cid: classes.cid,
        class_name: classes.name
      })
      .from(users)
      .leftJoin(classStudents, eq(classStudents.studentId, users.id))
      .leftJoin(classes, eq(classStudents.classId, classes.id))
      .where(and(...conditions))
      .orderBy(desc(users.id))
      .all()
      .map((row) => ({
        id: row.id,
        uid: row.uid,
        name: row.name,
        created_at: row.createdAt,
        class_id: row.class_id,
        class_cid: row.class_cid,
        class_name: row.class_name
      }));
  }

  getAssignedStudents(): StudentWithClassSummary[] {
    return db
      .select({
        id: users.id,
        uid: users.uid,
        name: users.name,
        createdAt: users.createdAt,
        class_id: classStudents.classId,
        class_cid: classes.cid,
        class_name: classes.name
      })
      .from(classStudents)
      .innerJoin(users, eq(classStudents.studentId, users.id))
      .innerJoin(classes, eq(classStudents.classId, classes.id))
      .where(and(eq(users.role, 'student'), isNull(users.deletedAt)))
      .orderBy(desc(users.id))
      .all()
      .map((row) => ({
        id: row.id,
        uid: row.uid,
        name: row.name,
        created_at: row.createdAt,
        class_id: row.class_id,
        class_cid: row.class_cid,
        class_name: row.class_name
      }));
  }

  getTeacherStudentIds(teacherId: number) {
    return db
      .select({ studentId: classStudents.studentId })
      .from(classTeachers)
      .innerJoin(classStudents, eq(classTeachers.classId, classStudents.classId))
      .where(eq(classTeachers.teacherId, teacherId))
      .all()
      .map((row) => row.studentId);
  }

  getTeacherClassIds(teacherId: number) {
    return db
      .select({ classId: classTeachers.classId })
      .from(classTeachers)
      .where(eq(classTeachers.teacherId, teacherId))
      .all()
      .map((row) => row.classId);
  }

  getStudentClassId(studentId: number) {
    return db
      .select({ classId: classStudents.classId })
      .from(classStudents)
      .where(eq(classStudents.studentId, studentId))
      .get()?.classId ?? null;
  }

  createRecord(input: CreateRecordInput) {
    const student = db.select({ uid: users.uid }).from(users).where(eq(users.id, input.student_id)).get();
    const createdAt = nowIso();
    const images = this.prepareRecordImages(input.image_paths, input.cover_image_path);
    const result = db.insert(practiceRecords).values({
      studentId: input.student_id,
      studentUidSnapshot: student?.uid ?? null,
      title: input.title,
      content: input.content,
      practiceDate: input.practice_date,
      location: input.location,
      duration: input.duration,
      imagePaths: serializeImagePaths(images.imagePaths),
      coverImagePath: images.coverImagePath,
      status: 'pending',
      teacherComment: null,
      createdAt
    }).run();

    return this.getRecordById(Number(result.lastInsertRowid))!;
  }

  getRecordById(id: number) {
    const row = db.select().from(practiceRecords).where(eq(practiceRecords.id, id)).get();
    return row ? toPracticeRecord(row) : null;
  }

  canAccessUpload(imagePath: string, userId: number, role: UserRole) {
    const pathCondition = recordHasImagePathCondition(imagePath);

    if (role === 'admin') {
      return Boolean(
        db
          .select({ id: practiceRecords.id })
          .from(practiceRecords)
          .where(pathCondition)
          .limit(1)
          .get()
      );
    }

    if (role === 'student') {
      return Boolean(
        db
          .select({ id: practiceRecords.id })
          .from(practiceRecords)
          .where(and(pathCondition, eq(practiceRecords.studentId, userId)))
          .limit(1)
          .get()
      );
    }

    return Boolean(
      db
        .select({ id: practiceRecords.id })
        .from(practiceRecords)
        .innerJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
        .innerJoin(classTeachers, eq(classStudents.classId, classTeachers.classId))
        .where(and(pathCondition, eq(classTeachers.teacherId, userId)))
        .limit(1)
        .get()
    );
  }

  getRecordsByStudent(studentId: number): StudentRecord[] {
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
      .map((row) => ({
        ...toPracticeRecord(row.record),
        student_name: String(row.student_name)
      }));
  }

  getTeacherRecordById(id: number, visibleStudentIds?: Set<number>) {
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

    if (!record) {
      return null;
    }

    return {
      ...toPracticeRecord(record.record),
      student_name: String(record.student_name),
      student_uid: String(record.student_uid)
    } satisfies TeacherRecord;
  }

  getAllRecords(filters: RecordFilters = {}, visibleStudentIds?: Set<number>): TeacherRecordSummary[] {
    const where = buildRecordWhere(filters, visibleStudentIds);

    return db
      .select({
        id: practiceRecords.id,
        student_id: practiceRecords.studentId,
        title: practiceRecords.title,
        practice_date: practiceRecords.practiceDate,
        status: practiceRecords.status,
        created_at: practiceRecords.createdAt,
        ...recordIdentitySelect()
      })
      .from(practiceRecords)
      .leftJoin(users, eq(practiceRecords.studentId, users.id))
      .where(where)
      .orderBy(desc(practiceRecords.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        student_id: row.student_id,
        title: row.title,
        practice_date: row.practice_date,
        status: row.status as TeacherRecordSummary['status'],
        created_at: row.created_at,
        student_name: row.student_name,
        student_uid: row.student_uid
      }));
  }

  updateRecord(id: number, updates: UpdateRecordInput) {
    const current = this.getRecordById(id);

    if (!current) {
      return null;
    }

    const nextValues: Partial<typeof practiceRecords.$inferInsert> = {};

    if (updates.title !== undefined) nextValues.title = updates.title;
    if (updates.content !== undefined) nextValues.content = updates.content;
    if (updates.practice_date !== undefined) nextValues.practiceDate = updates.practice_date;
    if (updates.location !== undefined) nextValues.location = updates.location;
    if (updates.duration !== undefined) nextValues.duration = updates.duration;
    if (updates.image_paths !== undefined || updates.cover_image_path !== undefined) {
      const images = this.prepareRecordImages(
        updates.image_paths !== undefined ? updates.image_paths : current.image_paths,
        updates.cover_image_path !== undefined ? updates.cover_image_path : current.cover_image_path,
        current.image_paths
      );

      nextValues.imagePaths = serializeImagePaths(images.imagePaths);
      nextValues.coverImagePath = images.coverImagePath;

      for (const imagePath of current.image_paths) {
        if (!images.imagePaths.includes(imagePath)) {
          this.removeUploadFile(imagePath);
        }
      }
    }
    if (updates.status !== undefined) nextValues.status = updates.status;
    if (updates.teacher_comment !== undefined) nextValues.teacherComment = updates.teacher_comment;

    db.update(practiceRecords).set(nextValues).where(eq(practiceRecords.id, id)).run();

    const updated = this.getRecordById(id);

    return updated;
  }

  deleteRecord(id: number, imagePaths?: string[]) {
    const current = imagePaths ? { image_paths: imagePaths } : this.getRecordById(id);

    if (!current) {
      return false;
    }

    db.delete(practiceRecords).where(eq(practiceRecords.id, id)).run();
    for (const imagePath of current.image_paths) {
      this.removeUploadFile(imagePath);
    }
    return true;
  }

  countStudentRecordsToday(studentId: number) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(practiceRecords)
      .where(and(eq(practiceRecords.studentId, studentId), gte(practiceRecords.createdAt, start.toISOString())))
      .get();

    return toFiniteNumber(row?.count);
  }

  createNotification(studentId: number, type: NotificationType, message: string) {
    const createdAt = nowIso();
    const result = db.insert(notifications).values({
      studentId,
      type,
      message,
      isRead: false,
      createdAt
    }).run();

    return {
      id: Number(result.lastInsertRowid),
      student_id: studentId,
      type,
      message,
      is_read: false,
      created_at: createdAt
    };
  }

  getNotificationsByStudent(studentId: number) {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.studentId, studentId))
      .orderBy(desc(notifications.createdAt))
      .all()
      .map(toNotification);
  }

  getUnreadNotificationCount(studentId: number) {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.studentId, studentId), eq(notifications.isRead, false)))
      .get();

    return toFiniteNumber(row?.count);
  }

  markNotificationsAsRead(studentId: number) {
    db.update(notifications).set({ isRead: true }).where(and(eq(notifications.studentId, studentId), eq(notifications.isRead, false))).run();
  }

  enqueueTempUpload(filePath: string) {
    if (!tmpUploadPathPattern.test(filePath)) {
      throw new Error('图片路径无效。');
    }

    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + appConfig.temp_upload_ttl_ms).toISOString();

    db.insert(tempUploadDeletions)
      .values({
        filePath,
        expiresAt,
        createdAt
      })
      .onConflictDoUpdate({
        target: tempUploadDeletions.filePath,
        set: {
          expiresAt,
          createdAt
        }
      })
      .run();
  }

  cleanupExpiredTempUploads() {
    const now = nowIso();

    while (true) {
      const item = db
        .select()
        .from(tempUploadDeletions)
        .orderBy(tempUploadDeletions.id)
        .limit(1)
        .get();

      if (!item || item.expiresAt > now) {
        return;
      }

      const filePath = this.resolveTmpUploadFilePath(item.filePath);

      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      db.delete(tempUploadDeletions).where(eq(tempUploadDeletions.id, item.id)).run();
    }
  }

  startTempUploadCleanupWorker() {
    this.cleanupExpiredTempUploads();
    const timer = setInterval(() => this.cleanupExpiredTempUploads(), appConfig.temp_upload_cleanup_interval_ms);
    timer.unref?.();
    return timer;
  }

  getStudentStatistics(studentId: number) {
    return this.calculateRecordStatistics(eq(practiceRecords.studentId, studentId));
  }

  getStatistics(visibleStudentIds?: Set<number>): TeacherStatistics {
    const studentConditions = [eq(users.role, 'student'), isNull(users.deletedAt)];

    if (visibleStudentIds) {
      const ids = [...visibleStudentIds];
      studentConditions.push(ids.length > 0 ? inArray(users.id, ids) : sql`1 = 0`);
    }

    const studentsList = db
      .select({
        id: users.id,
        uid: users.uid,
        name: users.name
      })
      .from(users)
      .where(and(...studentConditions))
      .all();

    const recordStats = this.calculateRecordStatistics(buildRecordWhere({}, visibleStudentIds));

    const studentDurations = studentsList
      .map((student) => {
        const row = db
          .select({
            total: sql<number>`coalesce(sum(case when ${practiceRecords.status} = 'approved' then ${practiceRecords.duration} else 0 end), 0)`
          })
          .from(practiceRecords)
          .where(eq(practiceRecords.studentId, student.id))
          .get();

        return {
          student_id: student.id,
          student_name: student.name,
          student_uid: student.uid,
          total_duration: toFiniteNumber(row?.total)
        };
      })
      .sort((left, right) => {
        if (right.total_duration !== left.total_duration) {
          return right.total_duration - left.total_duration;
        }

        return left.student_name.localeCompare(right.student_name);
      });

    return {
      ...recordStats,
      student_count: studentsList.length,
      student_durations: studentDurations
    };
  }

  private calculateRecordStatistics(where?: ReturnType<typeof buildRecordWhere> | ReturnType<typeof eq>) {
    const row = db
      .select({
        total_records: sql<number>`count(*)`,
        pending_count: sql<number>`sum(case when ${practiceRecords.status} = 'pending' then 1 else 0 end)`,
        approved_count: sql<number>`sum(case when ${practiceRecords.status} = 'approved' then 1 else 0 end)`,
        rejected_count: sql<number>`sum(case when ${practiceRecords.status} = 'rejected' then 1 else 0 end)`,
        total_duration: sql<number>`coalesce(sum(case when ${practiceRecords.status} = 'approved' then ${practiceRecords.duration} else 0 end), 0)`
      })
      .from(practiceRecords)
      .where(where)
      .get();

    return {
      total_records: toFiniteNumber(row?.total_records),
      pending_count: toFiniteNumber(row?.pending_count),
      approved_count: toFiniteNumber(row?.approved_count),
      rejected_count: toFiniteNumber(row?.rejected_count),
      total_duration: toFiniteNumber(row?.total_duration)
    } satisfies RecordStatistics;
  }

  private seedDefaults() {
    const row = db.select({ count: sql<number>`count(*)` }).from(users).get();

    if (toFiniteNumber(row?.count) > 0) {
      return;
    }

    const INITIAL_USER_PASSWORD = '12345678';

    db.insert(users).values([
      {
        uid: 'A00001',
        password: hashPasswordSync(INITIAL_USER_PASSWORD, 'low'),
        role: 'admin',
        name: '超级奶龙',
        nameInitials: getPinyinInitials('超级奶龙'),
        createdAt: nowIso(),
        deletedAt: null
      }
    ]).run();

    console.log("欢迎使用可爱奶龙社会实践系统，初始 uid：A00001，初始密码：%s", INITIAL_USER_PASSWORD);
  }

  private allocateUids(roles: UserRole[]) {
    const nextNumbers = new Map<UserRole, number>();

    for (const role of new Set(roles)) {
      const latest = db
        .select({ uid: users.uid })
        .from(users)
        .where(eq(users.role, role))
        .orderBy(desc(users.id))
        .limit(1)
        .get();

      nextNumbers.set(role, latest ? this.parseUidNumber(latest.uid) + 1 : 1);
    }

    return roles.map((role) => {
      const nextNumber = nextNumbers.get(role) ?? 1;
      nextNumbers.set(role, nextNumber + 1);
      return `${rolePrefixes[role]}${nextNumber.toString(16).padStart(5, '0')}`;
    });
  }

  private parseUidNumber(uid: string) {
    const numeric = Number.parseInt(uid.slice(1), 16);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private allocateClassCid() {
    const latest = db
      .select({ cid: classes.cid })
      .from(classes)
      .orderBy(desc(classes.id))
      .limit(1)
      .get();
    const nextNumber = latest ? this.parseUidNumber(latest.cid) + 1 : 1;

    return `C${nextNumber.toString(16).padStart(4, '0')}`;
  }

  private resolveUploadFilePath(imagePath: string) {
    if (!uploadPathPattern.test(imagePath)) {
      return null;
    }

    const filePath = path.join(uploadDir, path.basename(imagePath));
    return filePath.startsWith(uploadDir) ? filePath : null;
  }

  private resolveTmpUploadFilePath(imagePath: string) {
    if (!tmpUploadPathPattern.test(imagePath)) {
      return null;
    }

    const filePath = path.join(tmpUploadDir, path.basename(imagePath));
    return filePath.startsWith(tmpUploadDir) ? filePath : null;
  }

  private createUploadPathFromSource(sourcePath: string) {
    const filename = `${crypto.randomUUID()}${path.extname(sourcePath) || '.webp'}`;
    const targetPath = path.join(uploadDir, filename);

    if (!targetPath.startsWith(uploadDir)) {
      throw new Error('图片路径无效。');
    }

    return {
      filePath: targetPath,
      imagePath: `/uploads/${filename}`
    };
  }

  private prepareRecordImages(imagePathsInput: string[], coverImagePathInput: string | null | undefined, reusableImagePaths: string[] = []) {
    const sourceImagePaths = [...new Set(imagePathsInput)].slice(0, MAX_RECORD_IMAGES);
    const reusableImagePathSet = new Set(reusableImagePaths);
    const movedImagePaths = new Map<string, string>();
    const imagePaths: string[] = [];

    for (const sourceImagePath of sourceImagePaths) {
      if (uploadPathPattern.test(sourceImagePath)) {
        if (!reusableImagePathSet.has(sourceImagePath)) {
          throw new Error('图片路径无效。');
        }

        const sourceFilePath = this.resolveUploadFilePath(sourceImagePath);

        if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
          throw new Error('图片文件不存在或已过期。');
        }

        movedImagePaths.set(sourceImagePath, sourceImagePath);
        imagePaths.push(sourceImagePath);
        continue;
      }

      if (!tmpUploadPathPattern.test(sourceImagePath)) {
        throw new Error('图片路径无效。');
      }

      const sourceFilePath = this.resolveTmpUploadFilePath(sourceImagePath);

      if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
        throw new Error('图片文件不存在或已过期。');
      }

      const target = this.createUploadPathFromSource(sourceFilePath);

      fs.renameSync(sourceFilePath, target.filePath);
      db.delete(tempUploadDeletions).where(eq(tempUploadDeletions.filePath, sourceImagePath)).run();

      movedImagePaths.set(sourceImagePath, target.imagePath);
      imagePaths.push(target.imagePath);
    }

    const coverImagePath = coverImagePathInput && movedImagePaths.has(coverImagePathInput)
      ? movedImagePaths.get(coverImagePathInput)!
      : imagePaths[0] ?? null;

    return {
      imagePaths,
      coverImagePath
    };
  }

  private removeUploadFile(imagePath: string | null) {
    if (!imagePath) {
      return;
    }

    const filePath = this.resolveUploadFilePath(imagePath);

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

const database = new SQLiteDatabase();

export default database;
