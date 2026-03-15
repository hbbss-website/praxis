const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzw-backend-tests-'));
process.env.DATABASE_FILE = path.join(tempDir, 'database.json');

const { startServer } = require('../server');

function request(baseUrl, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

test('backend API supports login, student records, and teacher review flow', async () => {
  const server = startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const studentLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'student1', password: '123456' })
    });

    assert.equal(studentLogin.status, 200);
    assert.equal(studentLogin.body.user.role, 'student');
    assert.ok(studentLogin.body.token);

    const teacherLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher1', password: '123456' })
    });

    assert.equal(teacherLogin.status, 200);
    assert.equal(teacherLogin.body.user.role, 'teacher');
    assert.ok(teacherLogin.body.token);

    const me = await request(baseUrl, '/api/auth/me', {
      headers: { Authorization: `Bearer ${studentLogin.body.token}` }
    });

    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'student1');

    const createRecord = await request(baseUrl, '/api/student/records', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentLogin.body.token}`
      },
      body: JSON.stringify({
        title: 'Community Cleanup',
        content: 'Collected trash and sorted recyclables.',
        practice_date: '2026-03-15',
        location: 'Riverside Park',
        duration: 3
      })
    });

    assert.equal(createRecord.status, 200);
    assert.ok(createRecord.body.recordId);

    const studentRecords = await request(baseUrl, '/api/student/records', {
      headers: { Authorization: `Bearer ${studentLogin.body.token}` }
    });

    assert.equal(studentRecords.status, 200);
    assert.equal(studentRecords.body.records.length, 1);
    assert.equal(studentRecords.body.records[0].title, 'Community Cleanup');
    assert.equal(studentRecords.body.records[0].status, 'pending');

    const teacherRecords = await request(baseUrl, '/api/teacher/records', {
      headers: { Authorization: `Bearer ${teacherLogin.body.token}` }
    });

    assert.equal(teacherRecords.status, 200);
    assert.equal(teacherRecords.body.records.length, 1);
    assert.equal(teacherRecords.body.records[0].student_username, 'student1');

    const review = await request(baseUrl, `/api/teacher/records/${createRecord.body.recordId}/review`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherLogin.body.token}`
      },
      body: JSON.stringify({ status: 'approved', comment: 'Well documented.' })
    });

    assert.equal(review.status, 200);

    const statistics = await request(baseUrl, '/api/teacher/statistics', {
      headers: { Authorization: `Bearer ${teacherLogin.body.token}` }
    });

    assert.equal(statistics.status, 200);
    assert.equal(statistics.body.statistics.total_records, 1);
    assert.equal(statistics.body.statistics.approved_count, 1);
    assert.equal(statistics.body.statistics.student_count, 2);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
