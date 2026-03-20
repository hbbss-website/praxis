import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const basePath = import.meta.dir;

const htmlFiles = [
  'student/dashboard.html',
  'student/upload.html',
  'student/notifications.html',
  'student/account.html',
  'teacher/dashboard.html',
  'teacher/students.html',
  'teacher/account.html',
  'admin/account.html'
];

for (const f of htmlFiles) {
  const p = join(basePath, '..', f);
  const content = readFileSync(p, 'utf-8');
  // Use regex to replace everything inside <aside class="sidebar">...</aside>
  const newContent = content.replace(/<aside class="sidebar">[\s\S]*?<\/aside>/, '<aside class="sidebar"></aside>');
  writeFileSync(p, newContent);
  console.log(`Updated HTML: ${f}`);
}

const tsFiles = [
  { file: 'student/dashboard.ts', role: 'student', path: 'dashboard.html' },
  { file: 'student/upload.ts', role: 'student', path: 'upload.html' },
  { file: 'student/notifications.ts', role: 'student', path: 'notifications.html' },
  { file: 'student/account.ts', role: 'student', path: 'account.html' },
  { file: 'teacher/dashboard.ts', role: 'teacher', path: 'dashboard.html' },
  { file: 'teacher/students.ts', role: 'teacher', path: 'students.html' },
  { file: 'teacher/account.ts', role: 'teacher', path: 'account.html' },
  { file: 'admin/account.ts', role: 'admin', path: 'account.html' }
];

for (const t of tsFiles) {
  const p = join(basePath, '..', 'ts', t.file);
  let content = readFileSync(p, 'utf-8');
  
  // Need to append the import and renderSidebar call
  if (!content.includes('renderSidebar')) {
    content = `import { renderSidebar } from '../components/sidebar';\n` + content;
    
    // Inject renderSidebar({ role: '${t.role}', activePath: '${t.path}', user: s.user });
    // Find const session = requireRole(...) or similar
    if (content.includes('const session = requireRole')) {
        content = content.replace(/(const session = requireRole.*?;)/, `$1\nif (session) renderSidebar({ role: '${t.role}', activePath: '${t.path}', user: session.user });\n`);
    } else {
        // Fallback
        content += `\nrenderSidebar({ role: '${t.role}', activePath: '${t.path}', user: { name: 'User', uid: '0', role: '${t.role}', created_at: '' } });\n`;
    }
    
    writeFileSync(p, content);
    console.log(`Updated TS: ${t.file}`);
  }
}
