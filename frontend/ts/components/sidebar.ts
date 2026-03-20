import { escapeHtml, logout, type StoredUser } from '../shared';

export interface SidebarOptions {
  role: 'admin' | 'teacher' | 'student';
  activePath: string;
  user: StoredUser;
}

export function renderSidebar(options: SidebarOptions) {
  const container = document.querySelector('.sidebar');
  if (!container) return;

  const roleText = options.role === 'admin' ? '管理员' : options.role === 'teacher' ? '教师' : '学生';
  
  let navItems = '';
  if (options.role === 'admin') {
    navItems = `
      <a href="records.html" class="${options.activePath === 'records.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          记录管理
      </a>
      <a href="students.html" class="${options.activePath === 'students.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          学生管理
      </a>
      <a href="teachers.html" class="${options.activePath === 'teachers.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
          教师管理
      </a>
      <a href="users.html" class="${options.activePath === 'users.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
          添加用户
      </a>
      <a href="assignments.html" class="${options.activePath === 'assignments.html' ? 'active' : ''}">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
        分配管理
      </a>
      <a href="account.html" class="${options.activePath === 'account.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          账号管理
      </a>
    `;
  } else if (options.role === 'teacher') {
    navItems = `
      <a href="dashboard.html" class="${options.activePath === 'dashboard.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          记录管理
      </a>
      <a href="students.html" class="${options.activePath === 'students.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
          学生管理
      </a>
      <a href="account.html" class="${options.activePath === 'account.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          账号管理
      </a>
    `;
  } else if (options.role === 'student') {
    navItems = `
      <a href="dashboard.html" class="${options.activePath === 'dashboard.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          我的记录
      </a>
      <a href="upload.html" class="${options.activePath === 'upload.html' ? 'active' : ''}">
          <div class="nav-item-container">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              上传记录
          </div>
      </a>
      <a href="notifications.html" class="${options.activePath === 'notifications.html' ? 'active' : ''}">
          <div class="nav-item-container">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
              通知中心
              <span class="notification-badge" id="nav-notification-badge">0</span>
          </div>
      </a>
      <a href="account.html" class="${options.activePath === 'account.html' ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          账号管理
      </a>
    `;
  }

  const displayName = escapeHtml(options.user.name || options.user.uid);
  const avatarChar = displayName.charAt(0).toUpperCase();

  container.innerHTML = `
      <div class="sidebar-header">
          <h2>社会实践系统</h2>
          <span class="role-badge ${options.role}">${roleText}</span>
      </div>
      <nav class="sidebar-nav">
          ${navItems}
      </nav>
      <div class="sidebar-footer">
          <div class="user-info">
              <div class="user-avatar">${avatarChar}</div>
              <div class="user-details">
                  <div class="user-name">${displayName}</div>
                  <div class="user-role">${roleText}</div>
              </div>
          </div>
          <button class="btn btn-secondary btn-sm" id="logout-button" type="button" style="width: 100%;">退出登录</button>
      </div>
  `;

  document.getElementById('logout-button')?.addEventListener('click', () => logout('../login.html'));
}
