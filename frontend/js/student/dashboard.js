// frontend/ts/shared.ts
var API_URL = "http://localhost:3000/api";
var tokenStorageKey = "auth.token";
var userStorageKey = "auth.user";
function requireElement(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
function getStoredUser() {
  const rawUser = sessionStorage.getItem(userStorageKey);
  if (!rawUser) {
    return null;
  }
  try {
    const user = JSON.parse(rawUser);
    if (typeof user.id !== "number" || typeof user.username !== "string" || user.role !== "student" && user.role !== "teacher" || typeof user.name !== "string") {
      return null;
    }
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name
    };
  } catch {
    return null;
  }
}
function getToken() {
  return sessionStorage.getItem(tokenStorageKey);
}
function storeSession(token, user) {
  sessionStorage.setItem(tokenStorageKey, token);
  sessionStorage.setItem(userStorageKey, JSON.stringify(user));
}
function clearSession() {
  sessionStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(userStorageKey);
}
function logout(redirectPath) {
  clearSession();
  window.location.href = redirectPath;
}
function redirectByRole(role) {
  window.location.href = role === "teacher" ? "teacher/dashboard.html" : "student/dashboard.html";
}
function requireRole(expectedRole, loginPath) {
  const token = getToken();
  const user = getStoredUser();
  if (!token || !user || user.role !== expectedRole) {
    logout(loginPath);
    return null;
  }
  return { token, user };
}
function populateUserSummary(nameSelector, avatarSelector, user) {
  const nameElement = requireElement(nameSelector);
  const avatarElement = requireElement(avatarSelector);
  const displayName = user.name || user.username;
  nameElement.textContent = displayName;
  avatarElement.textContent = displayName.charAt(0).toUpperCase();
}
function escapeHtml(value) {
  if (!value) {
    return "";
  }
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}
function formatDate(value, fallback = "") {
  if (!value) {
    return fallback;
  }
  return new Date(value).toLocaleDateString("zh-CN");
}
function formatDateTime(value, fallback = "-") {
  if (!value) {
    return fallback;
  }
  return new Date(value).toLocaleString("zh-CN");
}
function getApiOrigin() {
  return API_URL.replace(/\/api$/, "");
}
async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// frontend/ts/student/dashboard.ts
var session = requireRole("student", "../login.html");
if (session) {
  const logoutButton = requireElement("#logout-button");
  const recordsContainer = requireElement("#records-container");
  const totalCount = requireElement("#total-count");
  const totalDuration = requireElement("#total-duration");
  const pendingCount = requireElement("#pending-count");
  const approvedCount = requireElement("#approved-count");
  populateUserSummary("#user-name", "#user-avatar", session.user);
  logoutButton.addEventListener("click", () => logout("../login.html"));
  recordsContainer.addEventListener("click", (event) => {
    const target = event.target;
    const button = target?.closest('[data-action="view-record"]');
    if (!button) {
      return;
    }
    const recordId = button.dataset.recordId;
    window.alert(`记录 ID：${recordId ?? ""}`);
  });
  loadRecords(session.token, recordsContainer, totalCount, totalDuration, pendingCount, approvedCount);
}
async function loadRecords(token, recordsContainer, totalCount, totalDuration, pendingCount, approvedCount) {
  try {
    const response = await fetch(`${API_URL}/student/records`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.status === 401) {
      logout("../login.html");
      return;
    }
    const data = await readJson(response);
    if (!response.ok || !data) {
      throw new Error(data?.error ?? "加载记录失败。");
    }
    renderRecords(recordsContainer, data.records);
    updateStats(data.records, totalCount, totalDuration, pendingCount, approvedCount);
  } catch (error) {
    console.error("加载学生记录失败。", error);
    recordsContainer.innerHTML = `
      <div class="empty-state">
        <h3>加载记录失败</h3>
        <p>请刷新页面后重试。</p>
      </div>
    `;
  }
}
function renderRecords(container, records) {
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
      ${records.map((record) => `
            <div class="record-card">
              ${record.image_path ? `<img src="${getApiOrigin()}${record.image_path}" class="record-image" alt="${escapeHtml(record.title)}">` : `<div class="record-image" style="display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                      <svg width="48" height="48" fill="white" viewBox="0 0 24 24">
                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                      </svg>
                    </div>`}
              <div class="record-content">
                <h4 class="record-title">${escapeHtml(record.title)}</h4>
                <div class="record-meta">
                  <span>日期：${formatDate(record.practice_date)}</span>
                  ${record.location ? `<span>地点：${escapeHtml(record.location)}</span>` : ""}
                  ${record.duration ? `<span>时长：${record.duration} 小时</span>` : ""}
                </div>
                <p class="record-description">${escapeHtml(record.content)}</p>
                <div class="record-footer">
                  <span class="status-badge status-${record.status}">${statusLabel(record.status)}</span>
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
                ${record.teacher_comment ? `<div style="margin-top: 12px; padding: 12px; background: #f3f4f6; border-radius: 8px; font-size: 13px;">
                        <strong>教师评语：</strong>${escapeHtml(record.teacher_comment)}
                      </div>` : ""}
              </div>
            </div>
          `).join("")}
    </div>
  `;
}
function updateStats(records, totalCount, totalDuration, pendingCount, approvedCount) {
  totalCount.textContent = String(records.length);
  totalDuration.textContent = `${formatDuration(records.reduce((sum, record) => sum + (record.duration ?? 0), 0))} 小时`;
  pendingCount.textContent = String(records.filter((record) => record.status === "pending").length);
  approvedCount.textContent = String(records.filter((record) => record.status === "approved").length);
}
function formatDuration(duration) {
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(1);
}
function statusLabel(status) {
  switch (status) {
    case "approved":
      return "已通过";
    case "rejected":
      return "已驳回";
    default:
      return "待审核";
  }
}
