import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AppNotification,
  CreateRecordInput,
  CreateUserResult,
  DatabaseState,
  NotificationType,
  PracticeRecord,
  RecordFilters,
  RecordStatistics,
  RecordStatus,
  StudentRecord,
  TeacherRecord,
  TeacherStudentAssignment,
  UpdateRecordInput,
  User,
  UserRole
} from './models';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_FILE
  ? path.resolve(process.env.DATABASE_FILE)
  : path.join(currentDir, '..', 'database.json');

const VALID_RECORD_STATUSES: RecordStatus[] = ['approved', 'pending', 'rejected'];
const VALID_ROLES: UserRole[] = ['admin', 'teacher', 'student'];
const ROLE_PREFIX: Record<UserRole, string> = { admin: 'A', teacher: 'T', student: 'S' };
const MAX_DAILY_RECORDS = 50;

// --- Helpers ---

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nextNumericId(items: Array<{ id: number; }>): number {
  return items.reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1;
}

function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function isRecordStatus(status: unknown): status is RecordStatus {
  return VALID_RECORD_STATUSES.includes(status as RecordStatus);
}

function isValidRole(role: unknown): role is UserRole {
  return VALID_ROLES.includes(role as UserRole);
}

function dateRangeFilter(isoDate: string, after?: string | null, before?: string | null): boolean {
  if (after && isoDate < after) return false;
  if (before && isoDate > before) return false;
  return true;
}

// --- Sanitizers ---

function sanitizeUser(value: unknown): User | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<User>;
  if (
    typeof c.id !== 'number' ||
    typeof c.uid !== 'string' ||
    typeof c.password !== 'string' ||
    !isValidRole(c.role) ||
    typeof c.name !== 'string' ||
    typeof c.created_at !== 'string'
  ) return null;
  return c as User;
}

function sanitizeRecord(value: unknown): PracticeRecord | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<PracticeRecord>;
  if (
    typeof c.id !== 'number' ||
    typeof c.student_id !== 'number' ||
    typeof c.title !== 'string' ||
    typeof c.content !== 'string' ||
    typeof c.practice_date !== 'string' ||
    (c.location !== null && typeof c.location !== 'string' && c.location !== undefined) ||
    typeof c.duration !== 'number' ||
    (c.image_path !== null && typeof c.image_path !== 'string' && c.image_path !== undefined) ||
    (c.teacher_comment !== null && typeof c.teacher_comment !== 'string' && c.teacher_comment !== undefined) ||
    !VALID_RECORD_STATUSES.includes(c.status as RecordStatus) ||
    typeof c.created_at !== 'string' ||
    typeof c.updated_at !== 'string'
  ) return null;

  return {
    id: c.id,
    student_id: c.student_id,
    title: c.title,
    content: c.content,
    practice_date: c.practice_date,
    location: c.location ?? null,
    duration: c.duration,
    image_path: c.image_path ?? null,
    status: c.status as RecordStatus,
    teacher_comment: c.teacher_comment ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    updated_by_uid: (typeof c.updated_by_uid === 'string' ? c.updated_by_uid : null)
  };
}

function sanitizeNotification(value: unknown): AppNotification | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<AppNotification>;
  if (
    typeof c.id !== 'number' ||
    typeof c.student_id !== 'number' ||
    typeof c.type !== 'string' ||
    typeof c.message !== 'string' ||
    typeof c.is_read !== 'boolean' ||
    typeof c.created_at !== 'string'
  ) return null;
  return c as AppNotification;
}

function sanitizeAssignment(value: unknown): TeacherStudentAssignment | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<TeacherStudentAssignment>;
  if (typeof c.teacher_id !== 'number' || typeof c.student_id !== 'number') return null;
  return c as TeacherStudentAssignment;
}

