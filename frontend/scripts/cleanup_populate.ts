import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const basePath = import.meta.dir;
const files = [
  'student/account.ts',
  'student/notifications.ts',
  'student/upload.ts',
  'student/dashboard.ts',
  'teacher/account.ts',
  'teacher/dashboard.ts',
  'teacher/students.ts',
  'admin/account.ts',
  'shared.ts'
];

for (const f of files) {
  const p = join(basePath, '..', 'ts', f);
  let content = readFileSync(p, 'utf-8');
  
  // Remove import
  content = content.replace(/,\s*populateUserSummary/g, '');
  content = content.replace(/populateUserSummary,\s*/g, '');
  content = content.replace(/populateUserSummary\s*,\s*/g, '');
  
  // Remove call
  content = content.replace(/populateUserSummary\([^)]+\);?\n?/g, '');
  
  if (f === 'shared.ts') {
    // Remove the function definition entirely from shared.ts
    // We can use a regex or since we know its signature:
    // export function populateUserSummary(nameSelector: string, avatarSelector: string, user: StoredUser): void { ... }
    const regex = /export function populateUserSummary.*?\}\n/s;
    content = content.replace(regex, '');
  }
  
  writeFileSync(p, content);
  console.log(`Cleaned up ${f}`);
}
