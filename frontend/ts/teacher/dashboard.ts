import {
  API_URL,
  escapeHtml,
  formatDate,
  formatDateTime,
  getApiOrigin,
  logout,
  populateUserSummary,
  readJson,
  requireElement,
  requireRole,
  type ApiError
} from '../shared';

type RecordStatus = 'approved' | 'pending' | 'rejected';

interface StudentOption {
  id: number;
  name: string;
}

interface TeacherRecord {
  id: number;
  student_name: string;
  student_username: string;
  title: string;
  content: string;
  practice_date: string;
  duration: number | null;
  location: string | null;
  image_path: string | null;
  status: RecordStatus;
  teacher_comment: string | null;
  created_at: string;
}

interface StudentsResponse extends ApiError {
  students: StudentOption[];
}

interface TeacherRecordsResponse extends ApiError {
  records: TeacherRecord[];
}

interface TeacherRecordResponse extends ApiError {
  record: TeacherRecord;
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
      student_username: string;
      total_duration: number;
    }>;
  };
}

const session = requireRole('teacher', '../login.html');

if (session) {
  const activeSession = session;
  const logoutButton = requireElement<HTMLButtonElement>('#logout-button');
  const studentFilter = requireElement<HTMLSelectElement>('#filter-student');
  const statusFilter = requireElement<HTMLSelectElement>('#filter-status');
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
  const closeModalButton = requireElement<HTMLButtonElement>('#close-review-modal');
  const cancelReviewButton = requireElement<HTMLButtonElement>('#cancel-review-button');
  const rejectReviewButton = requireElement<HTMLButtonElement>('#reject-review-button');
  const approveReviewButton = requireElement<HTMLButtonElement>('#approve-review-button');

  let currentRecordId: number | null = null;

  populateUserSummary('#user-name', '#user-avatar', activeSession.user);
  logoutButton.addEventListener('click', () => logout('../login.html'));
  studentFilter.addEventListener('change', () => {
    void loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
  });
  statusFilter.addEventListener('change', () => {
    void loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
  });
  refreshButton.addEventListener('click', () => {
    void loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
    void loadStatistics(
      activeSession.token,
      totalCount,
      pendingCount,
      approvedCount,
      studentCount,
      studentDurationList
    );
  });
  closeModalButton.addEventListener('click', () => closeModal(reviewModal, reviewComment, () => {
    currentRecordId = null;
  }));
  cancelReviewButton.addEventListener('click', () => closeModal(reviewModal, reviewComment, () => {
    currentRecordId = null;
  }));
  rejectReviewButton.addEventListener('click', () => {
    void submitReview('rejected');
  });
  approveReviewButton.addEventListener('click', () => {
    void submitReview('approved');
  });
  reviewModal.addEventListener('click', (event) => {
    if (event.target === reviewModal) {
      closeModal(reviewModal, reviewComment, () => {
        currentRecordId = null;
      });
    }
  });
  recordsTable.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('[data-action="open-review"]');

    if (!button) {
      return;
    }

    const recordId = Number(button.dataset.recordId);

    if (!Number.isFinite(recordId)) {
      return;
    }

    void openReviewModal(recordId);
  });

  void loadStudents(activeSession.token, studentFilter);
  void loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
  void loadStatistics(
    activeSession.token,
    totalCount,
    pendingCount,
    approvedCount,
    studentCount,
    studentDurationList
  );

  async function openReviewModal(recordId: number): Promise<void> {
    currentRecordId = recordId;

    try {
      const response = await fetch(`${API_URL}/teacher/records/${recordId}`, {
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });

      if (response.status === 401) {
        logout('../login.html');
        return;
      }

      const data = await readJson<TeacherRecordResponse>(response);

      if (!response.ok || !data) {
        throw new Error(data?.error ?? '加载记录详情失败。');
      }

      const record = data.record;

      modalContent.innerHTML = `
        <div style="margin-bottom: 16px;">
          <strong>学生：</strong>${escapeHtml(record.student_name)}
        </div>
        <div style="margin-bottom: 16px;">
          <strong>标题：</strong>${escapeHtml(record.title)}
        </div>
        <div style="margin-bottom: 16px;">
          <strong>实践日期：</strong>${formatDate(record.practice_date, '-')}
          ${record.duration ? ` | <strong>时长：</strong>${record.duration} 小时` : ''}
          ${record.location ? ` | <strong>地点：</strong>${escapeHtml(record.location)}` : ''}
        </div>
        <div style="margin-bottom: 16px;">
          <strong>内容：</strong>
          <p style="margin-top: 8px; padding: 12px; background: var(--gray-100); border-radius: 8px;">
            ${escapeHtml(record.content)}
          </p>
        </div>
        ${
          record.image_path
            ? `<div>
                <strong>图片：</strong>
                <img
                  src="${getApiOrigin()}${record.image_path}"
                  alt="${escapeHtml(record.title)}"
                  style="max-width: 100%; max-height: 300px; margin-top: 8px; border-radius: 8px;"
                >
              </div>`
            : ''
        }
        ${
          record.teacher_comment
            ? `<div style="margin-top: 16px; padding: 12px; background: #dbeafe; border-radius: 8px;">
                <strong>当前评语：</strong>${escapeHtml(record.teacher_comment)}
              </div>`
            : ''
        }
      `;

      reviewComment.value = record.teacher_comment ?? '';
      reviewModal.classList.add('show');
    } catch (error) {
      console.error('加载记录详情失败。', error);
      window.alert('加载记录详情失败。');
    }
  }

  async function submitReview(status: 'approved' | 'rejected'): Promise<void> {
    if (!currentRecordId) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/teacher/records/${currentRecordId}/review`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeSession.token}`
        },
        body: JSON.stringify({
          status,
          comment: reviewComment.value.trim()
        })
      });

      if (response.status === 401) {
        logout('../login.html');
        return;
      }

      const data = await readJson<ApiError>(response);

      if (!response.ok) {
        throw new Error(data?.error ?? '保存审核结果失败。');
      }

      closeModal(reviewModal, reviewComment, () => {
        currentRecordId = null;
      });
      await loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
      await loadStatistics(
        activeSession.token,
        totalCount,
        pendingCount,
        approvedCount,
        studentCount,
        studentDurationList
      );
    } catch (error) {
      console.error('提交审核失败。', error);
      window.alert(error instanceof Error ? error.message : '保存审核结果失败。');
    }
  }
}

