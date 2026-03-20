import {
  API_URL, escapeHtml, readJson, requireElement, requireRole, type ApiError
} from '../shared';
import { renderSidebar } from '../components/sidebar';

const session = requireRole('admin', '../login.html');
if (!session) throw new Error('Unauthorized');
const s = session;
const headers = () => ({ Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' });

renderSidebar({ role: 'admin', activePath: 'users.html', user: s.user });

// Single user
const createForm = requireElement<HTMLFormElement>('#create-form');
const createError = requireElement<HTMLElement>('#create-error');
const createSuccess = requireElement<HTMLElement>('#create-success');

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  createError.classList.remove('show');
  createSuccess.style.display = 'none';
  const name = requireElement<HTMLInputElement>('#create-name').value.trim();
  const role = requireElement<HTMLSelectElement>('#create-role').value;
  try {
    const res = await fetch(`${API_URL}/admin/users`, { method: 'POST', headers: headers(), body: JSON.stringify({ name, role }) });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    const data = await readJson<ApiError & { user?: { uid: string; password: string } }>(res);
    if (!res.ok) { createError.textContent = data?.error ?? '创建失败。'; createError.classList.add('show'); return; }
    createSuccess.innerHTML = `创建成功！UID: <strong>${escapeHtml(data?.user?.uid ?? '')}</strong> 密码: <strong>${escapeHtml(data?.user?.password ?? '')}</strong>`;
    createSuccess.style.display = 'block';
    createForm.reset();
  } catch { createError.textContent = '连接失败。'; createError.classList.add('show'); }
});

// CSV import
const csvInput = requireElement<HTMLInputElement>('#csv-input');
const csvError = requireElement<HTMLElement>('#csv-error');
const csvPreview = requireElement<HTMLElement>('#csv-preview');
const csvImportBtn = requireElement<HTMLButtonElement>('#csv-import-btn');
const csvResult = requireElement<HTMLElement>('#csv-result');
let csvContent = '';

csvInput.addEventListener('change', () => {
  const file = csvInput.files?.[0];
  csvError.classList.remove('show');
  csvPreview.innerHTML = '';
  csvImportBtn.style.display = 'none';
  csvResult.innerHTML = '';
  csvContent = '';

  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { csvError.textContent = '文件超过 50 MiB 限制。'; csvError.classList.add('show'); return; }

  const reader = new FileReader();
  reader.onload = () => {
    csvContent = reader.result as string;
    const lines = csvContent.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { csvError.textContent = 'CSV无有效数据。'; csvError.classList.add('show'); return; }

    // Validate
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p) => p.trim());
      if (parts.length < 2 || !parts[0]) { csvError.textContent = `第 ${i + 1} 行格式无效。`; csvError.classList.add('show'); return; }
      if (!['student', 'teacher', 'admin'].includes(parts[1])) { csvError.textContent = `第 ${i + 1} 行角色无效。`; csvError.classList.add('show'); return; }
    }

    csvPreview.innerHTML = `<table><thead><tr><th>#</th><th>姓名</th><th>角色</th></tr></thead><tbody>` +
      lines.map((l, i) => { const p = l.split(','); return `<tr><td>${i + 1}</td><td>${escapeHtml(p[0])}</td><td>${escapeHtml(p[1])}</td></tr>`; }).join('') +
      `</tbody></table><p style="margin-top:8px">共 ${lines.length} 条记录</p>`;
    csvImportBtn.style.display = 'inline-block';
  };
  reader.readAsText(file);
});

csvImportBtn.addEventListener('click', async () => {
  if (!csvContent) return;
  csvImportBtn.disabled = true; csvImportBtn.textContent = '导入中...';
  try {
    const res = await fetch(`${API_URL}/admin/users/import`, { method: 'POST', headers: headers(), body: JSON.stringify({ csv: csvContent }) });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    const data = await readJson<ApiError & { users?: Array<{ name: string; uid: string; role: string; password: string }> }>(res);
    if (!res.ok) { csvError.textContent = data?.error ?? '导入失败。'; csvError.classList.add('show'); return; }
    if (data?.users) renderImportResult(data.users);
    csvPreview.innerHTML = '';
    csvImportBtn.style.display = 'none';
    csvInput.value = '';
    csvContent = '';
  } catch { csvError.textContent = '连接失败。'; csvError.classList.add('show'); }
  finally { csvImportBtn.disabled = false; csvImportBtn.textContent = '确认导入'; }
});

