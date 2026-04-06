import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDbPath = `/tmp/social-practice-test-db-${Date.now()}.db`;
const testUploadDir = fileURLToPath(new URL('../uploads', import.meta.url));
const cleanupUploadFiles = new Set<string>();

process.env.DATABASE_FILE = testDbPath;
process.env.JWT_SECRET = 'test-jwt-secret-12345678901234567890';
process.env.LOGIN_MAX_ATTEMPTS = '3';
process.env.LOGIN_LOCKOUT_MS = '60000';

type DatabaseModule = typeof import('../src/database');
type LoginAttemptsModule = typeof import('../src/auth/login-attempts');
type CsvImportModule = typeof import('../src/csv/user-import');
type AppModule = typeof import('../src/app');
type PasswordModule = typeof import('../src/auth/password');

let database: DatabaseModule['default'];
let app: AppModule['app'];
let getRemainingLockoutMs: LoginAttemptsModule['getRemainingLockoutMs'];
let recordLoginFailure: LoginAttemptsModule['recordLoginFailure'];
let clearLoginFailures: LoginAttemptsModule['clearLoginFailures'];
let parseUserImportCsvBuffer: CsvImportModule['parseUserImportCsvBuffer'];
let parseUserImportCsvText: CsvImportModule['parseUserImportCsvText'];
let hashPassword: PasswordModule['hashPassword'];
let isLowCostPasswordHash: PasswordModule['isLowCostPasswordHash'];

beforeAll(async () => {
  const [databaseModule, loginAttemptsModule, csvImportModule, appModule, passwordModule] = await Promise.all([
    import('../src/database'),
    import('../src/auth/login-attempts'),
    import('../src/csv/user-import'),
    import('../src/app'),
    import('../src/auth/password')
  ]);

  database = databaseModule.default;
  app = appModule.app;
  getRemainingLockoutMs = loginAttemptsModule.getRemainingLockoutMs;
  recordLoginFailure = loginAttemptsModule.recordLoginFailure;
  clearLoginFailures = loginAttemptsModule.clearLoginFailures;
  parseUserImportCsvBuffer = csvImportModule.parseUserImportCsvBuffer;
  parseUserImportCsvText = csvImportModule.parseUserImportCsvText;
  hashPassword = passwordModule.hashPassword;
  isLowCostPasswordHash = passwordModule.isLowCostPasswordHash;
});

afterAll(() => {
  try {
    fs.unlinkSync(testDbPath);
  } catch {
  }

  for (const filePath of cleanupUploadFiles) {
    try {
      fs.unlinkSync(filePath);
    } catch {
    }
  }
});

async function apiRequest(pathname: string, init?: RequestInit) {
  return app.request(pathname, init);
}

async function jsonRequest(pathname: string, body?: unknown, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  return apiRequest(pathname, {
    ...init,
    headers,
    body: body === undefined ? init.body : JSON.stringify(body)
  });
}

async function formRequest(pathname: string, body: FormData, init: RequestInit = {}) {
  return apiRequest(pathname, {
    ...init,
    body
  });
}

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

async function loginAs(uid: string, password: string) {
  const response = await jsonRequest('/api/auth/login', { uid, password }, { method: 'POST' });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(`login failed: ${JSON.stringify(payload)}`);
  }

  return payload.token as string;
}

async function setNormalPassword(uid: string, password: string) {
  const user = database.findUserByUid(uid);

  if (!user) {
    throw new Error(`user not found: ${uid}`);
  }

  database.updateUserPassword(user.id, await hashPassword(password));
}

