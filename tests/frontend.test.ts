import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('前端页面正确引用样式文件和构建后的模块入口', () => {
  const pages = [
    {
      page: 'frontend/login.html',
      stylesheet: 'css/style.css',
      script: 'js/login.js'
    },
    {
      page: 'frontend/student/dashboard.html',
      stylesheet: '../css/style.css',
      script: '../js/student/dashboard.js'
    },
    {
      page: 'frontend/student/upload.html',
      stylesheet: '../css/style.css',
      script: '../js/student/upload.js'
    },
    {
      page: 'frontend/teacher/dashboard.html',
      stylesheet: '../css/style.css',
      script: '../js/teacher/dashboard.js'
    }
  ];

  for (const entry of pages) {
    const html = read(entry.page);
    expect(html).toMatch(new RegExp(`<link rel="stylesheet" href="${escapeForRegExp(entry.stylesheet)}">`));
    expect(html).toMatch(new RegExp(`<script type="module" src="${escapeForRegExp(entry.script)}"></script>`));
  }
});

test('前端 TypeScript 入口调用了预期的后端接口', () => {
  const expectations: Array<{ file: string; snippets: string[] }> = [
    {
      file: 'frontend/ts/shared.ts',
      snippets: ["export const API_URL = 'http://localhost:3000/api';"]
    },
    {
      file: 'frontend/ts/login.ts',
      snippets: ["from './shared'", 'fetch(`${API_URL}/auth/login`', 'storeSession(data.token, data.user)']
    },
    {
      file: 'frontend/ts/student/dashboard.ts',
      snippets: ['fetch(`${API_URL}/student/records`', 'Authorization: `Bearer ${token}`']
    },
    {
      file: 'frontend/ts/student/upload.ts',
      snippets: ['fetch(`${API_URL}/upload`', 'fetch(`${API_URL}/student/records`', "requireElement<HTMLFormElement>('#upload-form')"]
    },
    {
      file: 'frontend/ts/teacher/dashboard.ts',
      snippets: [
        'fetch(`${API_URL}/teacher/students`',
        'fetch(`${API_URL}/teacher/records',
        'fetch(`${API_URL}/teacher/statistics`',
        'fetch(`${API_URL}/teacher/records/${currentRecordId}/review`'
      ]
    }
  ];

  for (const expectation of expectations) {
    const source = read(expectation.file);

    for (const snippet of expectation.snippets) {
      expect(source.includes(snippet), `${expectation.file} should include ${snippet}`).toBe(true);
    }
  }
});

test('前端每个入口都生成了构建产物', () => {
  const outputs = [
    'frontend/js/login.js',
    'frontend/js/student/dashboard.js',
    'frontend/js/student/upload.js',
    'frontend/js/teacher/dashboard.js'
  ];

  for (const output of outputs) {
    const filePath = path.join(rootDir, output);
    expect(fs.existsSync(filePath), `${output} should exist after build`).toBe(true);
    expect(read(output).length > 0, `${output} should not be empty`).toBe(true);
  }
});

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
