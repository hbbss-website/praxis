import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('旧前端已迁移到 frontend-legacy，新前端使用 Vite 入口', () => {
  expect(fs.existsSync(path.join(rootDir, 'frontend', 'src'))).toBe(true);
  expect(fs.existsSync(path.join(rootDir, 'frontend-legacy'))).toBe(false);
  expect(read('frontend/index.html')).toContain('/src/main.tsx');
  expect(read('frontend/index.html')).toContain('<div id="root"></div>');
  expect(read('frontend/src/main.tsx')).toContain("import { App } from './app';");
  expect(read('frontend/vite.config.ts')).toContain("defineConfig");
});

test('React 前端继续调用原有后端接口', () => {
  const expectations: Array<{ file: string; snippets: string[] }> = [
    {
      file: 'frontend/src/lib/types.ts',
      snippets: [
        "const envApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\\/$/, '');",
        "export const API_URL = envApiUrl || '/api';"
      ]
    },
    {
      file: 'frontend/src/lib/api.ts',
      snippets: [
        'fetch(`${API_URL}${path}`',
        "return apiRequest<{ token: string; user: StoredUser }>('/auth/login'",
        "return apiRequest<UploadResult>('/upload'"
      ]
    },
    {
      file: 'frontend/src/features/auth-page.tsx',
      snippets: ['login(uid.trim(), password)', 'signIn(data.token, data.user)', 'navigate(getDefaultPathByRole(data.user.role)']
    },
    {
      file: 'frontend/src/features/student-pages.tsx',
      snippets: [
        "'/student/records'",
        "'/student/notifications'",
        "'/auth/password'",
        'uploadImage(selectedImage, token)'
      ]
    },
    {
      file: 'frontend/src/features/teacher-pages.tsx',
      snippets: [
        "'/teacher/students'",
        '`/teacher/records',
        "'/teacher/statistics'",
        "'/teacher/records/batch-review'"
      ]
    },
    {
      file: 'frontend/src/features/admin-pages.tsx',
      snippets: [
        "'/admin/users'",
        "'/admin/users/import'",
        "'/admin/assignments'"
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

test('学生端导航和卡片组件符合当前界面结构', () => {
  const appShell = read('frontend/src/layout/app-shell.tsx');
  expect(appShell).toContain('function NotificationBadge');
  expect(appShell).toContain("to === '/student/notifications'");
  expect(appShell).toContain("{count > 99 ? '99+' : count}");
  expect(appShell.includes('未读通知')).toBe(false);

  const adminPages = read('frontend/src/features/admin-pages.tsx');
  expect(adminPages.includes('可用教师')).toBe(false);

  const card = read('frontend/src/components/ui/card.tsx');
  expect(card).toContain('gap-1.5 p-6');
  expect(card).toContain('p-6 pt-0');
  expect(card).toContain('flex items-center p-6 pt-0');
});

test('前端构建产物会输出到 frontend/dist', () => {
  const outputs = ['frontend/dist/index.html'];
  for (const output of outputs) {
    const filePath = path.join(rootDir, output);
    expect(fs.existsSync(filePath), `${output} should exist after build`).toBe(true);
    expect(read(output).length > 0, `${output} should not be empty`).toBe(true);
  }
});