describe('database bootstrap and users', () => {
  test('seeds default admin, teacher and student accounts', () => {
    expect(database.findUserByUid('A00001')?.role).toBe('admin');
    expect(database.findUserByUid('T00001')?.role).toBe('teacher');
    expect(database.findUserByUid('S00001')?.role).toBe('student');
    expect(database.findUserByUid('S00002')?.role).toBe('student');
    expect(database.getUsersByRole('student')).toHaveLength(2);
  });

  test('creates users and filters by role', async () => {
    const teacher = database.findUserByUid('T00001');
    const createdStudent = await database.createUser('测试学生', 'student');
    const createdUsers = await database.createUsers([
      { name: '批量教师', role: 'teacher' },
      { name: '批量管理员', role: 'admin' },
      { name: '批量学生', role: 'student', teacherId: teacher?.id }
    ]);

    expect(createdStudent.uid).toMatch(/^S/);
    expect(createdStudent.password).toHaveLength(8);
    expect(database.findUserById(createdStudent.id)?.password).toMatch(/^scrypt\$cost=\d+,blockSize=\d+,parallelization=\d+,keyLength=\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(isLowCostPasswordHash(database.findUserById(createdStudent.id)?.password ?? '')).toBe(true);
    expect(createdUsers[0]?.uid).toMatch(/^T/);
    expect(createdUsers[1]?.uid).toMatch(/^A/);
    expect(createdUsers[2]?.uid).toMatch(/^S/);
    expect(database.getUsersByRole('teacher').some((user) => user.uid === createdUsers[0]?.uid)).toBe(true);
    expect(createdUsers[2] ? database.getStudentTeacherId(createdUsers[2].id) : null).toBe(teacher?.id ?? null);
    expect(database.isValidRole('teacher')).toBe(true);
    expect(database.isValidRole('invalid-role')).toBe(false);
  });

  test('updates, resets and deletes users', async () => {
    const createdUser = await database.createUser('待修改用户', 'student');

    expect(database.updateUserName(createdUser.id, '已修改用户')).toBe(true);
    expect(database.findUserById(createdUser.id)?.name).toBe('已修改用户');

    expect(database.updateUserPassword(createdUser.id, 'hashed-password')).toBe(true);
    expect(database.findUserById(createdUser.id)?.password).toBe('hashed-password');

    const resetResults = await database.resetUserPasswords([createdUser.id]);
    expect(resetResults).toHaveLength(1);
    expect(resetResults[0]?.password).toHaveLength(8);
    expect(isLowCostPasswordHash(database.findUserById(createdUser.id)?.password ?? '')).toBe(true);

    expect(database.deleteUser(createdUser.id)).toBe(true);
    expect(database.findUserById(createdUser.id)).toBeUndefined();
  });
});

describe('assignments, records and notifications', () => {
  test('assigns students to a teacher and supports removing assignments', () => {
    const teacher = database.findUserByUid('T00001');
    const students = database.getAllStudents().slice(0, 2);

    expect(teacher).toBeTruthy();
    expect(students).toHaveLength(2);

    database.assignStudentsToTeacher(teacher!.id, students.map((student) => student.id));

    expect(database.getTeacherStudents(teacher!.id)).toHaveLength(2);
    expect(database.getStudentTeacherId(students[0]!.id)).toBe(teacher!.id);
    expect(database.getAllAssignments()).toHaveLength(2);

    database.removeStudentsFromTeacher(teacher!.id, [students[0]!.id]);

    expect(database.getTeacherStudents(teacher!.id)).toHaveLength(1);
    expect(database.getStudentTeacherId(students[0]!.id)).toBeNull();
  });

  test('creates, updates and deletes practice records', () => {
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
    expect(database.getAllRecords().find((record) => record.id === createdRecord.id)?.title).toBe('测试记录');
    expect('content' in (database.getAllRecords().find((record) => record.id === createdRecord.id) ?? {})).toBe(false);
    expect(database.getRecordsByStudent(student!.id).some((record) => record.id === createdRecord.id)).toBe(true);

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

    expect(database.deleteRecord(createdRecord.id)).toBe(true);
    expect(database.getRecordById(createdRecord.id)).toBeNull();
  });

  test('cleans up replaced and deleted record images', () => {
    const student = database.findUserByUid('S00002');
    expect(student).toBeTruthy();

    const firstImageName = `test-record-image-${Date.now()}-1.png`;
    const secondImageName = `test-record-image-${Date.now()}-2.png`;
    const firstImagePath = path.join(testUploadDir, firstImageName);
    const secondImagePath = path.join(testUploadDir, secondImageName);
    cleanupUploadFiles.add(firstImagePath);
    cleanupUploadFiles.add(secondImagePath);

    fs.mkdirSync(testUploadDir, { recursive: true });
    fs.writeFileSync(firstImagePath, 'first');
    fs.writeFileSync(secondImagePath, 'second');

    const record = database.createRecord({
      student_id: student!.id,
      title: '带图片记录',
      content: '测试图片清理',
      practice_date: '2026-01-11',
      location: '实验室',
      duration: 1,
      image_path: `/uploads/${firstImageName}`
    });

    const updatedRecord = database.updateRecord(record.id, {
      image_path: `/uploads/${secondImageName}`
    });

    expect(updatedRecord?.image_path).toBe(`/uploads/${secondImageName}`);
    expect(fs.existsSync(firstImagePath)).toBe(false);
    expect(fs.existsSync(secondImagePath)).toBe(true);

    expect(database.deleteRecord(record.id)).toBe(true);
    expect(fs.existsSync(secondImagePath)).toBe(false);
  });

  test('keeps deleted student records visible to the assigned teacher', async () => {
    const teacher = database.findUserByUid('T00001');
    const student = await database.createUser('将被删除的学生', 'student');

    database.assignStudentsToTeacher(teacher!.id, [student.id]);

    const record = database.createRecord({
      student_id: student.id,
      title: '历史记录',
      content: '删除用户后保留展示',
      practice_date: '2026-01-12',
      location: null,
      duration: 1.5,
      image_path: null
    });

    expect(database.deleteUser(student.id)).toBe(true);

    const visibleIds = new Set(database.getTeacherStudentIds(teacher!.id));
    const teacherRecord = database.getAllRecords({}, visibleIds).find((item) => item.id === record.id);

    expect(visibleIds.has(student.id)).toBe(true);
    expect(teacherRecord?.student_name).toBe('已删除用户');
    expect(teacherRecord?.student_uid).toBe(student.uid);
  });

  test('tracks unread notifications and aggregate statistics', () => {
    const student = database.findUserByUid('S00001');
    expect(student).toBeTruthy();

    const notification = database.createNotification(student!.id, 'approved', '你的记录已通过。');
    expect(notification.is_read).toBe(false);
    expect(database.getUnreadNotificationCount(student!.id)).toBeGreaterThan(0);
    expect(database.getNotificationsByStudent(student!.id)[0]?.id).toBe(notification.id);

    database.markNotificationsAsRead(student!.id);
    expect(database.getUnreadNotificationCount(student!.id)).toBe(0);

    const statistics = database.getStatistics();
    expect(statistics.student_count).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(statistics.student_durations)).toBe(true);
  });
});

