import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJwt, SignJWT } from 'jose';

const testDbPath = `/tmp/social-practice-test-db-${Date.now()}.db`;
const testConfigPath = `/tmp/social-practice-test-config-${Date.now()}.toml`;
const testUploadDir = fileURLToPath(new URL('../uploads', import.meta.url));
const cleanupUploadFiles = new Set<string>();
const testJwtSecret = 'test-jwt-secret-12345678901234567890';
const testJwtIssuer = 'social-practice-system';

globalThis.__socialPracticeConfigFile = testConfigPath;

fs.writeFileSync(testConfigPath, [
  'port = 3000',
  'vite_port = 5173',
  'backend_host = "127.0.0.1"',
  'frontend_host = "127.0.0.1"',
  `database_file = "${testDbPath}"`,
  `jwt_secret = "${testJwtSecret}"`,
  `jwt_issuer = "${testJwtIssuer}"`,
  'jwt_expires_in = "8h"',
  'login_max_attempts = 3',
  'login_lockout_ms = 60000',
  'upload_image_max_size_bytes = 5242880',
  'trust_proxy = true',
  'is_production = false',
  'cors_origins = []'
].join('\n'));

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

  await database.createUsers([
    { name: '测试教师', role: 'teacher' },
    { name: '测试学生一', role: 'student' },
    { name: '测试学生二', role: 'student' }
  ]);
});

