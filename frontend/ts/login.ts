import { API_URL, getStoredUser, getToken, readJson, redirectByRole, requireElement, storeSession } from './shared';

interface LoginResponse {
  token: string;
  user: {
    id: number;
    uid: string;
    role: 'admin' | 'teacher' | 'student';
    name: string;
  };
  error?: string;
}

const existingToken = getToken();
const existingUser = getStoredUser();

if (existingToken && existingUser) {
  redirectByRole(existingUser.role);
}

const form = requireElement<HTMLFormElement>('#login-form');
const uidInput = requireElement<HTMLInputElement>('#uid');
const passwordInput = requireElement<HTMLInputElement>('#password');
const loginButton = requireElement<HTMLButtonElement>('#login-btn');
const errorMessage = requireElement<HTMLElement>('#error-message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  loginButton.disabled = true;
  loginButton.innerHTML = '<span class="loading"></span> 登录中...';
  errorMessage.classList.remove('show');

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: uidInput.value.trim(),
        password: passwordInput.value
      })
    });

    const data = await readJson<LoginResponse>(response);

    if (response.ok && data) {
      storeSession(data.token, data.user);
      passwordInput.value = '';
      redirectByRole(data.user.role);
      return;
    }

    errorMessage.textContent = data?.error ?? '登录失败。';
    errorMessage.classList.add('show');
  } catch {
    errorMessage.textContent = '无法连接到后端服务。';
    errorMessage.classList.add('show');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = '登录';
  }
});