function sanitizeDatabaseState(raw: unknown): DatabaseState {
  if (!raw || typeof raw !== 'object') return createEmptyState();
  const c = raw as Partial<DatabaseState>;

  const users = Array.isArray(c.users) ? c.users.map(sanitizeUser).filter(Boolean) as User[] : [];
  const records = Array.isArray(c.practice_records)
    ? c.practice_records.map(sanitizeRecord).filter(Boolean) as PracticeRecord[] : [];
  const notifications = Array.isArray(c.notifications)
    ? c.notifications.map(sanitizeNotification).filter(Boolean) as AppNotification[] : [];
  const assignments = Array.isArray(c.teacher_students)
    ? c.teacher_students.map(sanitizeAssignment).filter(Boolean) as TeacherStudentAssignment[] : [];

  const nextUid = c.nextUidNumber && typeof c.nextUidNumber === 'object'
    ? c.nextUidNumber as Partial<DatabaseState['nextUidNumber']> : {};

  return {
    users,
    practice_records: records,
    notifications,
    teacher_students: assignments,
    nextId: {
      users: Math.max(toNumber(c.nextId?.users, 0), nextNumericId(users)),
      practice_records: Math.max(toNumber(c.nextId?.practice_records, 0), nextNumericId(records)),
      notifications: Math.max(toNumber(c.nextId?.notifications, 0), nextNumericId(notifications))
    },
    nextUidNumber: {
      admin: toNumber(nextUid.admin, 1),
      teacher: toNumber(nextUid.teacher, 1),
      student: toNumber(nextUid.student, 1)
    }
  };
}

function createEmptyState(): DatabaseState {
  return {
    users: [],
    practice_records: [],
    notifications: [],
    teacher_students: [],
    nextId: { users: 1, practice_records: 1, notifications: 1 },
    nextUidNumber: { admin: 1, teacher: 1, student: 1 }
  };
}

// --- Persistence ---

let db = createEmptyState();

function saveData(): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
}

function loadData(): void {
  if (!fs.existsSync(dbPath)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as unknown;
    db = sanitizeDatabaseState(raw);
  } catch (error) {
    console.warn('数据库文件解析失败，将使用新的数据存储。', error);
    db = createEmptyState();
  }
}

// --- UID Generation ---

function generateUid(role: UserRole): string {
  const prefix = ROLE_PREFIX[role];
  const num = db.nextUidNumber[role]++;
  return `${prefix}${num.toString(16).padStart(5, '0')}`;
}

// --- Init ---

function initDefaultData(): void {
  if (db.users.length > 0) return;

  const createdAt = new Date().toISOString();
  const defaultHash = bcrypt.hashSync('12345678', 10);

  db.users.push(
    { id: db.nextId.users++, uid: generateUid('admin'), password: defaultHash, role: 'admin', name: '超级奶龙', created_at: createdAt },
    { id: db.nextId.users++, uid: generateUid('teacher'), password: defaultHash, role: 'teacher', name: '教师一', created_at: createdAt },
    { id: db.nextId.users++, uid: generateUid('student'), password: defaultHash, role: 'student', name: '学生一', created_at: createdAt },
    { id: db.nextId.users++, uid: generateUid('student'), password: defaultHash, role: 'student', name: '学生二', created_at: createdAt }
  );

  saveData();
}

// --- User Lookups ---

function findUserByUid(uid: string): User | undefined {
  return db.users.find((u) => u.uid === uid);
}

function findUserById(id: number): User | undefined {
  return db.users.find((u) => u.id === Number(id));
}

