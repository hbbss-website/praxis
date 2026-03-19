import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  CreateRecordInput,
  DatabaseState,
  PracticeRecord,
  RecordFilters,
  RecordStatistics,
  RecordStatus,
  StudentRecord,
  TeacherRecord,
  UpdateRecordInput,
  User
} from './models';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_FILE
  ? path.resolve(process.env.DATABASE_FILE)
  : path.join(currentDir, '..', 'database.json');

const VALID_RECORD_STATUSES: RecordStatus[] = ['approved', 'pending', 'rejected'];

function createEmptyState(): DatabaseState {
  return {
    users: [],
    practice_records: [],
    nextId: { users: 1, practice_records: 1 }
  };
}

function nextNumericId(items: Array<{ id: number }>): number {
  return items.reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeUser(value: unknown): User | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<User>;

  if (
    typeof candidate.id !== 'number' ||
    typeof candidate.username !== 'string' ||
    typeof candidate.password !== 'string' ||
    (candidate.role !== 'student' && candidate.role !== 'teacher') ||
    typeof candidate.name !== 'string' ||
    typeof candidate.created_at !== 'string'
  ) {
    return null;
  }

  return candidate as User;
}

function sanitizeRecord(value: unknown): PracticeRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PracticeRecord>;

  if (
    typeof candidate.id !== 'number' ||
    typeof candidate.student_id !== 'number' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.content !== 'string' ||
    typeof candidate.practice_date !== 'string' ||
    (candidate.location !== null && typeof candidate.location !== 'string' && candidate.location !== undefined) ||
    typeof candidate.duration !== 'number' ||
    (candidate.image_path !== null && typeof candidate.image_path !== 'string' && candidate.image_path !== undefined) ||
    (candidate.teacher_comment !== null &&
      typeof candidate.teacher_comment !== 'string' &&
      candidate.teacher_comment !== undefined) ||
    !VALID_RECORD_STATUSES.includes(candidate.status as RecordStatus) ||
    typeof candidate.created_at !== 'string' ||
    typeof candidate.updated_at !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    student_id: candidate.student_id,
    title: candidate.title,
    content: candidate.content,
    practice_date: candidate.practice_date,
    location: candidate.location ?? null,
    duration: candidate.duration,
    image_path: candidate.image_path ?? null,
    status: candidate.status as RecordStatus,
    teacher_comment: candidate.teacher_comment ?? null,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at
  };
}

function sanitizeDatabaseState(raw: unknown): DatabaseState {
  if (!raw || typeof raw !== 'object') {
    return createEmptyState();
  }

  const candidate = raw as Partial<DatabaseState>;
  const users = Array.isArray(candidate.users) ? candidate.users.map(sanitizeUser).filter(Boolean) as User[] : [];
  const practiceRecords = Array.isArray(candidate.practice_records)
    ? candidate.practice_records.map(sanitizeRecord).filter(Boolean) as PracticeRecord[]
    : [];

  return {
    users,
    practice_records: practiceRecords,
    nextId: {
      users: Math.max(toNumber(candidate.nextId?.users, 0), nextNumericId(users)),
      practice_records: Math.max(
        toNumber(candidate.nextId?.practice_records, 0),
        nextNumericId(practiceRecords)
      )
    }
  };
}

let db = createEmptyState();

function saveData(): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
}

function loadData(): void {
  if (!fs.existsSync(dbPath)) {
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as unknown;
    db = sanitizeDatabaseState(raw);
  } catch (error) {
    console.warn('数据库文件解析失败，将使用新的数据存储。', error);
    db = createEmptyState();
  }
}

function initDefaultData(): void {
  if (db.users.length > 0) {
    return;
  }

  const hashedPassword = bcrypt.hashSync('123456', 10);
  const createdAt = new Date().toISOString();

  db.users.push(
    {
      id: db.nextId.users++,
      username: 'teacher1',
      password: hashedPassword,
      role: 'teacher',
      name: '教师一',
      created_at: createdAt
    },
    {
      id: db.nextId.users++,
      username: 'student1',
      password: hashedPassword,
      role: 'student',
      name: '学生一',
      created_at: createdAt
    },
    {
      id: db.nextId.users++,
      username: 'student2',
      password: hashedPassword,
      role: 'student',
      name: '学生二',
      created_at: createdAt
    }
  );

  saveData();
}

function isRecordStatus(status: unknown): status is RecordStatus {
  return VALID_RECORD_STATUSES.includes(status as RecordStatus);
}

function findUserByUsername(username: string): User | undefined {
  return db.users.find((user) => user.username === username);
}

