import { renderSidebar } from '../components/sidebar';
import {
  API_URL,
  escapeHtml,
  formatDate,
  getApiOrigin,
  logout,
  readJson,
  requireElement,
  requireRole,
  updateNotificationBadge,
  type ApiError
} from '../shared';

type RecordStatus = 'approved' | 'pending' | 'rejected';

interface StudentRecord {
  id: number;
  title: string;
  content: string;
  practice_date: string;
  location: string | null;
  duration: number;
  image_path: string | null;
  status: RecordStatus;
  teacher_comment: string | null;
  updated_at: string;
  updated_by_uid: string | null;
}

interface RecordStatistics {
  total_records: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  total_duration: number;
}

interface StudentRecordsResponse extends ApiError {
  records: StudentRecord[];
  statistics: RecordStatistics;
}

const session = requireRole('student', '../login.html');
if (session) renderSidebar({ role: 'student', activePath: 'dashboard.html', user: session.user });


if (session) {
  const logoutButton = requireElement<HTMLButtonElement>('#logout-button');
  const recordsContainer = requireElement<HTMLElement>('#records-container');
  const totalCount = requireElement<HTMLElement>('#total-count');
  const totalDuration = requireElement<HTMLElement>('#total-duration');
  const pendingCount = requireElement<HTMLElement>('#pending-count');
  const approvedCount = requireElement<HTMLElement>('#approved-count');

    logoutButton.addEventListener('click', () => logout('../login.html'));

  recordsContainer.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('[data-action="view-record"]');

    if (!button) {
      return;
    }

    const recordId = button.dataset.recordId;
    window.alert(`记录 ID：${recordId ?? ''}`);
  });

  recordsContainer.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const deleteButton = target?.closest<HTMLButtonElement>('[data-action="delete-record"]');
    if (deleteButton) {
      const recordId = Number(deleteButton.dataset.recordId);
      if (Number.isFinite(recordId) && window.confirm('确定要删除这条实践记录吗？')) {
        void deleteRecord(session.token, recordId, recordsContainer, totalCount, totalDuration, pendingCount, approvedCount);
      }
    }
  });

  void updateNotificationBadge(session.token);
  void loadRecords(session.token, recordsContainer, totalCount, totalDuration, pendingCount, approvedCount);
}

async function deleteRecord(
  token: string,
  recordId: number,
  recordsContainer: HTMLElement,
  totalCount: HTMLElement,
  totalDuration: HTMLElement,
  pendingCount: HTMLElement,
  approvedCount: HTMLElement
): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/student/records/${recordId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      logout('../login.html');
      return;
    }

    const data = await readJson<ApiError>(response);
    
    if (!response.ok) {
      throw new Error(data?.error ?? '删除记录失败。');
    }

    // Reload records after deletion
    await loadRecords(token, recordsContainer, totalCount, totalDuration, pendingCount, approvedCount);
  } catch (error) {
    console.error('删除记录失败。', error);
    window.alert(error instanceof Error ? error.message : '删除记录失败。');
  }
}

async function loadRecords(
  token: string,
  recordsContainer: HTMLElement,
  totalCount: HTMLElement,
  totalDuration: HTMLElement,
  pendingCount: HTMLElement,
  approvedCount: HTMLElement
): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/student/records`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      logout('../login.html');
      return;
    }

    const data = await readJson<StudentRecordsResponse>(response);

    if (!response.ok || !data) {
      throw new Error(data?.error ?? '加载记录失败。');
    }

    renderRecords(recordsContainer, data.records);
    updateStats(data.statistics, totalCount, totalDuration, pendingCount, approvedCount);
  } catch (error) {
    console.error('加载学生记录失败。', error);
    recordsContainer.innerHTML = `
      <div class="empty-state">
        <h3>加载记录失败</h3>
        <p>请刷新页面后重试。</p>
      </div>
    `;
  }
}

function renderRecords(container: HTMLElement, records: StudentRecord[]): void {
  if (records.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <h3>暂无记录</h3>
        <p>点击左侧「上传记录」提交你的第一条社会实践记录。</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="records-grid">
      ${records
        .map(
          (record) => `
            <div class="record-card">
              ${
                record.image_path
                  ? `<img src="${getApiOrigin()}${record.image_path}" class="record-image" alt="${escapeHtml(
                      record.title
                    )}">`
                  : `<div class="record-image" style="display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                      <svg width="48" height="48" fill="white" viewBox="0 0 24 24">
                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                      </svg>
                    </div>`
              }
              <div class="record-content">
                <h4 class="record-title">${escapeHtml(record.title)}</h4>
                <div class="record-meta">
                  <span>日期：${formatDate(record.practice_date)}</span>
                  ${record.location ? `<span>地点：${escapeHtml(record.location)}</span>` : ''}
                  ${record.duration ? `<span>时长：${record.duration} 小时</span>` : ''}
                </div>
                <p class="record-description">${escapeHtml(record.content)}</p>
                <div class="record-footer">
                  <span class="status-badge status-${record.status}">${statusLabel(record.status)}</span>
                  <div style="display: flex; gap: 8px;">
                    ${
                      (record.status === 'pending' || record.status === 'rejected')
                        ? `<a href="upload.html?id=${record.id}" class="btn btn-sm btn-secondary" style="text-decoration: none;">修改</a>`
                        : ''
                    }
                    ${
                      record.status === 'pending'
                        ? `<button
                            class="btn btn-sm btn-danger"
                            data-action="delete-record"
                            data-record-id="${record.id}"
                            type="button"
                          >
                            删除
                          </button>`
                        : ''
                    }
                    <button
                      class="btn btn-sm"
                      data-action="view-record"
                      data-record-id="${record.id}"
                      style="background: var(--gray-100); color: var(--gray-800);"
                      type="button"
                    >
                      详情
                    </button>
                  </div>
                </div>
                ${
                  record.updated_by_uid
                    ? `<div class="record-edited-info">
                        ${escapeHtml(record.updated_by_uid)} 修改于 ${formatDate(record.updated_at, '-')}
                       </div>`
                    : ''
                }
                ${
                  record.teacher_comment
                    ? `<div style="margin-top: 12px; padding: 12px; background: #f3f4f6; border-radius: 8px; font-size: 13px;">
                        <strong>教师评语：</strong>${escapeHtml(record.teacher_comment)}
                      </div>`
                    : ''
                }
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function updateStats(
  statistics: RecordStatistics,
  totalCount: HTMLElement,
  totalDuration: HTMLElement,
  pendingCount: HTMLElement,
  approvedCount: HTMLElement
): void {
  totalCount.textContent = String(statistics.total_records);
  totalDuration.textContent = `${formatDuration(statistics.total_duration)} 小时`;
  pendingCount.textContent = String(statistics.pending_count);
  approvedCount.textContent = String(statistics.approved_count);
}

function formatDuration(duration: number): string {
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(1);
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
