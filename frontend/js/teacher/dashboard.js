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

// frontend/ts/teacher/dashboard.ts
var session = requireRole("teacher", "../login.html");
if (session) {
  const activeSession = session;
  const logoutButton = requireElement("#logout-button");
  const studentFilter = requireElement("#filter-student");
  const statusFilter = requireElement("#filter-status");
  const refreshButton = requireElement("#refresh-records-button");
  const recordsTable = requireElement("#records-table");
  const totalCount = requireElement("#total-count");
  const pendingCount = requireElement("#pending-count");
  const approvedCount = requireElement("#approved-count");
  const studentCount = requireElement("#student-count");
  const reviewModal = requireElement("#review-modal");
  const modalContent = requireElement("#modal-content");
  const reviewComment = requireElement("#review-comment");
  const closeModalButton = requireElement("#close-review-modal");
  const cancelReviewButton = requireElement("#cancel-review-button");
  const rejectReviewButton = requireElement("#reject-review-button");
  const approveReviewButton = requireElement("#approve-review-button");
  let currentRecordId = null;
  populateUserSummary("#user-name", "#user-avatar", activeSession.user);
  logoutButton.addEventListener("click", () => logout("../login.html"));
  studentFilter.addEventListener("change", () => {
    loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
  });
  statusFilter.addEventListener("change", () => {
    loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
  });
  refreshButton.addEventListener("click", () => {
    loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
    loadStatistics(activeSession.token, totalCount, pendingCount, approvedCount, studentCount);
  });
  closeModalButton.addEventListener("click", () => closeModal(reviewModal, reviewComment, () => {
    currentRecordId = null;
  }));
  cancelReviewButton.addEventListener("click", () => closeModal(reviewModal, reviewComment, () => {
    currentRecordId = null;
  }));
  rejectReviewButton.addEventListener("click", () => {
    submitReview("rejected");
  });
  approveReviewButton.addEventListener("click", () => {
    submitReview("approved");
  });
  reviewModal.addEventListener("click", (event) => {
    if (event.target === reviewModal) {
      closeModal(reviewModal, reviewComment, () => {
        currentRecordId = null;
      });
    }
  });
  recordsTable.addEventListener("click", (event) => {
    const target = event.target;
    const button = target?.closest('[data-action="open-review"]');
    if (!button) {
      return;
    }
    const recordId = Number(button.dataset.recordId);
    if (!Number.isFinite(recordId)) {
      return;
    }
    openReviewModal(recordId);
  });
  loadStudents(activeSession.token, studentFilter);
  loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
  loadStatistics(activeSession.token, totalCount, pendingCount, approvedCount, studentCount);
  async function openReviewModal(recordId) {
    currentRecordId = recordId;
    try {
      const response = await fetch(`${API_URL}/teacher/records/${recordId}`, {
        headers: { Authorization: `Bearer ${activeSession.token}` }
      });
      if (response.status === 401) {
        logout("../login.html");
        return;
      }
      const data = await readJson(response);
      if (!response.ok || !data) {
        throw new Error(data?.error ?? "加载记录详情失败。");
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
          <strong>实践日期：</strong>${formatDate(record.practice_date, "-")}
          ${record.duration ? ` | <strong>时长：</strong>${record.duration} 小时` : ""}
          ${record.location ? ` | <strong>地点：</strong>${escapeHtml(record.location)}` : ""}
        </div>
        <div style="margin-bottom: 16px;">
          <strong>内容：</strong>
          <p style="margin-top: 8px; padding: 12px; background: var(--gray-100); border-radius: 8px;">
            ${escapeHtml(record.content)}
          </p>
        </div>
        ${record.image_path ? `<div>
                <strong>图片：</strong>
                <img
                  src="${getApiOrigin()}${record.image_path}"
                  alt="${escapeHtml(record.title)}"
                  style="max-width: 100%; max-height: 300px; margin-top: 8px; border-radius: 8px;"
                >
              </div>` : ""}
        ${record.teacher_comment ? `<div style="margin-top: 16px; padding: 12px; background: #dbeafe; border-radius: 8px;">
                <strong>当前评语：</strong>${escapeHtml(record.teacher_comment)}
              </div>` : ""}
      `;
      reviewComment.value = record.teacher_comment ?? "";
      reviewModal.classList.add("show");
    } catch (error) {
      console.error("加载记录详情失败。", error);
      window.alert("加载记录详情失败。");
    }
  }
  async function submitReview(status) {
    if (!currentRecordId) {
      return;
    }
    try {
      const response = await fetch(`${API_URL}/teacher/records/${currentRecordId}/review`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.token}`
        },
        body: JSON.stringify({
          status,
          comment: reviewComment.value.trim()
        })
      });
      if (response.status === 401) {
        logout("../login.html");
        return;
      }
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data?.error ?? "保存审核结果失败。");
      }
      closeModal(reviewModal, reviewComment, () => {
        currentRecordId = null;
      });
      await loadRecords(activeSession.token, studentFilter, statusFilter, recordsTable);
      await loadStatistics(activeSession.token, totalCount, pendingCount, approvedCount, studentCount);
    } catch (error) {
      console.error("提交审核失败。", error);
      window.alert(error instanceof Error ? error.message : "保存审核结果失败。");
    }
  }
}
async function loadStudents(token, studentFilter) {
  try {
    const response = await fetch(`${API_URL}/teacher/students`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.status === 401) {
      logout("../login.html");
      return;
    }
    const data = await readJson(response);
    if (!response.ok || !data) {
      throw new Error(data?.error ?? "加载学生列表失败。");
    }
    studentFilter.innerHTML = `
      <option value="">全部学生</option>
      ${data.students.map((student) => `<option value="${student.id}">${escapeHtml(student.name)}</option>`).join("")}
    `;
  } catch (error) {
    console.error("加载学生列表失败。", error);
  }
}
async function loadRecords(token, studentFilter, statusFilter, recordsTable) {
  try {
    const query = new URLSearchParams;
    if (studentFilter.value) {
      query.set("student_id", studentFilter.value);
    }
    if (statusFilter.value) {
      query.set("status", statusFilter.value);
    }
    const url = `${API_URL}/teacher/records${query.toString() ? `?${query.toString()}` : ""}`;
    const response = await fetch(url, {
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
    renderRecords(recordsTable, data.records);
  } catch (error) {
    console.error("加载记录失败。", error);
    recordsTable.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 40px; color: var(--danger);">
          加载记录失败。
        </td>
      </tr>
    `;
  }
}
async function loadStatistics(token, totalCount, pendingCount, approvedCount, studentCount) {
  try {
    const response = await fetch(`${API_URL}/teacher/statistics`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.status === 401) {
      logout("../login.html");
      return;
    }
    const data = await readJson(response);
    if (!response.ok || !data) {
      throw new Error(data?.error ?? "加载统计数据失败。");
    }
    totalCount.textContent = String(data.statistics.total_records);
    pendingCount.textContent = String(data.statistics.pending_count);
    approvedCount.textContent = String(data.statistics.approved_count);
    studentCount.textContent = String(data.statistics.student_count);
  } catch (error) {
    console.error("加载统计数据失败。", error);
  }
}
function renderRecords(recordsTable, records) {
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
  recordsTable.innerHTML = records.map((record) => `
        <tr>
          <td><strong>${escapeHtml(record.student_name)}</strong></td>
          <td>${escapeHtml(record.title)}</td>
          <td>${formatDate(record.practice_date, "-")}</td>
          <td>${record.duration ? `${record.duration} 小时` : "-"}</td>
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
      `).join("");
}
function closeModal(reviewModal, reviewComment, onClose) {
  reviewModal.classList.remove("show");
  reviewComment.value = "";
  onClose();
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
