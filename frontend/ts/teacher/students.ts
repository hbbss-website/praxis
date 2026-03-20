import { renderSidebar } from '../components/sidebar';
import {
  API_URL, escapeHtml, logout,
  readJson, requireElement, requireRole, type ApiError
} from '../shared';

interface Student { id: number; uid: string; name: string; }

const session = requireRole('teacher', '../login.html');
if (session) renderSidebar({ role: 'teacher', activePath: 'students.html', user: session.user });


if (session) {
  const activeSession = session;
    requireElement('#logout-button').addEventListener('click', () => logout('../login.html'));

  const studentsTable = requireElement<HTMLElement>('#students-table');
  const modal = requireElement<HTMLElement>('#edit-student-modal');
  const nameInput = requireElement<HTMLInputElement>('#edit-student-name');
  const passwordInput = requireElement<HTMLInputElement>('#edit-student-password');
  const errorEl = requireElement<HTMLElement>('#edit-student-error');
  const saveBtn = requireElement<HTMLButtonElement>('#save-edit-student');
  let editingId: number | null = null;

  const closeModal = () => { modal.classList.remove('show'); editingId = null; errorEl.classList.remove('show'); };
  requireElement('#close-edit-student').addEventListener('click', closeModal);
  requireElement('#cancel-edit-student').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  studentsTable.addEventListener('click', (e) => {
    const btn = (e.target as Element)?.closest<HTMLButtonElement>('[data-action="edit-student"]');
    if (!btn) return;
    editingId = Number(btn.dataset.studentId);
    nameInput.value = btn.dataset.studentName ?? '';
    passwordInput.value = '';
    errorEl.classList.remove('show');
    modal.classList.add('show');
  });

  saveBtn.addEventListener('click', async () => {
    if (!editingId) return;
    const name = nameInput.value.trim();
    const password = passwordInput.value;

    if (password && password.length < 8) {
      errorEl.textContent = '密码至少需要8位。';
      errorEl.classList.add('show');
      return;
    }

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';
      const body: Record<string, string> = {};
      if (name) body.name = name;
      if (password) body.password = password;

      const res = await fetch(`${API_URL}/teacher/students/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeSession.token}` },
        body: JSON.stringify(body)
      });
      if (res.status === 401) { logout('../login.html'); return; }
      const data = await readJson<ApiError & { message?: string }>(res);
      if (!res.ok) { errorEl.textContent = data?.error ?? '更新失败。'; errorEl.classList.add('show'); return; }
      closeModal();
      void loadStudents();
    } catch {
      errorEl.textContent = '无法连接到服务器。';
      errorEl.classList.add('show');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  });

  void loadStudents();

  async function loadStudents() {
    try {
      const res = await fetch(`${API_URL}/teacher/students`, {
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });
      if (res.status === 401) { logout('../login.html'); return; }
      const data = await readJson<{ students: Student[] } & ApiError>(res);
      if (!res.ok || !data) throw new Error('加载失败。');

      if (data.students.length === 0) {
        studentsTable.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 40px;">暂无分配的学生</td></tr>';
        return;
      }
      studentsTable.innerHTML = data.students.map((s) => `
        <tr>
          <td>${escapeHtml(s.uid)}</td>
          <td>${escapeHtml(s.name)}</td>
          <td>
            <button class="btn btn-sm btn-secondary" type="button" data-action="edit-student" data-student-id="${s.id}" data-student-name="${escapeHtml(s.name)}">编辑</button>
          </td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('加载学生列表失败。', error);
      studentsTable.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 40px; color: var(--danger);">加载学生列表失败。</td></tr>';
    }
  }
}
