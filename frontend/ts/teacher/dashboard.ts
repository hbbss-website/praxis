import { renderSidebar } from '../components/sidebar';
import {
  API_URL,
  escapeHtml,
  formatDate,
  formatDateTime,
  getApiOrigin,
  logout,
  readJson,
  requireElement,
  requireRole,
  type ApiError
} from '../shared';

type RecordStatus = 'approved' | 'pending' | 'rejected';

interface StudentOption { id: number; name: string; }

interface TeacherRecord {
  id: number;
  student_name: string;
  student_uid: string;
  title: string;
  content: string;
  practice_date: string;
  duration: number | null;
  location: string | null;
  image_path: string | null;
  status: RecordStatus;
  teacher_comment: string | null;
  created_at: string;
  updated_at: string;
  updated_by_uid: string | null;
}

interface StatisticsResponse extends ApiError {
  statistics: {
    approved_count: number;
    pending_count: number;
    student_count: number;
    total_records: number;
    total_duration: number;
    student_durations: Array<{
      student_id: number;
      student_name: string;
      student_uid: string;
      total_duration: number;
    }>;
  };
}

const session = requireRole('teacher', '../login.html');
if (session) renderSidebar({ role: 'teacher', activePath: 'dashboard.html', user: session.user });


if (session) {
  const activeSession = session;
  const logoutButton = requireElement<HTMLButtonElement>('#logout-button');
  const studentFilter = requireElement<HTMLSelectElement>('#filter-student');
  const statusFilter = requireElement<HTMLSelectElement>('#filter-status');
  const createdAfterFilter = requireElement<HTMLInputElement>('#filter-created-after');
  const createdBeforeFilter = requireElement<HTMLInputElement>('#filter-created-before');
  const refreshButton = requireElement<HTMLButtonElement>('#refresh-records-button');
  const recordsTable = requireElement<HTMLElement>('#records-table');
  const totalCount = requireElement<HTMLElement>('#total-count');
  const pendingCount = requireElement<HTMLElement>('#pending-count');
  const approvedCount = requireElement<HTMLElement>('#approved-count');
  const studentCount = requireElement<HTMLElement>('#student-count');
  const studentDurationList = requireElement<HTMLElement>('#student-duration-list');
  const reviewModal = requireElement<HTMLElement>('#review-modal');
  const modalContent = requireElement<HTMLElement>('#modal-content');
  const reviewComment = requireElement<HTMLTextAreaElement>('#review-comment');
  const editModal = requireElement<HTMLElement>('#edit-modal');
  const editTitleInput = requireElement<HTMLInputElement>('#edit-title');
  const editDateInput = requireElement<HTMLInputElement>('#edit-date');
  const editDurationInput = requireElement<HTMLInputElement>('#edit-duration');
  const editLocationInput = requireElement<HTMLInputElement>('#edit-location');
  const editContentInput = requireElement<HTMLTextAreaElement>('#edit-content');
  const saveEditButton = requireElement<HTMLButtonElement>('#save-edit-button');
  const selectAllCheckbox = requireElement<HTMLInputElement>('#select-all');
  const batchBar = requireElement<HTMLElement>('#batch-bar');
  const batchCountEl = requireElement<HTMLElement>('#batch-count');

  let currentRecordId: number | null = null;
  const selectedIds = new Set<number>();

    logoutButton.addEventListener('click', () => logout('../login.html'));

  const refreshAll = () => { void loadRecords(); void loadStatistics(); };
  studentFilter.addEventListener('change', () => void loadRecords());
  statusFilter.addEventListener('change', () => void loadRecords());
  createdAfterFilter.addEventListener('change', () => void loadRecords());
  createdBeforeFilter.addEventListener('change', () => void loadRecords());
  refreshButton.addEventListener('click', refreshAll);

  // Review modal
  const closeReview = () => { reviewModal.classList.remove('show'); reviewComment.value = ''; currentRecordId = null; };
  requireElement('#close-review-modal').addEventListener('click', closeReview);
  requireElement('#cancel-review-button').addEventListener('click', closeReview);
  requireElement('#undo-review-button').addEventListener('click', () => void submitReview('pending'));
  requireElement('#reject-review-button').addEventListener('click', () => void submitReview('rejected'));
  requireElement('#approve-review-button').addEventListener('click', () => void submitReview('approved'));
  reviewModal.addEventListener('click', (e) => { if (e.target === reviewModal) closeReview(); });

  // Edit modal
  const closeEdit = () => { editModal.classList.remove('show'); currentRecordId = null; };
  requireElement('#close-edit-modal').addEventListener('click', closeEdit);
  requireElement('#cancel-edit-button').addEventListener('click', closeEdit);
  saveEditButton.addEventListener('click', () => void saveEdit());
  editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEdit(); });

  // Batch operations
  requireElement('#batch-approve-btn').addEventListener('click', () => void batchAction('approved'));
  requireElement('#batch-reject-btn').addEventListener('click', () => void batchAction('rejected'));
  requireElement('#batch-undo-btn').addEventListener('click', () => void batchAction('pending'));
  requireElement('#batch-delete-btn').addEventListener('click', () => {
    if (window.confirm(`确定要删除选中的 ${selectedIds.size} 条记录吗？`)) void batchAction('deleted');
  });

  selectAllCheckbox.addEventListener('change', () => {
    const checkboxes = recordsTable.querySelectorAll<HTMLInputElement>('.record-checkbox');
    checkboxes.forEach((cb) => { cb.checked = selectAllCheckbox.checked; });
    selectedIds.clear();
    if (selectAllCheckbox.checked) {
      checkboxes.forEach((cb) => selectedIds.add(Number(cb.dataset.id)));
    }
    updateBatchBar();
  });

  recordsTable.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (!target.classList.contains('record-checkbox')) return;
    const id = Number(target.dataset.id);
    target.checked ? selectedIds.add(id) : selectedIds.delete(id);
    updateBatchBar();
  });

  recordsTable.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const reviewBtn = target?.closest<HTMLButtonElement>('[data-action="open-review"]');
    if (reviewBtn) { void openReviewModal(Number(reviewBtn.dataset.recordId)); return; }
    const editBtn = target?.closest<HTMLButtonElement>('[data-action="edit-record"]');
    if (editBtn) { void openEditModal(Number(editBtn.dataset.recordId)); return; }
    const deleteBtn = target?.closest<HTMLButtonElement>('[data-action="delete-record"]');
    if (deleteBtn && window.confirm('确定要删除这条实践记录吗？')) {
      void deleteRecord(Number(deleteBtn.dataset.recordId));
    }
  });

  void loadStudents();
  refreshAll();

  function updateBatchBar() {
    batchBar.style.display = selectedIds.size > 0 ? 'flex' : 'none';
    batchCountEl.textContent = `已选 ${selectedIds.size} 条`;
  }

  async function batchAction(action: string) {
    try {
      const response = await fetch(`${API_URL}/teacher/records/batch-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeSession.token}` },
        body: JSON.stringify({ ids: [...selectedIds], action })
      });
      if (response.status === 401) { logout('../login.html'); return; }
      const data = await readJson<ApiError & { message?: string }>(response);
      if (!response.ok) throw new Error(data?.error ?? '批量操作失败。');
      selectedIds.clear();
      selectAllCheckbox.checked = false;
      updateBatchBar();
      refreshAll();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '批量操作失败。');
    }
  }

  async function loadStudents() {
    try {
      const res = await fetch(`${API_URL}/teacher/students`, {
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });
      if (res.status === 401) { logout('../login.html'); return; }
      const data = await readJson<{ students: StudentOption[] } & ApiError>(res);
      if (!res.ok || !data) return;
      studentFilter.innerHTML = `<option value="">全部学生</option>` +
        data.students.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    } catch (error) { console.error('加载学生列表失败。', error); }
  }

  async function loadRecords() {
    try {
      const query = new URLSearchParams();
      if (studentFilter.value) query.set('student_id', studentFilter.value);
      if (statusFilter.value) query.set('status', statusFilter.value);
      if (createdAfterFilter.value) query.set('created_after', new Date(createdAfterFilter.value).toISOString());
      if (createdBeforeFilter.value) {
        const d = new Date(createdBeforeFilter.value);
        d.setHours(23, 59, 59, 999);
        query.set('created_before', d.toISOString());
      }
      const qs = query.toString();
      const res = await fetch(`${API_URL}/teacher/records${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });
      if (res.status === 401) { logout('../login.html'); return; }
      const data = await readJson<{ records: TeacherRecord[] } & ApiError>(res);
      if (!res.ok || !data) throw new Error(data?.error ?? '加载记录失败。');
      selectedIds.clear();
      selectAllCheckbox.checked = false;
      updateBatchBar();
      renderRecords(data.records);
    } catch (error) {
      console.error('加载记录失败。', error);
      recordsTable.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--danger);">加载记录失败。</td></tr>`;
    }
  }

  async function loadStatistics() {
    try {
      const res = await fetch(`${API_URL}/teacher/statistics`, {
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });
      if (res.status === 401) { logout('../login.html'); return; }
      const data = await readJson<StatisticsResponse>(res);
      if (!res.ok || !data) return;
      totalCount.textContent = String(data.statistics.total_records);
      pendingCount.textContent = String(data.statistics.pending_count);
      approvedCount.textContent = String(data.statistics.approved_count);
      studentCount.textContent = String(data.statistics.student_count);
      renderDurations(data.statistics.student_durations);
    } catch (error) { console.error('加载统计数据失败。', error); }
  }

  async function openReviewModal(recordId: number) {
    currentRecordId = recordId;
    try {
      const res = await fetch(`${API_URL}/teacher/records/${recordId}`, {
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });
      if (res.status === 401) { logout('../login.html'); return; }
      const data = await readJson<{ record: TeacherRecord } & ApiError>(res);
      if (!res.ok || !data) throw new Error(data?.error ?? '加载记录详情失败。');
      const r = data.record;
      modalContent.innerHTML = `
        <div style="margin-bottom: 16px;"><strong>学生：</strong>${escapeHtml(r.student_name)}</div>
        <div style="margin-bottom: 16px;"><strong>标题：</strong>${escapeHtml(r.title)}</div>
        <div style="margin-bottom: 16px;">
          <strong>实践日期：</strong>${formatDate(r.practice_date, '-')}
          ${r.duration ? ` | <strong>时长：</strong>${r.duration} 小时` : ''}
          ${r.location ? ` | <strong>地点：</strong>${escapeHtml(r.location)}` : ''}
        </div>
        <div style="margin-bottom: 16px;">
          <strong>内容：</strong>
          <p style="margin-top: 8px; padding: 12px; background: var(--gray-100); border-radius: 8px;">${escapeHtml(r.content)}</p>
        </div>
        ${r.image_path ? `<div><strong>图片：</strong><img src="${getApiOrigin()}${r.image_path}" alt="${escapeHtml(r.title)}" style="max-width: 100%; max-height: 300px; margin-top: 8px; border-radius: 8px;"></div>` : ''}
        ${r.teacher_comment ? `<div style="margin-top: 16px; padding: 12px; background: #dbeafe; border-radius: 8px;"><strong>当前评语：</strong>${escapeHtml(r.teacher_comment)}</div>` : ''}`;
      reviewComment.value = r.teacher_comment ?? '';
      reviewModal.classList.add('show');
    } catch (error) {
      console.error('加载记录详情失败。', error);
      window.alert('加载记录详情失败。');
    }
  }

  async function submitReview(status: 'approved' | 'rejected' | 'pending') {
    if (!currentRecordId) return;
    try {
      const res = await fetch(`${API_URL}/teacher/records/${currentRecordId}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeSession.token}` },
        body: JSON.stringify({ status, comment: reviewComment.value.trim() })
      });
      if (res.status === 401) { logout('../login.html'); return; }
      if (!res.ok) { const d = await readJson<ApiError>(res); throw new Error(d?.error ?? '保存审核结果失败。'); }
      closeReview();
      refreshAll();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '保存审核结果失败。');
    }
  }

  async function openEditModal(recordId: number) {
    currentRecordId = recordId;
    try {
      const res = await fetch(`${API_URL}/teacher/records/${recordId}`, {
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });
      if (res.status === 401) { logout('../login.html'); return; }
      const data = await readJson<{ record: TeacherRecord } & ApiError>(res);
      if (!res.ok || !data) throw new Error(data?.error ?? '加载记录详情失败。');
      const r = data.record;
      editTitleInput.value = r.title;
      editDateInput.value = r.practice_date.split('T')[0] ?? '';
      editDurationInput.value = r.duration ? String(r.duration) : '';
      editLocationInput.value = r.location ?? '';
      editContentInput.value = r.content;
      editModal.classList.add('show');
    } catch (error) { window.alert('加载记录详情失败。'); }
  }

  async function saveEdit() {
    if (!currentRecordId) return;
    try {
      saveEditButton.disabled = true;
      saveEditButton.textContent = '保存中...';
      const res = await fetch(`${API_URL}/teacher/records/${currentRecordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeSession.token}` },
        body: JSON.stringify({
          title: editTitleInput.value.trim(),
          practice_date: editDateInput.value,
          duration: editDurationInput.value,
          location: editLocationInput.value.trim() || null,
          content: editContentInput.value.trim()
        })
      });
      if (res.status === 401) { logout('../login.html'); return; }
      if (!res.ok) { const d = await readJson<ApiError>(res); throw new Error(d?.error ?? '保存修改失败。'); }
      closeEdit();
      refreshAll();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '保存修改失败。');
    } finally {
      saveEditButton.disabled = false;
      saveEditButton.textContent = '保存';
    }
  }

  async function deleteRecord(recordId: number) {
    try {
      const res = await fetch(`${API_URL}/teacher/records/${recordId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });
      if (res.status === 401) { logout('../login.html'); return; }
      if (!res.ok) { const d = await readJson<ApiError>(res); throw new Error(d?.error ?? '删除记录失败。'); }
      refreshAll();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '删除记录失败。');
    }
  }

  function renderRecords(records: TeacherRecord[]) {
    if (records.length === 0) {
      recordsTable.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 40px;"><div class="empty-state" style="padding: 20px;"><p>暂无记录</p></div></td></tr>`;
      return;
    }
    recordsTable.innerHTML = records.map((r) => `
      <tr>
        <td><input type="checkbox" class="record-checkbox" data-id="${r.id}"></td>
        <td><strong>${escapeHtml(r.student_name)}</strong></td>
        <td>${escapeHtml(r.title)}</td>
        <td>${formatDate(r.practice_date, '-')}</td>
        <td>${r.duration ? `${r.duration} 小时` : '-'}</td>
        <td>
          <span class="status-badge status-${r.status}">${statusLabel(r.status)}</span>
          ${r.updated_by_uid ? `<div class="record-edited-info" style="margin-top: 4px; font-size: 11px;">${escapeHtml(r.updated_by_uid)} 修改于 ${formatDate(r.updated_at, '-')}</div>` : ''}
        </td>
        <td>${formatDateTime(r.created_at)}</td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm" type="button" data-action="open-review" data-record-id="${r.id}" style="background: var(--primary); color: white;">审核</button>
            <button class="btn btn-sm btn-secondary" type="button" data-action="edit-record" data-record-id="${r.id}">修改</button>
            <button class="btn btn-sm btn-danger" type="button" data-action="delete-record" data-record-id="${r.id}">删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderDurations(durations: StatisticsResponse['statistics']['student_durations']) {
    if (durations.length === 0) {
      studentDurationList.innerHTML = '<p style="color: var(--gray-600);">暂无学生数据</p>';
      return;
    }
    studentDurationList.innerHTML = durations.map((d) => `
      <div class="duration-item">
        <div class="duration-name">${escapeHtml(d.student_name)}（${escapeHtml(d.student_uid)}）</div>
        <div class="duration-value">${formatDuration(d.total_duration)} 小时</div>
      </div>
    `).join('');
  }
}

function formatDuration(d: number): string {
  return Number.isInteger(d) ? String(d) : d.toFixed(1);
}

function statusLabel(status: string): string {
  return status === 'approved' ? '已通过' : status === 'rejected' ? '已驳回' : '待审核';
}