function findUserById(id: number): User | undefined {
  return db.users.find((user) => user.id === Number(id));
}

function getAllStudents(): Array<Pick<User, 'created_at' | 'id' | 'name' | 'username'>> {
  return db.users
    .filter((user) => user.role === 'student')
    .map(({ created_at, id, name, username }) => ({
      created_at,
      id,
      name,
      username
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getRecordsByStudent(studentId: number): StudentRecord[] {
  return db.practice_records
    .filter((record) => record.student_id === Number(studentId))
    .map((record) => {
      const student = findUserById(record.student_id);
      return {
        ...record,
        student_name: student?.name ?? ''
      };
    })
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

function getAllRecords(filters: RecordFilters = {}): TeacherRecord[] {
  let records: TeacherRecord[] = db.practice_records.map((record) => {
    const student = findUserById(record.student_id);
    return {
      ...record,
      student_name: student?.name ?? '',
      student_username: student?.username ?? ''
    };
  });

  if (filters.student_id !== undefined && filters.student_id !== null && filters.student_id !== '') {
    records = records.filter((record) => record.student_id === Number(filters.student_id));
  }

  if (isRecordStatus(filters.status)) {
    records = records.filter((record) => record.status === filters.status);
  }

  return records.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

function getRecordById(id: number): PracticeRecord | null {
  return db.practice_records.find((record) => record.id === Number(id)) ?? null;
}

function getTeacherRecordById(id: number): TeacherRecord | null {
  return getAllRecords().find((record) => record.id === Number(id)) ?? null;
}

function createRecord(record: CreateRecordInput): PracticeRecord {
  const timestamp = new Date().toISOString();
  const newRecord: PracticeRecord = {
    id: db.nextId.practice_records++,
    ...record,
    status: 'pending',
    teacher_comment: null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.practice_records.push(newRecord);
  saveData();
  return newRecord;
}

function updateRecord(id: number, updates: UpdateRecordInput): PracticeRecord | null {
  const index = db.practice_records.findIndex((record) => record.id === Number(id));

  if (index === -1) {
    return null;
  }

  db.practice_records[index] = {
    ...db.practice_records[index],
    ...updates,
    updated_at: new Date().toISOString()
  };

  saveData();
  return db.practice_records[index];
}

function deleteRecord(id: number): boolean {
  const index = db.practice_records.findIndex((record) => record.id === Number(id));

  if (index === -1) {
    return false;
  }

  db.practice_records.splice(index, 1);
  saveData();
  return true;
}

function calculateRecordStatistics(records: Pick<PracticeRecord, 'status' | 'duration'>[]): RecordStatistics {
  return {
    total_records: records.length,
    pending_count: records.filter((record) => record.status === 'pending').length,
    approved_count: records.filter((record) => record.status === 'approved').length,
    rejected_count: records.filter((record) => record.status === 'rejected').length,
    total_duration: records.reduce(
      (sum, record) =>
        record.status === 'approved' && typeof record.duration === 'number'
          ? sum + record.duration
          : sum,
      0
    )
  };
}

function getStudentStatistics(studentId: number): RecordStatistics {
  const records = getRecordsByStudent(studentId);
  return calculateRecordStatistics(records);
}

function getStatistics(): RecordStatistics & {
  student_count: number;
  student_durations: Array<{
    student_id: number;
    student_name: string;
    student_username: string;
    total_duration: number;
  }>;
} {
  const baseStats = calculateRecordStatistics(db.practice_records);
  const studentDurations = db.users
    .filter((user) => user.role === 'student')
    .map((student) => ({
      student_id: student.id,
      student_name: student.name,
      student_username: student.username,
      total_duration: db.practice_records.reduce(
        (sum, record) =>
          record.student_id === student.id &&
          record.status === 'approved' &&
          typeof record.duration === 'number'
            ? sum + record.duration
            : sum,
        0
      )
    }))
    .sort((left, right) => {
      if (right.total_duration === left.total_duration) {
        return left.student_name.localeCompare(right.student_name);
      }

      return right.total_duration - left.total_duration;
    });

  return {
    ...baseStats,
    student_count: db.users.filter((user) => user.role === 'student').length,
    student_durations: studentDurations
  };
}

loadData();
initDefaultData();

const database = {
  createRecord,
  deleteRecord,
  findUserById,
  findUserByUsername,
  getAllRecords,
  getAllStudents,
  getRecordById,
  getRecordsByStudent,
  getStatistics,
  getStudentStatistics,
  getTeacherRecordById,
  updateRecord
};

export default database;
