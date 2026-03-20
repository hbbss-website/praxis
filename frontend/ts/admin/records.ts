import {
  API_URL, escapeHtml, formatDate, formatDateTime, getApiOrigin,
  readJson, requireElement, requireRole, type ApiError
} from '../shared';
import { renderSidebar } from '../components/sidebar';

type TeacherRecord = {
  id: number; student_name: string; student_uid: string;
  title: string; content: string; practice_date: string; duration: number | null;
  location: string | null; image_path: string | null; status: string;
  teacher_comment: string | null; created_at: string; updated_at: string; updated_by_uid: string | null;
};

const session = requireRole('admin', '../login.html');
if (!session) throw new Error('Unauthorized');
const s = session;
const headers = () => ({ Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' });
const authOnly = () => ({ Authorization: `Bearer ${s.token}` });

renderSidebar({ role: 'admin', activePath: 'records.html', user: s.user });

const recTable = requireElement<HTMLElement>('#rec-table');
const recFilterStudent = requireElement<HTMLSelectElement>('#rec-filter-student');
const recFilterStatus = requireElement<HTMLSelectElement>('#rec-filter-status');
const recCreatedAfter = requireElement<HTMLInputElement>('#rec-filter-created-after');
const recCreatedBefore = requireElement<HTMLInputElement>('#rec-filter-created-before');
const recSelectAll = requireElement<HTMLInputElement>('#rec-select-all');
const recBatchBar = requireElement<HTMLElement>('#rec-batch-bar');
const recBatchCount = requireElement<HTMLElement>('#rec-batch-count');
const recSelectedIds = new Set<number>();

requireElement('#rec-refresh').addEventListener('click', () => void loadRecords());
recFilterStudent.addEventListener('change', () => void loadRecords());
recFilterStatus.addEventListener('change', () => void loadRecords());
recCreatedAfter.addEventListener('change', () => void loadRecords());
recCreatedBefore.addEventListener('change', () => void loadRecords());

recSelectAll.addEventListener('change', () => {
  recSelectedIds.clear();
  recTable.querySelectorAll<HTMLInputElement>('.rec-cb').forEach((cb) => {
    cb.checked = recSelectAll.checked;
    if (recSelectAll.checked) recSelectedIds.add(Number(cb.dataset.id));
  });
  updateRecBatch();
});

recTable.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (!t.classList.contains('rec-cb')) return;
  t.checked ? recSelectedIds.add(Number(t.dataset.id)) : recSelectedIds.delete(Number(t.dataset.id));
  updateRecBatch();
});

recTable.addEventListener('click', (e) => {
  const el = (e.target as Element)?.closest<HTMLButtonElement>('[data-action]');
  if (!el) return;
  const id = Number(el.dataset.recordId);
  if (el.dataset.action === 'review') void openReviewModal(id);
  if (el.dataset.action === 'delete' && window.confirm('确定删除？')) void deleteRecord(id);
});

requireElement('#rec-batch-approve').addEventListener('click', () => void recBatchAction('approved'));
requireElement('#rec-batch-reject').addEventListener('click', () => void recBatchAction('rejected'));
requireElement('#rec-batch-undo').addEventListener('click', () => void recBatchAction('pending'));
requireElement('#rec-batch-delete').addEventListener('click', () => {
  if (window.confirm(`确定删除 ${recSelectedIds.size} 条记录？`)) void recBatchAction('deleted');
});

function updateRecBatch() {
  recBatchBar.style.display = recSelectedIds.size > 0 ? 'flex' : 'none';
  recBatchCount.textContent = `已选 ${recSelectedIds.size} 条`;
}

async function loadRecords() {
  try {
    const q = new URLSearchParams();
    if (recFilterStudent.value) q.set('student_id', recFilterStudent.value);
    if (recFilterStatus.value) q.set('status', recFilterStatus.value);
    if (recCreatedAfter.value) q.set('created_after', new Date(recCreatedAfter.value).toISOString());
    if (recCreatedBefore.value) { const d = new Date(recCreatedBefore.value); d.setHours(23, 59, 59, 999); q.set('created_before', d.toISOString()); }
    const qs = q.toString();
    const res = await fetch(`${API_URL}/teacher/records${qs ? `?${qs}` : ''}`, { headers: authOnly() });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    const data = await readJson<{ records: TeacherRecord[] }>(res);
    if (!data) return;
    recSelectedIds.clear(); recSelectAll.checked = false; updateRecBatch();
    renderRecords(data.records);
  } catch { recTable.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--danger)">加载失败</td></tr>'; }
}

