import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';

const testDbPath = `/tmp/test-db-${Date.now()}.json`;
process.env.DATABASE_FILE = testDbPath;
process.env.JWT_SECRET = 'test-jwt-secret-1234567890123456';
process.env.LOGIN_MAX_ATTEMPTS = '3';
process.env.LOGIN_LOCKOUT_MS = '60000';

type DatabaseModule = typeof import('../src/database');
type LoginAttemptsModule = typeof import('../src/auth/login-attempts');
type CsvImportModule = typeof import('../src/csv/user-import');

let database: DatabaseModule['default'];
let getRemainingLockoutMs: LoginAttemptsModule['getRemainingLockoutMs'];
let recordLoginFailure: LoginAttemptsModule['recordLoginFailure'];
let clearLoginFailures: LoginAttemptsModule['clearLoginFailures'];
let parseUserImportCsvBuffer: CsvImportModule['parseUserImportCsvBuffer'];
let parseUserImportCsvText: CsvImportModule['parseUserImportCsvText'];

beforeAll(async () => {
  const databaseModule = await import('../src/database');
  const loginAttemptsModule = await import('../src/auth/login-attempts');
  const csvImportModule = await import('../src/csv/user-import');

  database = databaseModule.default;
  getRemainingLockoutMs = loginAttemptsModule.getRemainingLockoutMs;
  recordLoginFailure = loginAttemptsModule.recordLoginFailure;
  clearLoginFailures = loginAttemptsModule.clearLoginFailures;
  parseUserImportCsvBuffer = csvImportModule.parseUserImportCsvBuffer;
  parseUserImportCsvText = csvImportModule.parseUserImportCsvText;
});

afterAll(() => {
  try {
    fs.unlinkSync(testDbPath);
  } catch { }
});

describe('Database bootstrap and users', () => {
  test('seeds default admin, teacher and student accounts', () => {
    expect(database.findUserByUid('A00001')?.role).toBe('admin');
    expect(database.findUserByUid('T00001')?.role).toBe('teacher');
    expect(database.findUserByUid('S00001')?.role).toBe('student');
    expect(database.findUserByUid('S00002')?.role).toBe('student');
    expect(database.getUsersByRole('student')).toHaveLength(2);
  });

  test('creates users and filters by role', () => {
    const createdStudent = database.createUser('测试学生', 'student');
    const createdBatch = database.createUsers([
      { name: '批量教师', role: 'teacher' },
      { name: '批量管理员', role: 'admin' }
    ]);

    expect(createdStudent.uid).toMatch(/^S/);
    expect(createdStudent.password).toHaveLength(8);
    expect(createdBatch).toHaveLength(2);
    expect(createdBatch[0].uid).toMatch(/^T/);
    expect(createdBatch[1].uid).toMatch(/^A/);
    expect(database.getUsersByRole('teacher').some((user) => user.uid === createdBatch[0].uid)).toBe(true);
    expect(database.isValidRole('teacher')).toBe(true);
    expect(database.isValidRole('invalid-role')).toBe(false);
  });

  test('updates and deletes users', () => {
    const createdUser = database.createUser('待修改用户', 'student');

    expect(database.updateUserName(createdUser.id, '已修改用户')).toBe(true);
    expect(database.findUserById(createdUser.id)?.name).toBe('已修改用户');

    expect(database.updateUserPassword(createdUser.id, 'hashed-password')).toBe(true);
    expect(database.findUserById(createdUser.id)?.password).toBe('hashed-password');

    expect(database.deleteUser(createdUser.id)).toBe(true);
    expect(database.findUserById(createdUser.id)).toBeUndefined();
  });
});

