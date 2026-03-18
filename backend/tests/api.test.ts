import { expect, test } from 'bun:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzw-backend-tests-'));
process.env.DATABASE_FILE = path.join(tempDir, 'database.json');

const { startServer } = await import('../src/server');

function request(
  baseUrl: string,
  pathname: string,
  options: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {}
): Promise<{ body: any; status?: number }> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const requestInstance = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? 'GET',
        headers: options.headers ?? {}
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        });
      }
    );

    requestInstance.on('error', reject);

    if (options.body) {
      requestInstance.write(options.body);
    }

    requestInstance.end();
  });
}

test('后端 API 支持登录、学生记录提交和教师审核流程', async () => {
  const server = startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('无法获取测试服务器端口。');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const studentLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'student1', password: '123456' })
    });

    expect(studentLogin.status).toBe(200);
    expect(studentLogin.body.user.role).toBe('student');
    expect(studentLogin.body.token).toBeTruthy();

    const teacherLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher1', password: '123456' })
    });

    expect(teacherLogin.status).toBe(200);
    expect(teacherLogin.body.user.role).toBe('teacher');
    expect(teacherLogin.body.token).toBeTruthy();

    const me = await request(baseUrl, '/api/auth/me', {
      headers: { Authorization: `Bearer ${studentLogin.body.token}` }
    });

    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('student1');

    const createRecord = await request(baseUrl, '/api/student/records', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentLogin.body.token}`
      },
      body: JSON.stringify({
        title: '社区清洁活动',
        content: '参与垃圾清理并完成垃圾分类。',
        practice_date: '2026-03-15',
        location: '滨河公园',
        duration: 3
      })
    });

    expect(createRecord.status).toBe(200);
    expect(createRecord.body.recordId).toBeTruthy();

    const studentRecords = await request(baseUrl, '/api/student/records', {
      headers: { Authorization: `Bearer ${studentLogin.body.token}` }
    });

    expect(studentRecords.status).toBe(200);
    expect(studentRecords.body.records.length).toBe(1);
    expect(studentRecords.body.records[0].title).toBe('社区清洁活动');
    expect(studentRecords.body.records[0].status).toBe('pending');

    const teacherRecords = await request(baseUrl, '/api/teacher/records', {
      headers: { Authorization: `Bearer ${teacherLogin.body.token}` }
    });

    expect(teacherRecords.status).toBe(200);
    expect(teacherRecords.body.records.length).toBe(1);
    expect(teacherRecords.body.records[0].student_username).toBe('student1');

    const teacherRecord = await request(
      baseUrl,
      `/api/teacher/records/${createRecord.body.recordId}`,
      {
        headers: { Authorization: `Bearer ${teacherLogin.body.token}` }
      }
    );

    expect(teacherRecord.status).toBe(200);
    expect(teacherRecord.body.record.id).toBe(createRecord.body.recordId);

    const review = await request(baseUrl, `/api/teacher/records/${createRecord.body.recordId}/review`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherLogin.body.token}`
      },
      body: JSON.stringify({ status: 'approved', comment: '记录完整，内容清晰。' })
    });

    expect(review.status).toBe(200);

    const statistics = await request(baseUrl, '/api/teacher/statistics', {
      headers: { Authorization: `Bearer ${teacherLogin.body.token}` }
    });

    expect(statistics.status).toBe(200);
    expect(statistics.body.statistics.total_records).toBe(1);
    expect(statistics.body.statistics.total_duration).toBe(3);
    expect(statistics.body.statistics.approved_count).toBe(1);
    expect(statistics.body.statistics.student_count).toBe(2);
    expect(Array.isArray(statistics.body.statistics.student_durations)).toBe(true);
    const student1Duration = statistics.body.statistics.student_durations.find(
      (item: { student_username: string; total_duration: number }) => item.student_username === 'student1'
    );
    expect(student1Duration?.total_duration).toBe(3);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });

    delete process.env.DATABASE_FILE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('后端在多次登录失败后会触发限流', async () => {
  const server = startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('无法获取测试服务器端口。');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failedLogin = await request(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'security-check-user', password: 'wrong-password' })
      });

      expect(failedLogin.status).toBe(401);
    }

    const lockedLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'security-check-user', password: 'wrong-password' })
    });

    expect(lockedLogin.status).toBe(429);
    expect(lockedLogin.body.error).toMatch(/登录失败次数过多/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});
