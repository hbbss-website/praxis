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

// frontend/ts/login.ts
var existingToken = getToken();
var existingUser = getStoredUser();
if (existingToken && existingUser) {
  redirectByRole(existingUser.role);
}
var form = requireElement("#login-form");
var usernameInput = requireElement("#username");
var passwordInput = requireElement("#password");
var loginButton = requireElement("#login-btn");
var errorMessage = requireElement("#error-message");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  loginButton.innerHTML = '<span class="loading"></span> 登录中...';
  errorMessage.classList.remove("show");
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value
      })
    });
    const data = await readJson(response);
    if (response.ok && data) {
      storeSession(data.token, data.user);
      passwordInput.value = "";
      redirectByRole(data.user.role);
      return;
    }
    errorMessage.textContent = data?.error ?? "登录失败。";
    errorMessage.classList.add("show");
  } catch {
    errorMessage.textContent = "无法连接到后端服务。";
    errorMessage.classList.add("show");
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "登录";
  }
});