describe('route behavior', () => {
  test('requires users with low-cost passwords to set a new password after login', async () => {
    const response = await jsonRequest('/api/auth/login', { uid: 'S00001', password: '12345678' }, { method: 'POST' });
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload.user).toMatchObject({
      uid: 'S00001',
      password_setup_required: true
    });

    const token = payload.token as string;
    const blockedResponse = await apiRequest('/api/students/me/records', {
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(blockedResponse.status).toBe(403);
    expect((await readJson(blockedResponse)).error).toBe('请设置密码。');

    const changePasswordResponse = await jsonRequest('/api/auth/password', {
      current_password: '12345678',
      new_password: 'new-password-01'
    }, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(changePasswordResponse.status).toBe(200);

    const reloginResponse = await jsonRequest('/api/auth/login', { uid: 'S00001', password: 'new-password-01' }, { method: 'POST' });
    const reloginPayload = await readJson(reloginResponse);

    expect(reloginResponse.status).toBe(200);
    expect(reloginPayload.user).toMatchObject({
      uid: 'S00001',
      password_setup_required: false
    });
  });

  test('rejects passwords longer than 32 characters in the backend', async () => {
    await setNormalPassword('T00001', 'teacher-pass-01');
    const token = await loginAs('T00001', 'teacher-pass-01');
    const response = await jsonRequest('/api/auth/password', {
      current_password: 'teacher-pass-01',
      new_password: '123456789012345678901234567890123'
    }, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe('密码不能超过 32 位。');
  });

  test('rejects non-image content during upload even if the declared type is allowed', async () => {
    await setNormalPassword('S00001', 'student-pass-01');
    const token = await loginAs('S00001', 'student-pass-01');
    const formData = new FormData();
    formData.set('image', new File(['not really an image'], 'fake.png', { type: 'image/png' }));

    const response = await formRequest('/api/uploads', formData, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe('仅支持上传 JPG、PNG、GIF 格式的图片。');
  });

  test('rejects oversized images during upload', async () => {
    await setNormalPassword('S00001', 'student-pass-01');
    const token = await loginAs('S00001', 'student-pass-01');
    const oversizedImage = new Uint8Array(5 * 1024 * 1024 + 1);
    oversizedImage.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const formData = new FormData();
    formData.set('image', new File([oversizedImage], 'large.png', { type: 'image/png' }));

    const response = await formRequest('/api/uploads', formData, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe('图片大小不能超过 5 MiB。');
  });

  test('rejects future practice dates', async () => {
    await setNormalPassword('S00001', 'student-pass-01');
    const token = await loginAs('S00001', 'student-pass-01');
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;

    const response = await jsonRequest('/api/students/me/records', {
      title: '未来记录',
      content: '不应该允许',
      practice_date: tomorrow,
      location: '教室',
      duration: '1.0',
      image_path: null
    }, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe('不能记录未来的活动。');
  });

  test('resubmits rejected record as pending after student edit', async () => {
    await setNormalPassword('S00001', 'student-pass-01');
    const student = database.findUserByUid('S00001')!;
    const record = database.createRecord({
      student_id: student.id,
      title: '待重提记录',
      content: '第一次提交',
      practice_date: '2026-01-13',
      location: '操场',
      duration: 1,
      image_path: null
    });

    database.updateRecord(record.id, {
      status: 'rejected',
      teacher_comment: '请补充内容',
      updated_by_uid: 'T00001'
    });

    const token = await loginAs(student.uid, 'student-pass-01');
    const response = await jsonRequest(`/api/students/me/records/${record.id}`, {
      title: '已修改记录',
      content: '补充后的内容',
      practice_date: '2026-01-13',
      location: '操场',
      duration: '1.0',
      image_path: null
    }, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(200);
    expect(database.getRecordById(record.id)?.status).toBe('pending');
    expect(database.getRecordById(record.id)?.teacher_comment).toBeNull();
  });

  test('prevents admins from deleting themselves', async () => {
    await setNormalPassword('A00001', 'admin-pass-01');
    const token = await loginAs('A00001', 'admin-pass-01');

    const response = await jsonRequest('/api/admin/users/1', undefined, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe('不能删除自己的账号。');
  });
});

describe('login attempt lockout', () => {
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
    expect(parsed.entries[0]?.teacher_uid).toBe('T00001');
  });

  test('parses UTF-16 CSV buffer', () => {
    const utf16Buffer = new Uint8Array([
      0xff, 0xfe,
      0x20, 0x5f, 0x09, 0x4e, 0x2c, 0x00, 0x73, 0x00, 0x74, 0x00, 0x75, 0x00, 0x64, 0x00, 0x65, 0x00, 0x6e, 0x00, 0x74, 0x00, 0x2c, 0x00, 0x54, 0x00, 0x30, 0x00, 0x30, 0x00, 0x30, 0x00, 0x30, 0x00, 0x31, 0x00, 0x0a, 0x00
    ]);

    const parsed = parseUserImportCsvBuffer(utf16Buffer, { columnCount: 3 });

    expect(parsed.encoding).toBe('utf-16');
    expect(parsed.totalCount).toBe(1);
    expect(parsed.entries[0]?.name).toBe('张三');
  });

  test('parses GBK CSV buffer', () => {
    const gbkBuffer = new Uint8Array([
      0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x73, 0x74, 0x75, 0x64, 0x65, 0x6e, 0x74,
      0x2c, 0x54, 0x30, 0x30, 0x30, 0x30, 0x31, 0x0a
    ]);

    const parsed = parseUserImportCsvBuffer(gbkBuffer, { columnCount: 3 });

    expect(parsed.encoding).toBe('gbk');
    expect(parsed.entries[0]?.name).toBe('张三');
  });

  test('rejects unsupported encodings', () => {
    expect(() => parseUserImportCsvBuffer(new Uint8Array([0xff, 0xff, 0xff]), { columnCount: 3 })).toThrow(
      '无法识别 CSV 文件编码，仅支持 UTF-8、UTF-16 和 GBK。'
    );
  });
});