async function loadStudents(token: string, studentFilter: HTMLSelectElement): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/teacher/students`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      logout('../login.html');
      return;
    }

    const data = await readJson<StudentsResponse>(response);

    if (!response.ok || !data) {
      throw new Error(data?.error ?? '加载学生列表失败。');
    }

    studentFilter.innerHTML = `
      <option value="">全部学生</option>
      ${data.students
        .map((student) => `<option value="${student.id}">${escapeHtml(student.name)}</option>`)
        .join('')}
    `;
  } catch (error) {
    console.error('加载学生列表失败。', error);
  }
}

async function loadRecords(
  token: string,
  studentFilter: HTMLSelectElement,
  statusFilter: HTMLSelectElement,
  recordsTable: HTMLElement
): Promise<void> {
  try {
    const query = new URLSearchParams();

    if (studentFilter.value) {
      query.set('student_id', studentFilter.value);
    }

    if (statusFilter.value) {
      query.set('status', statusFilter.value);
    }

    const url = `${API_URL}/teacher/records${query.toString() ? `?${query.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      logout('../login.html');
      return;
    }

    const data = await readJson<TeacherRecordsResponse>(response);

    if (!response.ok || !data) {
      throw new Error(data?.error ?? '加载记录失败。');
    }

    renderRecords(recordsTable, data.records);
  } catch (error) {
    console.error('加载记录失败。', error);
    recordsTable.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 40px; color: var(--danger);">
          加载记录失败。
        </td>
      </tr>
    `;
  }
}

async function loadStatistics(
  token: string,
  totalCount: HTMLElement,
  pendingCount: HTMLElement,
  approvedCount: HTMLElement,
  studentCount: HTMLElement,
  studentDurationList: HTMLElement
): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/teacher/statistics`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      logout('../login.html');
      return;
    }

    const data = await readJson<StatisticsResponse>(response);

    if (!response.ok || !data) {
      throw new Error(data?.error ?? '加载统计数据失败。');
    }

    totalCount.textContent = String(data.statistics.total_records);
    pendingCount.textContent = String(data.statistics.pending_count);
    approvedCount.textContent = String(data.statistics.approved_count);
    studentCount.textContent = String(data.statistics.student_count);
    renderStudentDurations(studentDurationList, data.statistics.student_durations);
  } catch (error) {
    console.error('加载统计数据失败。', error);
  }
}

function formatDuration(duration: number): string {
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(1);
}

function renderStudentDurations(
  container: HTMLElement,
  studentDurations: Array<{
    student_id: number;
    student_name: string;
    student_username: string;
    total_duration: number;
  }>
): void {
  if (studentDurations.length === 0) {
    container.innerHTML = '<p style="color: var(--gray-600);">暂无学生数据</p>';
    return;
  }

  container.innerHTML = studentDurations
    .map(
      (item) => `
        <div class="duration-item">
          <div class="duration-name">${escapeHtml(item.student_name)}（${escapeHtml(item.student_username)}）</div>
          <div class="duration-value">${formatDuration(item.total_duration)} 小时</div>
        </div>
      `
    )
    .join('');
}

function renderRecords(recordsTable: HTMLElement, records: TeacherRecord[]): void {
  if (records.length === 0) {
    recordsTable.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 40px;">
          <div class="empty-state" style="padding: 20px;">
            <p>暂无记录</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  recordsTable.innerHTML = records
    .map(
      (record) => `
        <tr>
          <td><strong>${escapeHtml(record.student_name)}</strong></td>
          <td>${escapeHtml(record.title)}</td>
          <td>${formatDate(record.practice_date, '-')}</td>
          <td>${record.duration ? `${record.duration} 小时` : '-'}</td>
          <td>
            <span class="status-badge status-${record.status}">
              ${statusLabel(record.status)}
            </span>
          </td>
          <td>${formatDateTime(record.created_at)}</td>
          <td>
            <button
              class="btn btn-sm"
              type="button"
              data-action="open-review"
              data-record-id="${record.id}"
              style="background: var(--primary); color: white;"
            >
              审核
            </button>
          </td>
        </tr>
      `
    )
    .join('');
}

function closeModal(
  reviewModal: HTMLElement,
  reviewComment: HTMLTextAreaElement,
  onClose: () => void
): void {
  reviewModal.classList.remove('show');
  reviewComment.value = '';
  onClose();
}

function statusLabel(status: RecordStatus): string {
  switch (status) {
    case 'approved':
      return '已通过';
    case 'rejected':
      return '已驳回';
    default:
      return '待审核';
  }
}