function renderRecords(records: TeacherRecord[]) {
  if (!records.length) { recTable.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px">暂无记录</td></tr>'; return; }
  recTable.innerHTML = records.map((r) => `<tr>
    <td><input type="checkbox" class="rec-cb" data-id="${r.id}"></td>
    <td><strong>${escapeHtml(r.student_name)}</strong><br><small>${escapeHtml(r.student_uid)}</small></td>
    <td>${escapeHtml(r.title)}</td>
    <td>${formatDate(r.practice_date, '-')}</td>
    <td>${r.duration ? `${r.duration}h` : '-'}</td>
    <td><span class="status-badge status-${r.status}">${statusLabel(r.status)}</span></td>
    <td>${formatDateTime(r.created_at)}</td>
    <td><div style="display:flex;gap:6px">
      <button class="btn btn-sm" style="background:var(--primary);color:white" type="button" data-action="review" data-record-id="${r.id}">审核</button>
      <button class="btn btn-sm btn-danger" type="button" data-action="delete" data-record-id="${r.id}">删除</button>
    </div></td>
  </tr>`).join('');
}

async function recBatchAction(action: string) {
  try {
    const res = await fetch(`${API_URL}/teacher/records/batch-review`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ ids: [...recSelectedIds], action })
    });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    recSelectedIds.clear(); recSelectAll.checked = false; updateRecBatch();
    void loadRecords();
  } catch { window.alert('批量操作失败。'); }
}

async function deleteRecord(id: number) {
  try {
    const res = await fetch(`${API_URL}/teacher/records/${id}`, { method: 'DELETE', headers: authOnly() });
    if (res.status === 401) { window.location.href = '../login.html'; return; }
    void loadRecords();
  } catch { window.alert('删除失败。'); }
}

// Review Modal
const reviewModal = requireElement<HTMLElement>('#review-modal');
const reviewContent = requireElement<HTMLElement>('#review-content');
const reviewComment = requireElement<HTMLTextAreaElement>('#review-comment');
let reviewRecordId: number | null = null;

const closeReview = () => { reviewModal.classList.remove('show'); reviewRecordId = null; reviewComment.value = ''; };
requireElement('#close-review-modal').addEventListener('click', closeReview);
requireElement('#cancel-review').addEventListener('click', closeReview);
reviewModal.addEventListener('click', (e) => { if (e.target === reviewModal) closeReview(); });
requireElement('#approve-review').addEventListener('click', () => void submitReview('approved'));
requireElement('#reject-review').addEventListener('click', () => void submitReview('rejected'));
requireElement('#undo-review').addEventListener('click', () => void submitReview('pending'));

async function openReviewModal(id: number) {
  reviewRecordId = id;
  try {
    const res = await fetch(`${API_URL}/teacher/records/${id}`, { headers: authOnly() });
    const data = await readJson<{ record: TeacherRecord }>(res);
    if (!data) return;
    const r = data.record;
    reviewContent.innerHTML = `
      <p><strong>学生：</strong>${escapeHtml(r.student_name)}</p>
      <p><strong>标题：</strong>${escapeHtml(r.title)}</p>
      <p><strong>日期：</strong>${formatDate(r.practice_date)}${r.duration ? ` | ${r.duration}h` : ''}${r.location ? ` | ${escapeHtml(r.location)}` : ''}</p>
      <div style="padding:12px;background:var(--gray-100);border-radius:8px;margin:12px 0">${escapeHtml(r.content)}</div>
      ${r.image_path ? `<img src="${getApiOrigin()}${r.image_path}" style="max-width:100%;max-height:300px;border-radius:8px">` : ''}`;
    reviewComment.value = r.teacher_comment ?? '';
    reviewModal.classList.add('show');
  } catch { window.alert('加载记录详情失败。'); }
}

async function submitReview(status: string) {
  if (!reviewRecordId) return;
  try {
    await fetch(`${API_URL}/teacher/records/${reviewRecordId}/review`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ status, comment: reviewComment.value.trim() })
    });
    closeReview(); void loadRecords();
  } catch { window.alert('保存审核结果失败。'); }
}

// Load filter options
async function loadFilterStudents() {
  try {
    const res = await fetch(`${API_URL}/admin/users?role=student`, { headers: authOnly() });
    const data = await readJson<{ users: {id: number, name: string}[] }>(res);
    if (!data) return;
    recFilterStudent.innerHTML = `<option value="">全部学生</option>` +
      data.users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
  } catch { }
}

void loadFilterStudents();
void loadRecords();

function statusLabel(s: string): string {
  return s === 'approved' ? '已通过' : s === 'rejected' ? '已驳回' : '待审核';
}