afterAll(() => {
  try {
    fs.unlinkSync(testDbPath);
  } catch {
  }

  try {
    fs.unlinkSync(testConfigPath);
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

async function signTokenWithAudience(uid: string, audience: string) {
  const user = database.findUserByUid(uid);

  if (!user) {
    throw new Error(`user not found: ${uid}`);
  }

  return await new SignJWT({
    id: user.id,
    uid: user.uid,
    role: user.role,
    name: user.name,
    password_setup_required: false
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(testJwtIssuer)
    .setAudience(audience)
    .setExpirationTime('8h')
    .sign(new TextEncoder().encode(testJwtSecret));
}

async function setNormalPassword(uid: string, password: string) {
  const user = database.findUserByUid(uid);

  if (!user) {
    throw new Error(`user not found: ${uid}`);
  }

  database.updateUserPassword(user.id, await hashPassword(password));
}

describe('database bootstrap and users', () => {
  test('creates users and filters by role', async () => {
    const targetClass = database.createClass('批量班级');
    const createdStudent = await database.createUser('测试学生', 'student');
    const createdUsers = await database.createUsers([
      { name: '批量教师', role: 'teacher' },
      { name: '批量管理员', role: 'admin' },
      { name: '批量学生', role: 'student', classId: targetClass.id }
    ]);

    expect(createdStudent.uid).toMatch(/^S/);
    expect(createdStudent.password).toHaveLength(8);
    expect(database.findUserById(createdStudent.id)?.password).toMatch(/^scrypt\$low-v1\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(isLowCostPasswordHash(database.findUserById(createdStudent.id)?.password ?? '')).toBe(true);
    expect(createdUsers[0]?.uid).toMatch(/^T/);
    expect(createdUsers[1]?.uid).toMatch(/^A/);
    expect(createdUsers[2]?.uid).toMatch(/^S/);
    expect(database.getUsersByRole('teacher').some((user) => user.uid === createdUsers[0]?.uid)).toBe(true);
    expect(createdUsers[2] ? database.getStudentClassId(createdUsers[2].id) : null).toBe(targetClass.id);
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
  test('assigns teachers and students to a class and supports removing assignments', () => {
    const teacher = database.findUserByUid('T00001');
    const students = database.getAllStudents().slice(0, 2);
    const targetClass = database.createClass('测试班级');

    expect(teacher).toBeTruthy();
    expect(students).toHaveLength(2);

    database.assignTeachersToClass(targetClass.id, [teacher!.id]);
    database.assignStudentsToClass(targetClass.id, students.map((student) => student.id));

    expect(database.getTeacherStudents(teacher!.id)).toHaveLength(2);
    expect(database.getStudentClassId(students[0]!.id)).toBe(targetClass.id);
    expect(database.getAllClassAssignments().students.length).toBeGreaterThanOrEqual(2);
    expect(database.getAllClassAssignments().teachers.some((assignment) => assignment.class_id === targetClass.id && assignment.teacher_id === teacher!.id)).toBe(true);

    database.removeStudentsFromClass(targetClass.id, [students[0]!.id]);

    expect(database.getTeacherStudents(teacher!.id)).toHaveLength(1);
    expect(database.getStudentClassId(students[0]!.id)).toBeNull();
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
      image_paths: [],
      cover_image_path: null
    });

    expect(createdRecord.status).toBe('pending');
    expect(createdRecord.image_paths).toEqual([]);
    expect(createdRecord.cover_image_path).toBeNull();
    expect(database.getRecordById(createdRecord.id)?.title).toBe('测试记录');
    expect(database.getTeacherRecordById(createdRecord.id)?.student_uid).toBe(student!.uid);
    expect(database.getAllRecords().find((record) => record.id === createdRecord.id)?.title).toBe('测试记录');
    expect('content' in (database.getAllRecords().find((record) => record.id === createdRecord.id) ?? {})).toBe(false);
    expect(database.getRecordsByStudent(student!.id).some((record) => record.id === createdRecord.id)).toBe(true);

    const updatedRecord = database.updateRecord(createdRecord.id, {
      status: 'approved',
      teacher_comment: '通过',
      duration: 2.5
    });

    expect(updatedRecord?.status).toBe('approved');
    expect(updatedRecord?.teacher_comment).toBe('通过');
    expect(database.getStudentStatistics(student!.id).approved_count).toBeGreaterThan(0);
    expect(database.getStudentStatistics(student!.id).total_duration).toBeGreaterThanOrEqual(2.5);

    expect(database.deleteRecord(createdRecord.id)).toBe(true);
    expect(database.getRecordById(createdRecord.id)).toBeNull();
  });

  test('cleans up replaced and deleted record images', () => {
    const student = database.findUserByUid('S00002');
    expect(student).toBeTruthy();

    const firstImageName = `test-record-image-${Date.now()}-1.webp`;
    const secondImageName = `test-record-image-${Date.now()}-2.webp`;
    const thirdImageName = `test-record-image-${Date.now()}-3.webp`;
    const firstImagePath = path.join(testUploadDir, firstImageName);
    const secondImagePath = path.join(testUploadDir, secondImageName);
    const thirdImagePath = path.join(testUploadDir, thirdImageName);
    cleanupUploadFiles.add(firstImagePath);
    cleanupUploadFiles.add(secondImagePath);
    cleanupUploadFiles.add(thirdImagePath);

    fs.mkdirSync(testUploadDir, { recursive: true });
    fs.writeFileSync(firstImagePath, 'first');
    fs.writeFileSync(secondImagePath, 'second');
    fs.writeFileSync(thirdImagePath, 'third');

    const record = database.createRecord({
      student_id: student!.id,
      title: '带图片记录',
      content: '测试图片清理',
      practice_date: '2026-01-11',
      location: '实验室',
      duration: 1,
      image_paths: [`/uploads/${firstImageName}`, `/uploads/${secondImageName}`],
      cover_image_path: `/uploads/${secondImageName}`
    });

    const updatedRecord = database.updateRecord(record.id, {
      image_paths: [`/uploads/${secondImageName}`, `/uploads/${thirdImageName}`],
      cover_image_path: `/uploads/${thirdImageName}`
    });

    expect(updatedRecord?.image_paths).toEqual([`/uploads/${secondImageName}`, `/uploads/${thirdImageName}`]);
    expect(updatedRecord?.cover_image_path).toBe(`/uploads/${thirdImageName}`);
    expect(fs.existsSync(firstImagePath)).toBe(false);
    expect(fs.existsSync(secondImagePath)).toBe(true);
    expect(fs.existsSync(thirdImagePath)).toBe(true);

    expect(database.deleteRecord(record.id)).toBe(true);
    expect(fs.existsSync(secondImagePath)).toBe(false);
    expect(fs.existsSync(thirdImagePath)).toBe(false);
  });

  test('keeps deleted student records visible to the assigned teacher', async () => {
    const teacher = database.findUserByUid('T00001');
    const student = await database.createUser('将被删除的学生', 'student');
    const targetClass = database.createClass('历史班级');

    database.assignTeachersToClass(targetClass.id, [teacher!.id]);
    database.assignStudentsToClass(targetClass.id, [student.id]);

    const record = database.createRecord({
      student_id: student.id,
      title: '历史记录',
      content: '删除用户后保留展示',
      practice_date: '2026-01-12',
      location: null,
      duration: 1.5,
      image_paths: [],
      cover_image_path: null
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
  test('requires users with random initial passwords to set a new password after login', async () => {
    const createdUser = await database.createUser('待设置密码用户', 'student');
    const response = await jsonRequest('/api/auth/login', { uid: createdUser.uid, password: createdUser.password }, { method: 'POST' });
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload.user).toMatchObject({
      uid: createdUser.uid,
      password_setup_required: true
    });

    const token = payload.token as string;
    expect(decodeJwt(token).aud).toBe('unauthorized');
    const blockedResponse = await apiRequest('/api/students/me/records', {
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(blockedResponse.status).toBe(403);
    expect((await readJson(blockedResponse)).error).toBe('请设置密码。');

    const changePasswordResponse = await jsonRequest('/api/auth/password', {
      current_password: createdUser.password,
      new_password: 'new-password-01'
    }, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(changePasswordResponse.status).toBe(200);
    const changePasswordPayload = await readJson(changePasswordResponse);
    expect(decodeJwt(changePasswordPayload.token as string).aud).toBe('student');

    const reloginResponse = await jsonRequest('/api/auth/login', { uid: createdUser.uid, password: 'new-password-01' }, { method: 'POST' });
    const reloginPayload = await readJson(reloginResponse);

    expect(reloginResponse.status).toBe(200);
    expect(decodeJwt(reloginPayload.token as string).aud).toBe('student');
    expect(reloginPayload.user).toMatchObject({
      uid: createdUser.uid,
      password_setup_required: false
    });
  });

  test('exposes upload size limit from config', async () => {
    const response = await apiRequest('/api/config');
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload.upload_image_max_size_bytes).toBe(5 * 1024 * 1024);
  });

  test('rejects passwords longer than 32 characters in the backend', async () => {
    await setNormalPassword('T00001', 'teacher-pass-01');
    const token = await loginAs('T00001', 'teacher-pass-01');
    expect(decodeJwt(token).aud).toBe('teacher');
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
    expect(decodeJwt(token).aud).toBe('student');
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

  test('restricts uploaded images to permitted users', async () => {
    await setNormalPassword('S00001', 'student-pass-01');
    await setNormalPassword('S00002', 'student-pass-02');
    await setNormalPassword('T00001', 'teacher-pass-01');
    await setNormalPassword('A00001', 'admin-pass-01');

    const student = database.findUserByUid('S00001')!;
    const teacher = database.findUserByUid('T00001')!;
    const targetClass = database.createClass('图片权限班级');
    database.assignTeachersToClass(targetClass.id, [teacher.id]);
    database.assignStudentsToClass(targetClass.id, [student.id]);

    const studentToken = await loginAs('S00001', 'student-pass-01');
    const otherStudentToken = await loginAs('S00002', 'student-pass-02');
    const teacherToken = await loginAs('T00001', 'teacher-pass-01');
    const adminToken = await loginAs('A00001', 'admin-pass-01');

    const imageBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]);
    const formData = new FormData();
    formData.set('image', new File([imageBytes], 'record.png', { type: 'image/png' }));

    const uploadResponse = await formRequest('/api/uploads', formData, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${studentToken}`
      }
    });
    const uploadPayload = await readJson(uploadResponse);
    const imageUrl = uploadPayload.imageUrl as string;

    expect(uploadResponse.status).toBe(200);
    expect(imageUrl.endsWith('.webp')).toBe(true);

    database.createRecord({
      student_id: student.id,
      title: '图片访问测试',
      content: '用于验证图片权限。',
      practice_date: '2026-01-14',
      location: '教室',
      duration: 1,
      image_paths: [imageUrl],
      cover_image_path: imageUrl
    });

    const ownerResponse = await apiRequest(imageUrl, {
      headers: {
        authorization: `Bearer ${studentToken}`
      }
    });
    const otherStudentResponse = await apiRequest(imageUrl, {
      headers: {
        authorization: `Bearer ${otherStudentToken}`
      }
    });
    const teacherResponse = await apiRequest(imageUrl, {
      headers: {
        authorization: `Bearer ${teacherToken}`
      }
    });
    const adminResponse = await apiRequest(imageUrl, {
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    });

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers.get('content-type')).toBe('image/webp');
    expect(otherStudentResponse.status).toBe(404);
    expect(teacherResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
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
      image_paths: [],
      cover_image_path: null
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
      image_paths: [],
      cover_image_path: null
    });

    database.updateRecord(record.id, {
      status: 'rejected',
      teacher_comment: '请补充内容'
    });

    const token = await loginAs(student.uid, 'student-pass-01');
    const response = await jsonRequest(`/api/students/me/records/${record.id}`, {
      title: '已修改记录',
      content: '补充后的内容',
      practice_date: '2026-01-13',
      location: '操场',
      duration: '1.0',
      image_paths: [],
      cover_image_path: null
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
    expect(decodeJwt(token).aud).toBe('admin');

    const response = await jsonRequest('/api/admin/users/1', undefined, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe('不能删除自己的账号。');
  });

  test('rejects tokens whose audience does not match the user role', async () => {
    await setNormalPassword('S00001', 'student-pass-01');
    const token = await signTokenWithAudience('S00001', 'admin');
    const response = await apiRequest('/api/students/me/records', {
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(403);
    expect((await readJson(response)).error).toBe('认证令牌权限范围无效。');
  });

  test('rejects oversized csv imports in the backend', async () => {
    await setNormalPassword('A00001', 'admin-pass-01');
    const token = await loginAs('A00001', 'admin-pass-01');
    const oversizedCsv = new Uint8Array(50 * 1024 * 1024 + 1);
    oversizedCsv.set(new TextEncoder().encode('张三,student\n'));
    const formData = new FormData();
    formData.set('file', new File([oversizedCsv], 'users.csv', { type: 'text/csv' }));

    const response = await formRequest('/api/admin/users/import/preview', formData, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe('CSV 文件大小不能超过 50 MiB。');
  });

  test('locks failed logins per uid and source without blocking other accounts from the same address', async () => {
    await setNormalPassword('S00001', 'student-pass-01');
    await setNormalPassword('S00002', 'student-pass-02');
    const headers = { 'x-real-ip': '203.0.113.10' };

    for (let index = 0; index < 3; index += 1) {
      const response = await jsonRequest('/api/auth/login', { uid: 'S00001', password: 'wrong-password' }, {
        method: 'POST',
        headers
      });

      expect(response.status).toBe(401);
    }

    const lockedResponse = await jsonRequest('/api/auth/login', { uid: 'S00001', password: 'student-pass-01' }, {
      method: 'POST',
      headers
    });

    expect(lockedResponse.status).toBe(429);

    const otherUserResponse = await jsonRequest('/api/auth/login', { uid: 'S00002', password: 'student-pass-02' }, {
      method: 'POST',
      headers
    });

    expect(otherUserResponse.status).toBe(200);
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
    const parsed = parseUserImportCsvText('张三,student\n李老师,teacher\n', { columnCount: 2 });

    expect(parsed.encoding).toBe('utf-8');
    expect(parsed.totalCount).toBe(2);
    expect(parsed.studentCount).toBe(1);
    expect(parsed.entries[0]?.name).toBe('张三');
  });

  test('parses UTF-16 CSV buffer', () => {
    const utf16Buffer = new Uint8Array([
      0xff, 0xfe,
      0x20, 0x5f, 0x09, 0x4e, 0x2c, 0x00, 0x73, 0x00, 0x74, 0x00, 0x75, 0x00, 0x64, 0x00, 0x65, 0x00, 0x6e, 0x00, 0x74, 0x00, 0x0a, 0x00
    ]);

    const parsed = parseUserImportCsvBuffer(utf16Buffer, { columnCount: 2 });

    expect(parsed.encoding).toBe('utf-16');
    expect(parsed.totalCount).toBe(1);
    expect(parsed.entries[0]?.name).toBe('张三');
  });

  test('parses GBK CSV buffer', () => {
    const gbkBuffer = new Uint8Array([
      0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x73, 0x74, 0x75, 0x64, 0x65, 0x6e, 0x74,
      0x0a
    ]);

    const parsed = parseUserImportCsvBuffer(gbkBuffer, { columnCount: 2 });

    expect(parsed.encoding).toBe('gbk');
    expect(parsed.entries[0]?.name).toBe('张三');
  });

  test('rejects unsupported encodings', () => {
    expect(() => parseUserImportCsvBuffer(new Uint8Array([0xff, 0xff, 0xff]), { columnCount: 2 })).toThrow(
      '无法识别 CSV 文件编码，仅支持 UTF-8、UTF-16 和 GBK。'
    );
  });
});
