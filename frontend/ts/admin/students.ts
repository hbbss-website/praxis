import {
  API_URL, escapeHtml, readJson, requireElement, requireRole, type ApiError
} from '../shared';
import { renderSidebar } from '../components/sidebar';

type AnyUser = { id: number; uid: string; name: string; role: string; created_at: string };

const session = requireRole('admin', '../login.html');
if (!session) throw new Error('Unauthorized');
const s = session;
const headers = () => ({ Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' });
const authOnly = () => ({ Authorization: `Bearer ${s.token}` });

renderSidebar({ role: 'admin', activePath: 'students.html', user: s.user });

const stuTable = requireElement<HTMLElement>('#stu-table');

async function loadUserList() {
  try {
    const res = await fetch(`${API_URL}/admin/users?role=student`, { headers: authOnly() });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    const data = await readJson<{ users: AnyUser[] }>(res);
    if (!data) return;

    if (!data.users.length) { stuTable.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:40px">暂无学生</td></tr>`; return; }
    stuTable.innerHTML = data.users.map((u) => `<tr>
      <td>${escapeHtml(u.uid)}</td>
      <td>${escapeHtml(u.name)}</td>
      <td><div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-secondary" type="button" data-action="edit-user" data-user-id="${u.id}" data-user-name="${escapeHtml(u.name)}">编辑</button>
        <button class="btn btn-sm btn-danger" type="button" data-action="delete-user" data-user-id="${u.id}">删除</button>
      </div></td>
    </tr>`).join('');
  } catch { stuTable.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:40px;color:var(--danger)">加载失败</td></tr>'; }
}

stuTable.addEventListener('click', (e: Event) => {
  const el = (e.target as Element)?.closest<HTMLButtonElement>('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'edit-user') openEditUserModal(Number(el.dataset.userId), el.dataset.userName ?? '');
  if (el.dataset.action === 'delete-user' && window.confirm('确定删除该用户？'))
    void deleteUser(Number(el.dataset.userId));
});

// Edit user modal
const editUserModal = requireElement<HTMLElement>('#edit-user-modal');
const editUserName = requireElement<HTMLInputElement>('#edit-user-name');
const editUserPassword = requireElement<HTMLInputElement>('#edit-user-password');
const editUserError = requireElement<HTMLElement>('#edit-user-error');
const editUserSave = requireElement<HTMLButtonElement>('#save-edit-user');
let editUserId: number | null = null;

const closeEditUser = () => { editUserModal.classList.remove('show'); editUserId = null; editUserError.classList.remove('show'); };
requireElement('#close-edit-user').addEventListener('click', closeEditUser);
requireElement('#cancel-edit-user').addEventListener('click', closeEditUser);
editUserModal.addEventListener('click', (e) => { if (e.target === editUserModal) closeEditUser(); });

function openEditUserModal(id: number, name: string) {
  editUserId = id;
  editUserName.value = name;
  editUserPassword.value = '';
  editUserError.classList.remove('show');
  editUserModal.classList.add('show');
}

editUserSave.addEventListener('click', async () => {
  if (!editUserId) return;
  const name = editUserName.value.trim();
  const password = editUserPassword.value;
  if (password && password.length < 8) { editUserError.textContent = '密码至少需要8位。'; editUserError.classList.add('show'); return; }
  try {
    editUserSave.disabled = true; editUserSave.textContent = '保存中...';
    const body: Record<string, string> = {};
    if (name) body.name = name;
    if (password) body.password = password;
    const res = await fetch(`${API_URL}/admin/users/${editUserId}`, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    const data = await readJson<ApiError>(res);
    if (!res.ok) { editUserError.textContent = data?.error ?? '更新失败。'; editUserError.classList.add('show'); return; }
    closeEditUser(); void loadUserList();
  } catch { editUserError.textContent = '连接失败。'; editUserError.classList.add('show'); }
  finally { editUserSave.disabled = false; editUserSave.textContent = '保存'; }
});

async function deleteUser(id: number) {
  try {
    const res = await fetch(`${API_URL}/admin/users/${id}`, { method: 'DELETE', headers: authOnly() });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    const data = await readJson<ApiError>(res);
    if (!res.ok) { window.alert(data?.error ?? '删除失败。'); return; }
    void loadUserList();
  } catch { window.alert('删除失败。'); }
}

void loadUserList();
