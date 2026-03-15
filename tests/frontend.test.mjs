import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('frontend entry pages exist and link shared stylesheet', () => {
  const pages = [
    'frontend/login.html',
    'frontend/student/dashboard.html',
    'frontend/student/upload.html',
    'frontend/teacher/dashboard.html'
  ];

  for (const page of pages) {
    assert.ok(fs.existsSync(path.join(rootDir, page)), `${page} should exist`);
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="(\.\.\/)?css\/style\.css">/);
    assert.match(html, /<script>/);
  }
});

test('login page posts credentials to the backend auth endpoint', () => {
  const html = read('frontend/login.html');
  assert.match(html, /id="login-form"/);
  assert.match(html, /const API_URL = 'http:\/\/localhost:3000\/api';/);
  assert.match(html, /fetch\(`\$\{API_URL\}\/auth\/login`/);
  assert.match(html, /localStorage\.setItem\('token'/);
});

test('student pages call the expected protected endpoints', () => {
  const dashboard = read('frontend/student/dashboard.html');
  const upload = read('frontend/student/upload.html');

  assert.match(dashboard, /fetch\(`\$\{API_URL\}\/student\/records`/);
  assert.match(dashboard, /Authorization': `Bearer \$\{token\}`/);
  assert.match(upload, /fetch\(`\$\{API_URL\}\/upload`/);
  assert.match(upload, /fetch\(`\$\{API_URL\}\/student\/records`/);
  assert.match(upload, /id="upload-form"/);
});

test('teacher dashboard loads lists, statistics, and review actions', () => {
  const html = read('frontend/teacher/dashboard.html');

  assert.match(html, /fetch\(`\$\{API_URL\}\/teacher\/students`/);
  assert.match(html, /fetch\(`\$\{API_URL\}\/teacher\/records/);
  assert.match(html, /fetch\(`\$\{API_URL\}\/teacher\/statistics`/);
  assert.match(html, /fetch\(`\$\{API_URL\}\/teacher\/records\/\$\{currentRecordId\}\/review`/);
  assert.match(html, /id="review-modal"/);
});