describe('Assignments, records and notifications', () => {
  test('assigns students to a teacher and supports removing assignments', () => {
    const teacher = database.findUserByUid('T00001');
    const students = database.getAllStudents().slice(0, 2);

    expect(teacher).toBeTruthy();
    expect(students).toHaveLength(2);

    database.assignStudentsToTeacher(teacher!.id, students.map((student) => student.id));

    const teacherStudents = database.getTeacherStudents(teacher!.id);
    expect(teacherStudents).toHaveLength(2);
    expect(database.getStudentTeacherId(students[0].id)).toBe(teacher!.id);
    expect(database.getAllAssignments()).toHaveLength(2);

    database.removeStudentsFromTeacher(teacher!.id, [students[0].id]);

    expect(database.getTeacherStudents(teacher!.id)).toHaveLength(1);
    expect(database.getStudentTeacherId(students[0].id)).toBeNull();
  });

  test('creates, updates and deletes student practice records', () => {
    const student = database.findUserByUid('S00002');
    expect(student).toBeTruthy();

    const createdRecord = database.createRecord({
      student_id: student!.id,
      title: '测试记录',
      content: '测试内容',
      practice_date: '2026-01-10',
      location: '图书馆',
      duration: 2,
      image_path: null
    });

    expect(createdRecord.status).toBe('pending');
    expect(database.getRecordById(createdRecord.id)?.title).toBe('测试记录');
    expect(database.getTeacherRecordById(createdRecord.id)?.student_uid).toBe(student!.uid);
    expect(database.getRecordsByStudent(student!.id).some((record) => record.id === createdRecord.id)).toBe(true);
    expect(database.countStudentRecordsToday(student!.id)).toBeGreaterThan(0);

    const updatedRecord = database.updateRecord(createdRecord.id, {
      status: 'approved',
      teacher_comment: '通过',
      updated_by_uid: 'T00001',
      duration: 2.5
    });

    expect(updatedRecord?.status).toBe('approved');
    expect(updatedRecord?.teacher_comment).toBe('通过');
    expect(updatedRecord?.updated_by_uid).toBe('T00001');
    expect(database.getStudentStatistics(student!.id).approved_count).toBeGreaterThan(0);
    expect(database.getStudentStatistics(student!.id).total_duration).toBeGreaterThanOrEqual(2.5);
    expect(database.getAllRecords({ status: 'approved' }).some((record) => record.id === createdRecord.id)).toBe(true);

    expect(database.deleteRecord(createdRecord.id)).toBe(true);
    expect(database.getRecordById(createdRecord.id)).toBeNull();
  });

  test('tracks unread notifications and aggregate statistics', () => {
    const student = database.findUserByUid('S00001');
    expect(student).toBeTruthy();

    const notification = database.createNotification(student!.id, 'approved', '你的记录已通过。');
    expect(notification.is_read).toBe(false);
    expect(database.getUnreadNotificationCount(student!.id)).toBe(1);
    expect(database.getNotificationsByStudent(student!.id)[0]?.id).toBe(notification.id);

    database.markNotificationsAsRead(student!.id);

    expect(database.getUnreadNotificationCount(student!.id)).toBe(0);

    const allStats = database.getStatistics();
    expect(allStats.student_count).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(allStats.student_durations)).toBe(true);
  });
});

describe('Login attempt lockout', () => {
  test('locks a user after repeated failures and clears correctly', () => {
    const key = 'S00001';
    const now = 1_700_000_000_000;

    clearLoginFailures(key);
    expect(getRemainingLockoutMs(key, now)).toBe(0);

    expect(recordLoginFailure(key, now)).toBe(0);
    expect(recordLoginFailure(key, now + 1_000)).toBe(0);

    const lockedMs = recordLoginFailure(key, now + 2_000);
    expect(lockedMs).toBeGreaterThan(0);
    expect(getRemainingLockoutMs(key, now + 3_000)).toBeGreaterThan(0);

    clearLoginFailures(key);
    expect(getRemainingLockoutMs(key, now + 4_000)).toBe(0);
  });
});

describe('CSV user import parser', () => {
  test('parses UTF-8 CSV text content', () => {
    const parsed = parseUserImportCsvText('张三,student,T00001\n李老师,teacher,\n', { columnCount: 3 });

    expect(parsed.encoding).toBe('utf-8');
    expect(parsed.totalCount).toBe(2);
    expect(parsed.studentCount).toBe(1);
    expect(parsed.entries[0].teacher_uid).toBe('T00001');
  });

  test('parses UTF-16 CSV buffer', () => {
    const utf16Buffer = new Uint8Array([
      0xff, 0xfe,
      0x20, 0x5f, 0x09, 0x4e, 0x2c, 0x00, 0x73, 0x00, 0x74, 0x00, 0x75, 0x00, 0x64, 0x00, 0x65, 0x00, 0x6e, 0x00, 0x74, 0x00, 0x2c, 0x00, 0x54, 0x00, 0x30, 0x00, 0x30, 0x00, 0x30, 0x00, 0x30, 0x00, 0x31, 0x00, 0x0a, 0x00
    ]);
    const parsed = parseUserImportCsvBuffer(utf16Buffer, { columnCount: 3 });

    expect(parsed.encoding).toBe('utf-16');
    expect(parsed.totalCount).toBe(1);
    expect(parsed.entries[0].name).toBe('张三');
  });

  test('parses GBK CSV buffer', () => {
    const gbkBuffer = new Uint8Array([
      0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x73, 0x74, 0x75, 0x64, 0x65, 0x6e, 0x74,
      0x2c, 0x54, 0x30, 0x30, 0x30, 0x30, 0x31, 0x0a
    ]);
    const parsed = parseUserImportCsvBuffer(gbkBuffer, { columnCount: 3 });

    expect(parsed.encoding).toBe('gbk');
    expect(parsed.entries[0].name).toBe('张三');
  });

  test('rejects unsupported or broken CSV encodings', () => {
    expect(() => parseUserImportCsvBuffer(new Uint8Array([0xff, 0xff, 0xff]), { columnCount: 3 })).toThrow(
      '无法识别 CSV 文件编码，仅支持 UTF-8、UTF-16 和 GBK。'
    );
  });
});
