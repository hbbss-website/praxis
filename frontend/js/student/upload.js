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
function clearSession() {
  sessionStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(userStorageKey);
}
function logout(redirectPath) {
  clearSession();
  window.location.href = redirectPath;
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
async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// frontend/ts/student/upload.ts
var session = requireRole("student", "../login.html");
if (session) {
  const logoutButton = requireElement("#logout-button");
  const form = requireElement("#upload-form");
  const imageUpload = requireElement("#image-upload");
  const imageInput = requireElement("#image-input");
  const imagePreview = requireElement("#image-preview");
  const uploadPlaceholder = requireElement("#upload-placeholder");
  const practiceDateInput = requireElement("#practice_date");
  const submitButton = requireElement("#submit-btn");
  const titleInput = requireElement("#title");
  const contentInput = requireElement("#content");
  const locationInput = requireElement("#location");
  const durationInput = requireElement("#duration");
  const errorMessage = requireElement("#error-message");
  const successMessage = requireElement("#success-message");
  let selectedImage = null;
  populateUserSummary("#user-name", "#user-avatar", session.user);
  logoutButton.addEventListener("click", () => logout("../login.html"));
  const now = new Date;
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  practiceDateInput.valueAsDate = new Date;
  practiceDateInput.max = today;
  imageUpload.addEventListener("click", () => imageInput.click());
  imageUpload.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      imageInput.click();
    }
  });
  imageInput.addEventListener("change", (event) => {
    const input = event.currentTarget;
    selectedImage = input.files?.[0] ?? null;
    if (!selectedImage) {
      resetImagePreview(imagePreview, uploadPlaceholder, imageUpload);
      return;
    }
    if (selectedImage.size > 5 * 1024 * 1024) {
      showError(errorMessage, successMessage, "图片大小不能超过 5MB。");
      input.value = "";
      selectedImage = null;
      resetImagePreview(imagePreview, uploadPlaceholder, imageUpload);
      return;
    }
    const reader = new FileReader;
    reader.onload = () => {
      imagePreview.src = typeof reader.result === "string" ? reader.result : "";
      imagePreview.style.display = "block";
      uploadPlaceholder.style.display = "none";
      imageUpload.classList.add("has-image");
    };
    reader.readAsDataURL(selectedImage);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessages(errorMessage, successMessage);
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="loading"></span> 提交中...';
    try {
      let imagePath = null;
      if (selectedImage) {
        const formData = new FormData;
        formData.append("image", selectedImage);
        const uploadResponse = await fetch(`${API_URL}/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.token}` },
          body: formData
        });
        if (uploadResponse.status === 401) {
          logout("../login.html");
          return;
        }
        const uploadData = await readJson(uploadResponse);
        if (!uploadResponse.ok || !uploadData) {
          throw new Error(uploadData?.error ?? "图片上传失败。");
        }
        imagePath = uploadData.imageUrl;
      }
      const response = await fetch(`${API_URL}/student/records`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({
          title: titleInput.value.trim(),
          content: contentInput.value.trim(),
          practice_date: practiceDateInput.value,
          location: locationInput.value.trim() || null,
          duration: durationInput.value ? Number(durationInput.value) : null,
          image_path: imagePath
        })
      });
      if (response.status === 401) {
        logout("../login.html");
        return;
      }
      const data = await readJson(response);
      if (!response.ok || !data) {
        throw new Error(data?.error ?? "提交记录失败。");
      }
      showSuccess(errorMessage, successMessage, "记录提交成功。");
      form.reset();
      resetImagePreview(imagePreview, uploadPlaceholder, imageUpload);
      imageInput.value = "";
      selectedImage = null;
      practiceDateInput.valueAsDate = new Date;
      window.setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交记录失败。";
      showError(errorMessage, successMessage, message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "提交记录";
    }
  });
}
function hideMessages(errorMessage, successMessage) {
  errorMessage.classList.remove("show");
  successMessage.style.display = "none";
}
function showError(errorMessage, successMessage, message) {
  successMessage.style.display = "none";
  errorMessage.textContent = message;
  errorMessage.classList.add("show");
}
function showSuccess(errorMessage, successMessage, message) {
  errorMessage.classList.remove("show");
  successMessage.textContent = message;
  successMessage.style.display = "block";
}
function resetImagePreview(imagePreview, uploadPlaceholder, imageUpload) {
  imagePreview.removeAttribute("src");
  imagePreview.style.display = "none";
  uploadPlaceholder.style.display = "block";
  imageUpload.classList.remove("has-image");
}
