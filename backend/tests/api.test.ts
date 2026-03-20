import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import fs from 'node:fs';

// IMPORTANT: set DATABASE_FILE before importing server/database modules
// Use dynamic import to respect module loading order
const testDbPath = '/tmp/test-db-' + Date.now() + '.json';
process.env.DATABASE_FILE = testDbPath;

let server: Server;
let serverUrl = '';
let startServer: (port?: number) => Server;

beforeAll(async () => {
  // Dynamic import ensures process.env.DATABASE_FILE is set before database.ts initializes
  const mod = await import('../src/server');
  startServer = mod.startServer;
  server = startServer(0);
  const addr = server.address();
  const port = addr && typeof addr !== 'string' ? addr.port : 3000;
  serverUrl = `http://localhost:${port}`;
});

afterAll(() => {
  server?.close();
  try { fs.unlinkSync(testDbPath); } catch { }
});

async function login(uid: string, password: string) {
  return fetch(`${serverUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, password })
  });
}

async function getToken(uid: string, password: string): Promise<string> {
  const res = await login(uid, password);
  if (!res.ok) throw new Error(`Login failed for ${uid}: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

const DEFAULT_PW = '12345678';

describe('Authentication', () => {
  test('admin login with correct credentials', async () => {
    const res = await login('A00001', DEFAULT_PW);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { token: string; user: { uid: string; role: string } };
    expect(data.token).toBeTruthy();
    expect(data.user.uid).toBe('A00001');
    expect(data.user.role).toBe('admin');
  });

  test('login with wrong password', async () => {
    const res = await login('A00001', 'wrong');
    expect(res.status).toBe(401);
  });

  test('login with non-existent uid', async () => {
    const res = await login('X99999', 'test');
    expect(res.status).toBe(401);
  });

  test('teacher login', async () => {
    const res = await login('T00001', DEFAULT_PW);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { role: string } };
    expect(data.user.role).toBe('teacher');
  });

  test('student login', async () => {
    const res = await login('S00001', DEFAULT_PW);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { role: string } };
    expect(data.user.role).toBe('student');
  });
});

describe('Admin: User Management', () => {
  test('create single user', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: '测试学生', role: 'student' })
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { uid: string; password: string; role: string } };
    expect(data.user.uid).toMatch(/^S/);
    expect(data.user.password).toHaveLength(8);
    expect(data.user.role).toBe('student');
  });

  test('batch create users', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/admin/users/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ entries: [{ name: '批量1', role: 'student' }, { name: '批量2', role: 'teacher' }] })
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { users: Array<{ uid: string; password: string }> };
    expect(data.users).toHaveLength(2);
  });

  test('CSV import', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);
    const csv = '导入学生1,student\n导入学生2,student\n导入教师1,teacher';
    const res = await fetch(`${serverUrl}/api/admin/users/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ csv })
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { users: Array<{ uid: string; role: string }> };
    expect(data.users).toHaveLength(3);
    expect(data.users[0].uid).toMatch(/^S/);
    expect(data.users[2].uid).toMatch(/^T/);
  });

  test('CSV import with invalid role rejects', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/admin/users/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ csv: '用户1,invalid_role' })
    });
    expect(res.status).toBe(400);
  });

  test('list users by role', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/admin/users?role=student`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { users: Array<{ role: string }> };
    expect(data.users.length).toBeGreaterThan(0);
    data.users.forEach((u) => expect(u.role).toBe('student'));
  });

  test('delete user', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);
    const createRes = await fetch(`${serverUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: '待删除', role: 'student' })
    });
    const { user } = (await createRes.json()) as { user: { id: number } };
    const deleteRes = await fetch(`${serverUrl}/api/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(deleteRes.status).toBe(200);
  });

  test('cannot delete self', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);
    const meRes = await fetch(`${serverUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const { user } = (await meRes.json()) as { user: { id: number } };
    const deleteRes = await fetch(`${serverUrl}/api/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(deleteRes.status).toBe(400);
  });
});

describe('Password and Profile', () => {
  test('change password with correct current password', async () => {
    const token = await getToken('S00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password: DEFAULT_PW, new_password: 'newpasswd' })
    });
    expect(res.status).toBe(200);

    // Verify login with new password
    const loginRes = await login('S00001', 'newpasswd');
    expect(loginRes.status).toBe(200);

    // Reset password back
    const resetToken = await getToken('S00001', 'newpasswd');
    const resetRes = await fetch(`${serverUrl}/api/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resetToken}` },
      body: JSON.stringify({ current_password: 'newpasswd', new_password: DEFAULT_PW })
    });
    expect(resetRes.status).toBe(200);
  });

  test('reject short password', async () => {
    const token = await getToken('S00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password: DEFAULT_PW, new_password: 'short' })
    });
    expect(res.status).toBe(400);
  });

  test('reject wrong current password', async () => {
    const token = await getToken('S00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password: 'wrong', new_password: 'something' })
    });
    expect(res.status).toBe(401);
  });

  test('student cannot change name', async () => {
    const token = await getToken('S00002', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password: DEFAULT_PW, name: '新名字' })
    });
    expect(res.status).toBe(403);
  });

  test('admin can change name', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ current_password: DEFAULT_PW, name: '新管理员名' })
    });
    expect(res.status).toBe(200);
  });
});

describe('Student Records', () => {
  test('create a record', async () => {
    const token = await getToken('S00002', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/student/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: '测试记录', content: '测试内容', practice_date: '2026-01-01', duration: 2 })
    });
    expect(res.status).toBe(200);
  });

  test('get student records', async () => {
    const token = await getToken('S00002', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/student/records`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { records: Array<{ title: string }>; statistics: object };
    expect(data.records.length).toBeGreaterThan(0);
    expect(data.statistics).toBeTruthy();
  });
});

describe('Teacher-Student Assignments', () => {
  test('assign and list students for teacher', async () => {
    const adminToken = await getToken('A00001', DEFAULT_PW);

    const assignData = await fetch(`${serverUrl}/api/admin/assignments`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = (await assignData.json()) as {
      teachers: Array<{ id: number; uid: string }>;
      students: Array<{ id: number }>
    };

    const teacher = data.teachers.find(t => t.uid === 'T00001');
    expect(teacher).toBeTruthy();

    const assignRes = await fetch(`${serverUrl}/api/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ teacher_id: teacher!.id, student_ids: data.students.slice(0, 2).map(s => s.id) })
    });
    expect(assignRes.status).toBe(200);

    const teacherToken = await getToken('T00001', DEFAULT_PW);
    const listRes = await fetch(`${serverUrl}/api/teacher/students`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { students: Array<{ id: number }> };
    expect(listData.students.length).toBeGreaterThan(0);
  });
});

describe('Batch Record Operations', () => {
  test('batch approve records', async () => {
    const studentToken = await getToken('S00002', DEFAULT_PW);
    const createRes = await fetch(`${serverUrl}/api/student/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ title: '批量测试', content: '批量内容', practice_date: '2026-01-10', duration: 1 })
    });
    const { recordId } = (await createRes.json()) as { recordId: number };

    const adminToken = await getToken('A00001', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/teacher/records/batch-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ ids: [recordId], action: 'approved' })
    });
    expect(res.status).toBe(200);
  });
});

describe('Role-based Access Control', () => {
  test('student cannot access admin routes', async () => {
    const token = await getToken('S00002', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  test('student cannot access teacher routes', async () => {
    const token = await getToken('S00002', DEFAULT_PW);
    const res = await fetch(`${serverUrl}/api/teacher/records`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });
});
