import { renderSidebar } from '../components/sidebar';
import {
  API_URL,
  escapeHtml,
  formatDateTime,
  logout,
  readJson,
  requireElement,
  requireRole,
  updateNotificationBadge,
  type ApiError
} from '../shared';

interface AppNotification {
  id: number;
  student_id: number;
  type: 'approved' | 'rejected' | 'deleted' | 'other';
  message: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationsResponse extends ApiError {
  notifications: AppNotification[];
  unreadCount: number;
}

const session = requireRole('student', '../login.html');
if (session) renderSidebar({ role: 'student', activePath: 'notifications.html', user: session.user });


if (session) {
  const logoutButton = requireElement<HTMLButtonElement>('#logout-button');
  const notificationsContainer = requireElement<HTMLElement>('#notifications-container');

    logoutButton.addEventListener('click', () => logout('../login.html'));

  void loadNotifications(session.token, notificationsContainer);
}

async function loadNotifications(token: string, container: HTMLElement): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/student/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      logout('../login.html');
      return;
    }

    const data = await readJson<NotificationsResponse>(response);

    if (!response.ok || !data) {
      throw new Error(data?.error ?? '加载通知失败。');
    }

    renderNotifications(container, data.notifications);

    // mark as read
    if (data.unreadCount > 0) {
      void fetch(`${API_URL}/student/notifications/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }).then(() => {
        void updateNotificationBadge(token);
      });
    } else {
      void updateNotificationBadge(token);
    }
  } catch (error) {
    console.error('加载通知失败。', error);
    container.innerHTML = `
      <div class="empty-state">
        <h3>加载通知失败</h3>
        <p>请刷新页面后重试。</p>
      </div>
    `;
  }
}

function renderNotifications(container: HTMLElement, notifications: AppNotification[]): void {
  if (notifications.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
        </svg>
        <h3>暂无通知</h3>
        <p>你目前没有收到任何通知。</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="notification-list">
      ${notifications
        .map(
          (notification) => `
            <div class="notification-item ${notification.is_read ? '' : 'unread'}">
              <div class="notification-item-header">
                <span style="font-weight: 600;">${
                  notification.type === 'approved' ? '审核通过' :
                  notification.type === 'rejected' ? '审核驳回' :
                  notification.type === 'deleted' ? '记录删除' : '系统通知'
                }</span>
                <span>${formatDateTime(notification.created_at)}</span>
              </div>
              <div class="notification-item-content">
                ${escapeHtml(notification.message)}
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}
