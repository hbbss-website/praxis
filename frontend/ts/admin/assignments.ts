import {
  API_URL, escapeHtml, readJson, requireElement, requireRole
} from '../shared';
import { renderSidebar } from '../components/sidebar';

type AnyUser = { id: number; uid: string; name: string; role: string; created_at: string };
type Assignment = { teacher_id: number; student_id: number };

const session = requireRole('admin', '../login.html');
if (!session) throw new Error('Unauthorized');
const s = session;
const headers = () => ({ Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' });
const authOnly = () => ({ Authorization: `Bearer ${s.token}` });

renderSidebar({ role: 'admin', activePath: 'assignments.html', user: s.user });

const assignTeacher = requireElement<HTMLSelectElement>('#assign-teacher');
const assignTable = requireElement<HTMLElement>('#assign-table');
const assignSelectAll = requireElement<HTMLInputElement>('#assign-select-all');
const assignSelectedIds = new Set<number>();

assignSelectAll.addEventListener('change', () => {
  assignSelectedIds.clear();
  assignTable.querySelectorAll<HTMLInputElement>('.assign-cb').forEach((cb) => {
    cb.checked = assignSelectAll.checked;
    if (assignSelectAll.checked) assignSelectedIds.add(Number(cb.dataset.id));
  });
});

assignTable.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (!t.classList.contains('assign-cb')) return;
  t.checked ? assignSelectedIds.add(Number(t.dataset.id)) : assignSelectedIds.delete(Number(t.dataset.id));
});

requireElement('#assign-btn').addEventListener('click', async () => {
  const teacherId = Number(assignTeacher.value);
  if (!teacherId || !assignSelectedIds.size) { window.alert('请选择教师和至少一个学生。'); return; }
  try {
    await fetch(`${API_URL}/admin/assignments`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ teacher_id: teacherId, student_ids: [...assignSelectedIds] })
    });
    void loadAssignments();
  } catch { window.alert('分配失败。'); }
});

requireElement('#unassign-btn').addEventListener('click', async () => {
  const teacherId = Number(assignTeacher.value);
  if (!teacherId || !assignSelectedIds.size) { window.alert('请选择教师和至少一个学生。'); return; }
  try {
    await fetch(`${API_URL}/admin/assignments`, {
      method: 'DELETE', headers: headers(),
      body: JSON.stringify({ teacher_id: teacherId, student_ids: [...assignSelectedIds] })
    });
    void loadAssignments();
  } catch { window.alert('取消分配失败。'); }
});

async function loadAssignments() {
  try {
    const res = await fetch(`${API_URL}/admin/assignments`, { headers: authOnly() });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    const data = await readJson<{ assignments: Assignment[]; teachers: AnyUser[]; students: AnyUser[] }>(res);
    if (!data) return;

    assignTeacher.innerHTML = `<option value="">选择教师</option>` +
      data.teachers.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}（${escapeHtml(t.uid)}）</option>`).join('');

    const teacherMap = new Map<number, AnyUser>();
    data.teachers.forEach((t) => teacherMap.set(t.id, t));
    const studentTeacher = new Map<number, number>();
    data.assignments.forEach((a) => studentTeacher.set(a.student_id, a.teacher_id));

    assignSelectedIds.clear(); assignSelectAll.checked = false;

    if (!data.students.length) { assignTable.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px">暂无学生</td></tr>'; return; }
    assignTable.innerHTML = data.students.map((st) => {
      const tid = studentTeacher.get(st.id);
      const teacher = tid ? teacherMap.get(tid) : null;
      return `<tr>
        <td><input type="checkbox" class="assign-cb" data-id="${st.id}"></td>
        <td>${escapeHtml(st.uid)}</td>
        <td>${escapeHtml(st.name)}</td>
        <td>${teacher ? `${escapeHtml(teacher.name)}（${escapeHtml(teacher.uid)}）` : '<span style="color:var(--gray-400)">未分配</span>'}</td>
      </tr>`;
    }).join('');
  } catch { assignTable.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--danger)">加载失败</td></tr>'; }
}

void loadAssignments();