function getUsersByRole(role?: UserRole): Array<Pick<User, 'id' | 'uid' | 'name' | 'role' | 'created_at'>> {
  let users = db.users;
  if (role) users = users.filter((u) => u.role === role);
  return users
    .map(({ id, uid, name, role: r, created_at }) => ({ id, uid, name, role: r, created_at }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getAllStudents(): Array<Pick<User, 'id' | 'uid' | 'name' | 'created_at'>> {
  return db.users
    .filter((u) => u.role === 'student')
    .map(({ id, uid, name, created_at }) => ({ id, uid, name, created_at }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- User CRUD ---

function createUser(name: string, role: UserRole): CreateUserResult {
  const plainPassword = generatePassword();
  const hashedPassword = bcrypt.hashSync(plainPassword, 10);
  const uid = generateUid(role);
  const user: User = {
    id: db.nextId.users++,
    uid,
    password: hashedPassword,
    role,
    name,
    created_at: new Date().toISOString()
  };
  db.users.push(user);
  saveData();
  return { id: user.id, uid, name, role, password: plainPassword };
}

function createUsers(entries: Array<{ name: string; role: UserRole; }>): CreateUserResult[] {
  const results: CreateUserResult[] = [];
  for (const entry of entries) {
    const plainPassword = generatePassword();
    const hashedPassword = bcrypt.hashSync(plainPassword, 10);
    const uid = generateUid(entry.role);
    const user: User = {
      id: db.nextId.users++,
      uid,
      password: hashedPassword,
      role: entry.role,
      name: entry.name,
      created_at: new Date().toISOString()
    };
    db.users.push(user);
    results.push({ id: user.id, uid, name: entry.name, role: entry.role, password: plainPassword });
  }
  saveData();
  return results;
}

function deleteUser(id: number): boolean {
  const index = db.users.findIndex((u) => u.id === Number(id));
  if (index === -1) return false;
  db.users.splice(index, 1);
  db.teacher_students = db.teacher_students.filter(
    (a) => a.teacher_id !== id && a.student_id !== id
  );
  saveData();
  return true;
}

function updateUserName(id: number, name: string): boolean {
  const user = findUserById(id);
  if (!user) return false;
  user.name = name;
  saveData();
  return true;
}

function updateUserPassword(id: number, hashedPassword: string): boolean {
  const user = findUserById(id);
  if (!user) return false;
  user.password = hashedPassword;
  saveData();
  return true;
}

// --- Teacher-Student Assignments ---

function getTeacherStudents(teacherId: number): Array<Pick<User, 'id' | 'uid' | 'name' | 'created_at'>> {
  const studentIds = new Set(
    db.teacher_students.filter((a) => a.teacher_id === teacherId).map((a) => a.student_id)
  );
  return db.users
    .filter((u) => studentIds.has(u.id))
    .map(({ id, uid, name, created_at }) => ({ id, uid, name, created_at }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getStudentTeacherId(studentId: number): number | null {
  const assignment = db.teacher_students.find((a) => a.student_id === studentId);
  return assignment ? assignment.teacher_id : null;
}

function assignStudentsToTeacher(teacherId: number, studentIds: number[]): void {
  for (const sid of studentIds) {
    // Remove existing assignment for this student (a student belongs to one teacher)
    db.teacher_students = db.teacher_students.filter((a) => a.student_id !== sid);
    db.teacher_students.push({ teacher_id: teacherId, student_id: sid });
  }
  saveData();
}

function removeStudentsFromTeacher(teacherId: number, studentIds: number[]): void {
  const removeSet = new Set(studentIds);
  db.teacher_students = db.teacher_students.filter(
    (a) => !(a.teacher_id === teacherId && removeSet.has(a.student_id))
  );
  saveData();
}

function getAllAssignments(): TeacherStudentAssignment[] {
  return [...db.teacher_students];
}

// --- Records ---

function getRecordsByStudent(studentId: number): StudentRecord[] {
  return db.practice_records
    .filter((r) => r.student_id === Number(studentId))
    .map((r) => ({ ...r, student_name: findUserById(r.student_id)?.name ?? '' }))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function getAllRecords(filters: RecordFilters = {}, studentIds?: Set<number>): TeacherRecord[] {
  let records: TeacherRecord[] = db.practice_records.map((r) => {
    const student = findUserById(r.student_id);
    return { ...r, student_name: student?.name ?? '', student_uid: student?.uid ?? '' };
  });

  if (studentIds) {
    records = records.filter((r) => studentIds.has(r.student_id));
  }
  if (filters.student_id != null && filters.student_id !== '') {
    records = records.filter((r) => r.student_id === Number(filters.student_id));
  }
  if (isRecordStatus(filters.status)) {
    records = records.filter((r) => r.status === filters.status);
  }
  records = records.filter((r) =>
    dateRangeFilter(r.created_at, filters.created_after, filters.created_before) &&
    dateRangeFilter(r.updated_at, filters.updated_after, filters.updated_before)
  );

  return records.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function getRecordById(id: number): PracticeRecord | null {
  return db.practice_records.find((r) => r.id === Number(id)) ?? null;
}

function getTeacherRecordById(id: number, studentIds?: Set<number>): TeacherRecord | null {
  const records = getAllRecords({}, studentIds);
  return records.find((r) => r.id === Number(id)) ?? null;
}

function countStudentRecordsToday(studentId: number): number {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  return db.practice_records.filter(
    (r) => r.student_id === studentId && r.created_at >= todayIso
  ).length;
}

function createRecord(record: CreateRecordInput): PracticeRecord {
  const timestamp = new Date().toISOString();
  const newRecord: PracticeRecord = {
    id: db.nextId.practice_records++,
    ...record,
    status: 'pending',
    teacher_comment: null,
    created_at: timestamp,
    updated_at: timestamp,
    updated_by_uid: null
  };
  db.practice_records.push(newRecord);
  saveData();
  return newRecord;
}

function updateRecord(id: number, updates: UpdateRecordInput): PracticeRecord | null {
  const index = db.practice_records.findIndex((r) => r.id === Number(id));
  if (index === -1) return null;
  db.practice_records[index] = {
    ...db.practice_records[index],
    ...updates,
    updated_at: new Date().toISOString()
  };
  saveData();
  return db.practice_records[index];
}

function deleteRecord(id: number): boolean {
  const index = db.practice_records.findIndex((r) => r.id === Number(id));
  if (index === -1) return false;
  db.practice_records.splice(index, 1);
  saveData();
  return true;
}

// --- Notifications ---

function createNotification(studentId: number, type: NotificationType, message: string): AppNotification {
  const newNotification: AppNotification = {
    id: db.nextId.notifications++,
    student_id: studentId,
    type,
    message,
    is_read: false,
    created_at: new Date().toISOString()
  };
  db.notifications.push(newNotification);
  saveData();
  return newNotification;
}

function getNotificationsByStudent(studentId: number): AppNotification[] {
  return db.notifications
    .filter((n) => n.student_id === Number(studentId))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function getUnreadNotificationCount(studentId: number): number {
  return db.notifications.filter((n) => n.student_id === Number(studentId) && !n.is_read).length;
}

function markNotificationsAsRead(studentId: number): void {
  let updated = false;
  for (const n of db.notifications) {
    if (n.student_id === Number(studentId) && !n.is_read) {
      n.is_read = true;
      updated = true;
    }
  }
  if (updated) saveData();
}

// --- Statistics ---

function calculateRecordStatistics(records: Pick<PracticeRecord, 'status' | 'duration'>[]): RecordStatistics {
  return {
    total_records: records.length,
    pending_count: records.filter((r) => r.status === 'pending').length,
    approved_count: records.filter((r) => r.status === 'approved').length,
    rejected_count: records.filter((r) => r.status === 'rejected').length,
    total_duration: records.reduce(
      (sum, r) => r.status === 'approved' && typeof r.duration === 'number' ? sum + r.duration : sum, 0
    )
  };
}

function getStudentStatistics(studentId: number): RecordStatistics {
  return calculateRecordStatistics(getRecordsByStudent(studentId));
}

function getStatistics(studentIds?: Set<number>): RecordStatistics & {
  student_count: number;
  student_durations: Array<{ student_id: number; student_name: string; student_uid: string; total_duration: number; }>;
} {
  const relevantRecords = studentIds
    ? db.practice_records.filter((r) => studentIds.has(r.student_id))
    : db.practice_records;

  const baseStats = calculateRecordStatistics(relevantRecords);
  const students = studentIds
    ? db.users.filter((u) => u.role === 'student' && studentIds.has(u.id))
    : db.users.filter((u) => u.role === 'student');

  const studentDurations = students
    .map((s) => ({
      student_id: s.id,
      student_name: s.name,
      student_uid: s.uid,
      total_duration: relevantRecords.reduce(
        (sum, r) => r.student_id === s.id && r.status === 'approved' && typeof r.duration === 'number'
          ? sum + r.duration : sum, 0
      )
    }))
    .sort((a, b) => b.total_duration !== a.total_duration
      ? b.total_duration - a.total_duration
      : a.student_name.localeCompare(b.student_name)
    );

  return { ...baseStats, student_count: students.length, student_durations: studentDurations };
}

// --- Init ---

loadData();
initDefaultData();

const database = {
  // User
  findUserByUid,
  findUserById,
  getUsersByRole,
  getAllStudents,
  createUser,
  createUsers,
  deleteUser,
  updateUserName,
  updateUserPassword,
  // Assignments
  getTeacherStudents,
  getStudentTeacherId,
  assignStudentsToTeacher,
  removeStudentsFromTeacher,
  getAllAssignments,
  // Records
  getRecordsByStudent,
  getAllRecords,
  getRecordById,
  getTeacherRecordById,
  countStudentRecordsToday,
  createRecord,
  updateRecord,
  deleteRecord,
  // Notifications
  createNotification,
  getNotificationsByStudent,
  getUnreadNotificationCount,
  markNotificationsAsRead,
  // Statistics
  getStudentStatistics,
  getStatistics,
  // Constants
  MAX_DAILY_RECORDS,
  isValidRole
};

export default database;
