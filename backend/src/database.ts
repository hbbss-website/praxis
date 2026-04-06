import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { and, desc, eq, getTableColumns, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { hashPassword, hashPasswordSync, hashPasswords } from './auth/password';
import { db } from './db/client';
import { ensureDatabaseSchema } from './db/setup';
import { notifications, practiceRecords, teacherStudents, users } from './db/schema';
import type {
  AppNotification,
  CreateRecordInput,
  CreateUserResult,
  NotificationType,
  PracticeRecord,
  RecordFilters,
  RecordStatistics,
  StudentRecord,
  StudentSummary,
  TeacherRecord,
  TeacherRecordSummary,
  TeacherStatistics,
  TeacherStudentAssignment,
  UpdateRecordInput,
  User,
  UserRole,
  UserSummary
} from './models';
import { userRoles } from './models';

const uploadDir = path.resolve(process.cwd(), 'backend/uploads');
const uploadPathPattern = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const deletedUserName = '已删除用户';
const generatedPasswordLength = 8;
const rolePrefixes: Record<UserRole, string> = {
  admin: 'A',
  teacher: 'T',
  student: 'S'
};

type UserRow = typeof users.$inferSelect;
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
  return {
    id: row.id,
    student_id: row.studentId,
    student_uid_snapshot: row.studentUidSnapshot,
    title: row.title,
    content: row.content,
    practice_date: row.practiceDate,
    location: row.location,
    duration: row.duration,
    image_path: row.imagePath,
    status: row.status as PracticeRecord['status'],
    teacher_comment: row.teacherComment,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    updated_by_uid: row.updatedByUid
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

  if (filters.teacher_id) {
    conditions.push(sql`${practiceRecords.studentId} in (select ${teacherStudents.studentId} from ${teacherStudents} where ${teacherStudents.teacherId} = ${filters.teacher_id})`);
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

  if (filters.updated_after) {
    conditions.push(gte(practiceRecords.updatedAt, filters.updated_after));
  }

  if (filters.updated_before) {
    conditions.push(lte(practiceRecords.updatedAt, filters.updated_before));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function recordIdentitySelect() {
  return {
    student_name: sql<string>`case when ${users.id} is null or ${users.deletedAt} is not null then ${deletedUserName} else ${users.name} end`,
    student_uid: sql<string>`case when ${users.id} is null then coalesce(${practiceRecords.studentUidSnapshot}, '') else ${users.uid} end`
  };
}

class SQLiteDatabase {
  readonly MAX_DAILY_RECORDS = 50;

  constructor() {
    ensureDatabaseSchema();
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

  async createUsers(entries: Array<{ name: string; role: UserRole; teacherId?: number | null }>) {
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
      createdAt,
      deletedAt: null as null
    }));

    return db.transaction((tx) => {
      const inserted = tx.insert(users).values(rows).run();
      const lastInsertedId = Number(inserted.lastInsertRowid);
      const firstInsertedId = lastInsertedId - rows.length + 1;

      const createdAt = nowIso();
      const assignments = entries.flatMap((entry, index) => {
        const teacherId = entry.teacherId;

        if (entry.role !== 'student' || !teacherId) {
          return [];
        }

        return [{
          teacherId,
          studentId: firstInsertedId + index,
          createdAt
        }];
      });

      if (assignments.length > 0) {
        tx.insert(teacherStudents).values(assignments).run();
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
    const result = db.update(users).set({ name }).where(activeUserById(id)).run();
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
        tx.delete(teacherStudents).where(eq(teacherStudents.teacherId, user.id)).run();
      }

      tx.update(users).set({ deletedAt: nowIso() }).where(eq(users.id, user.id)).run();
    });

    return true;
  }

  getTeacherStudents(teacherId: number) {
    return db
      .select({
        id: users.id,
        uid: users.uid,
        name: users.name,
        createdAt: users.createdAt
      })
      .from(teacherStudents)
      .innerJoin(users, eq(teacherStudents.studentId, users.id))
      .where(and(eq(teacherStudents.teacherId, teacherId), eq(users.role, 'student'), isNull(users.deletedAt)))
      .orderBy(desc(users.id))
      .all()
      .map(toStudentSummary);
  }

  getTeacherStudentIds(teacherId: number) {
    return db
      .select({ studentId: teacherStudents.studentId })
      .from(teacherStudents)
      .where(eq(teacherStudents.teacherId, teacherId))
      .all()
      .map((row) => row.studentId);
  }

  getStudentTeacherId(studentId: number) {
    return db
      .select({ teacherId: teacherStudents.teacherId })
      .from(teacherStudents)
      .where(eq(teacherStudents.studentId, studentId))
      .get()?.teacherId ?? null;
  }

  assignStudentsToTeacher(teacherId: number, studentIds: number[]) {
    if (studentIds.length === 0) {
      return;
    }

    const createdAt = nowIso();

    db.transaction((tx) => {
      tx.delete(teacherStudents).where(inArray(teacherStudents.studentId, studentIds)).run();
      tx.insert(teacherStudents).values(studentIds.map((studentId) => ({
        teacherId,
        studentId,
        createdAt
      }))).run();
    });
  }

  removeStudentsFromTeacher(teacherId: number, studentIds: number[]) {
    if (studentIds.length === 0) {
      return;
    }

    db.delete(teacherStudents)
      .where(and(eq(teacherStudents.teacherId, teacherId), inArray(teacherStudents.studentId, studentIds)))
      .run();
  }

  getAllAssignments() {
    return db
      .select({
        teacher_id: teacherStudents.teacherId,
        student_id: teacherStudents.studentId
      })
      .from(teacherStudents)
      .innerJoin(users, eq(teacherStudents.teacherId, users.id))
      .innerJoin(sql`users as student_users`, sql`${teacherStudents.studentId} = student_users.id`)
      .where(and(isNull(users.deletedAt), eq(users.role, 'teacher'), sql`student_users.deleted_at is null`, sql`student_users.role = 'student'`))
      .all() as TeacherStudentAssignment[];
  }

  createRecord(input: CreateRecordInput) {
    const student = db.select({ uid: users.uid }).from(users).where(eq(users.id, input.student_id)).get();
    const createdAt = nowIso();
    const result = db.insert(practiceRecords).values({
      studentId: input.student_id,
      studentUidSnapshot: student?.uid ?? null,
      title: input.title,
      content: input.content,
      practiceDate: input.practice_date,
      location: input.location,
      duration: input.duration,
      imagePath: input.image_path,
      status: 'pending',
      teacherComment: null,
      createdAt,
      updatedAt: createdAt,
      updatedByUid: null
    }).run();

    return this.getRecordById(Number(result.lastInsertRowid))!;
  }

  getRecordById(id: number) {
    const row = db.select().from(practiceRecords).where(eq(practiceRecords.id, id)).get();
    return row ? toPracticeRecord(row) : null;
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

    const nextValues: Partial<typeof practiceRecords.$inferInsert> = {
      updatedAt: nowIso()
    };

    if (updates.title !== undefined) nextValues.title = updates.title;
    if (updates.content !== undefined) nextValues.content = updates.content;
    if (updates.practice_date !== undefined) nextValues.practiceDate = updates.practice_date;
    if (updates.location !== undefined) nextValues.location = updates.location;
    if (updates.duration !== undefined) nextValues.duration = updates.duration;
    if (updates.image_path !== undefined) nextValues.imagePath = updates.image_path;
    if (updates.status !== undefined) nextValues.status = updates.status;
    if (updates.teacher_comment !== undefined) nextValues.teacherComment = updates.teacher_comment;
    if (updates.updated_by_uid !== undefined) nextValues.updatedByUid = updates.updated_by_uid;

    db.update(practiceRecords).set(nextValues).where(eq(practiceRecords.id, id)).run();

    const updated = this.getRecordById(id);

    if (current.image_path !== updated?.image_path) {
      this.removeUnusedUpload(current.image_path, id);
    }

    return updated;
  }

  deleteRecord(id: number) {
    const current = this.getRecordById(id);

    if (!current) {
      return false;
    }

    db.delete(practiceRecords).where(eq(practiceRecords.id, id)).run();
    this.removeUnusedUpload(current.image_path);
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

    const password = hashPasswordSync('12345678', 'low');
    const createdAt = nowIso();

    db.insert(users).values([
      {
        uid: 'A00001',
        password,
        role: 'admin',
        name: '超级奶龙',
        createdAt,
        deletedAt: null
      },
      {
        uid: 'T00001',
        password,
        role: 'teacher',
        name: '教师一',
        createdAt,
        deletedAt: null
      },
      {
        uid: 'S00001',
        password,
        role: 'student',
        name: '学生一',
        createdAt,
        deletedAt: null
      },
      {
        uid: 'S00002',
        password,
        role: 'student',
        name: '学生二',
        createdAt,
        deletedAt: null
      }
    ]).run();
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

  private resolveUploadFilePath(imagePath: string) {
    if (!uploadPathPattern.test(imagePath)) {
      return null;
    }

    const filePath = path.join(uploadDir, path.basename(imagePath));
    return filePath.startsWith(uploadDir) ? filePath : null;
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

  private removeUnusedUpload(imagePath: string | null, ignoredRecordId?: number) {
    if (!imagePath) {
      return;
    }

    const conditions = [eq(practiceRecords.imagePath, imagePath)];

    if (ignoredRecordId !== undefined) {
      conditions.push(sql`${practiceRecords.id} != ${ignoredRecordId}`);
    }

    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(practiceRecords)
      .where(and(...conditions))
      .get();

    if (toFiniteNumber(row?.count) === 0) {
      this.removeUploadFile(imagePath);
    }
  }
}

const database = new SQLiteDatabase();

export default database;
