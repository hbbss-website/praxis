import { renderSidebar } from '../components/sidebar';
import {
  API_URL,
  logout,
  readJson,
  requireElement,
  requireRole,
  updateNotificationBadge,
  type ApiError
} from '../shared';

const session = requireRole('student', '../login.html');
if (session) renderSidebar({ role: 'student', activePath: 'account.html', user: session.user });


if (session) {
  
  requireElement<HTMLElement>('#account-uid').textContent = session.user.uid;
  requireElement<HTMLElement>('#account-name').textContent = session.user.name;
  requireElement<HTMLButtonElement>('#logout-button').addEventListener('click', () => logout('../login.html'));

  void updateNotificationBadge(session.token);

  const form = requireElement<HTMLFormElement>('#password-form');
  const currentPw = requireElement<HTMLInputElement>('#current-password');
  const newPw = requireElement<HTMLInputElement>('#new-password');
  const confirmPw = requireElement<HTMLInputElement>('#confirm-password');
  const btn = requireElement<HTMLButtonElement>('#password-btn');
  const errorEl = requireElement<HTMLElement>('#password-error');
  const successEl = requireElement<HTMLElement>('#password-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.remove('show');
    successEl.style.display = 'none';

    if (newPw.value !== confirmPw.value) {
      errorEl.textContent = '两次输入的密码不一致。';
      errorEl.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.textContent = '修改中...';

    try {
      const response = await fetch(`${API_URL}/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ current_password: currentPw.value, new_password: newPw.value })
      });

      if (response.status === 401 && !(await readJson<ApiError>(response))?.error?.includes('密码')) {
        logout('../login.html');
        return;
      }

      const data = await readJson<ApiError & { message?: string }>(response);
      if (!response.ok) {
        errorEl.textContent = data?.error ?? '修改密码失败。';
        errorEl.classList.add('show');
        return;
      }

      successEl.textContent = '密码修改成功。';
      successEl.style.display = 'block';
      form.reset();
    } catch {
      errorEl.textContent = '无法连接到服务器。';
      errorEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = '修改密码';
    }
  });
}