function renderImportResult(users: Array<{ name: string; uid: string; role: string; password: string }>) {
  const csvData = users.map((u) => `${u.name},${u.uid},${u.role},${u.password}`).join('\n');
  const blob = new Blob([`name,uid,role,password\n${csvData}`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  csvResult.innerHTML = `
    <p style="margin-bottom:12px">成功导入 ${users.length} 个用户。<a href="${url}" download="imported_users.csv" style="color:var(--primary)">下载 CSV</a></p>
    <div style="max-height:300px;overflow:auto"><table><thead><tr><th>姓名</th><th>UID</th><th>角色</th><th>密码</th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.uid)}</td><td>${escapeHtml(u.role)}</td><td><code>${escapeHtml(u.password)}</code></td></tr>`).join('')}
    </tbody></table></div>`;
}

// Batch create
const batchContainer = requireElement<HTMLElement>('#batch-create-container');
const batchCreateError = requireElement<HTMLElement>('#batch-create-error');
const batchCreateResult = requireElement<HTMLElement>('#batch-create-result');

requireElement('#batch-add-row').addEventListener('click', () => {
  const div = document.createElement('div');
  div.className = 'batch-entry';
  div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:12px;margin-bottom:8px';
  div.innerHTML = `<input type="text" placeholder="姓名" class="batch-name">
    <select class="batch-role"><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select>
    <button class="btn btn-sm btn-danger batch-remove" type="button">×</button>`;
  batchContainer.appendChild(div);
});

batchContainer.addEventListener('click', (e) => {
  const btn = (e.target as Element)?.closest('.batch-remove');
  if (btn && batchContainer.children.length > 1) btn.closest('.batch-entry')?.remove();
});

requireElement('#batch-create-btn').addEventListener('click', async () => {
  batchCreateError.classList.remove('show');
  batchCreateResult.innerHTML = '';
  const entries: Array<{ name: string; role: string }> = [];
  batchContainer.querySelectorAll('.batch-entry').forEach((entry) => {
    const name = entry.querySelector<HTMLInputElement>('.batch-name')?.value.trim() ?? '';
    const role = entry.querySelector<HTMLSelectElement>('.batch-role')?.value ?? 'student';
    if (name) entries.push({ name, role });
  });
  if (!entries.length) { batchCreateError.textContent = '请至少填写一行。'; batchCreateError.classList.add('show'); return; }

  try {
    const res = await fetch(`${API_URL}/admin/users/batch`, { method: 'POST', headers: headers(), body: JSON.stringify({ entries }) });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    const data = await readJson<ApiError & { users?: Array<{ name: string; uid: string; role: string; password: string }> }>(res);
    if (!res.ok) { batchCreateError.textContent = data?.error ?? '批量创建失败。'; batchCreateError.classList.add('show'); return; }
    if (data?.users) renderImportResult2(data.users, batchCreateResult);
  } catch { batchCreateError.textContent = '连接失败。'; batchCreateError.classList.add('show'); }
});

function renderImportResult2(users: Array<{ name: string; uid: string; role: string; password: string }>, container: HTMLElement) {
  const csvData = users.map((u) => `${u.name},${u.uid},${u.role},${u.password}`).join('\n');
  const blob = new Blob([`name,uid,role,password\n${csvData}`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  container.innerHTML = `
    <p style="margin-bottom:12px">成功创建 ${users.length} 个用户。<a href="${url}" download="created_users.csv" style="color:var(--primary)">下载 CSV</a></p>
    <div style="max-height:300px;overflow:auto"><table><thead><tr><th>姓名</th><th>UID</th><th>角色</th><th>密码</th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.uid)}</td><td>${escapeHtml(u.role)}</td><td><code>${escapeHtml(u.password)}</code></td></tr>`).join('')}
    </tbody></table></div>`;
}
