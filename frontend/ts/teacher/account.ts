import { renderSidebar } from '../components/sidebar';
import {
  API_URL, logout,
  readJson, requireElement, requireRole, type ApiError
} from '../shared';

const session = requireRole('teacher', '../login.html');
if (session) renderSidebar({ role: 'teacher', activePath: 'account.html', user: session.user });


if (session) {
    requireElement<HTMLElement>('#account-uid').textContent = session.user.uid;
  requireElement<HTMLElement>('#account-name').textContent = session.user.name;
  requireElement('#logout-button').addEventListener('click', () => logout('../login.html'));

  // --- Name Change ---
  setupForm({
    formId: '#name-form',
    btnId: '#name-btn',
    errorId: '#name-error',
    successId: '#name-success',
    endpoint: `${API_URL}/auth/profile`,
    buildBody: () => ({
      current_password: requireElement<HTMLInputElement>('#name-current-password').value,
      name: requireElement<HTMLInputElement>('#new-name').value.trim()
    }),
    validate: () => {
      if (!requireElement<HTMLInputElement>('#new-name').value.trim()) return '姓名不能为空。';
      return null;
    },
    successMessage: '姓名修改成功，重新登录后生效。',
    btnLabel: '修改姓名'
  });

  // --- Password Change ---
  setupForm({
    formId: '#password-form',
    btnId: '#password-btn',
    errorId: '#password-error',
    successId: '#password-success',
    endpoint: `${API_URL}/auth/password`,
    buildBody: () => ({
      current_password: requireElement<HTMLInputElement>('#current-password').value,
      new_password: requireElement<HTMLInputElement>('#new-password').value
    }),
    validate: () => {
      const pw = requireElement<HTMLInputElement>('#new-password').value;
      const confirm = requireElement<HTMLInputElement>('#confirm-password').value;
      if (pw !== confirm) return '两次输入的密码不一致。';
      return null;
    },
    successMessage: '密码修改成功。',
    btnLabel: '修改密码'
  });

  function setupForm(config: {
    formId: string; btnId: string; errorId: string; successId: string;
    endpoint: string; buildBody: () => Record<string, string>;
    validate: () => string | null; successMessage: string; btnLabel: string;
  }) {
    const form = requireElement<HTMLFormElement>(config.formId);
    const btn = requireElement<HTMLButtonElement>(config.btnId);
    const errorEl = requireElement<HTMLElement>(config.errorId);
    const successEl = requireElement<HTMLElement>(config.successId);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.classList.remove('show');
      successEl.style.display = 'none';

      const validationError = config.validate();
      if (validationError) { errorEl.textContent = validationError; errorEl.classList.add('show'); return; }

      btn.disabled = true;
      btn.textContent = '提交中...';

      try {
        const res = await fetch(config.endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session!.token}` },
          body: JSON.stringify(config.buildBody())
        });
        const data = await readJson<ApiError & { message?: string }>(res);
        if (!res.ok) { errorEl.textContent = data?.error ?? '操作失败。'; errorEl.classList.add('show'); return; }
        successEl.textContent = config.successMessage;
        successEl.style.display = 'block';
        form.reset();
      } catch {
        errorEl.textContent = '无法连接到服务器。';
        errorEl.classList.add('show');
      } finally {
        btn.disabled = false;
        btn.textContent = config.btnLabel;
      }
    });
  }
}
