import { renderSidebar } from '../components/sidebar';
import {
  API_URL, logout,
  readJson, requireElement, requireRole, type ApiError
} from '../shared';

const session = requireRole('admin', '../login.html');
if (session) renderSidebar({ role: 'admin', activePath: 'account.html', user: session.user });


if (session) {
    requireElement<HTMLElement>('#account-uid').textContent = session.user.uid;
  requireElement<HTMLElement>('#account-name').textContent = session.user.name;
  requireElement('#logout-button').addEventListener('click', () => logout('../login.html'));

  setupForm({
    formId: '#name-form', btnId: '#name-btn', errorId: '#name-error', successId: '#name-success',
    endpoint: `${API_URL}/auth/profile`,
    buildBody: () => ({
      current_password: requireElement<HTMLInputElement>('#name-current-password').value,
      name: requireElement<HTMLInputElement>('#new-name').value.trim()
    }),
    validate: () => requireElement<HTMLInputElement>('#new-name').value.trim() ? null : '姓名不能为空。',
    successMessage: '姓名修改成功，重新登录后生效。', btnLabel: '修改姓名'
  });

  setupForm({
    formId: '#password-form', btnId: '#password-btn', errorId: '#password-error', successId: '#password-success',
    endpoint: `${API_URL}/auth/password`,
    buildBody: () => ({
      current_password: requireElement<HTMLInputElement>('#current-password').value,
      new_password: requireElement<HTMLInputElement>('#new-password').value
    }),
    validate: () => {
      const pw = requireElement<HTMLInputElement>('#new-password').value;
      const confirm = requireElement<HTMLInputElement>('#confirm-password').value;
      return pw !== confirm ? '两次输入的密码不一致。' : null;
    },
    successMessage: '密码修改成功。', btnLabel: '修改密码'
  });

  function setupForm(cfg: {
    formId: string; btnId: string; errorId: string; successId: string;
    endpoint: string; buildBody: () => Record<string, string>;
    validate: () => string | null; successMessage: string; btnLabel: string;
  }) {
    const form = requireElement<HTMLFormElement>(cfg.formId);
    const btn = requireElement<HTMLButtonElement>(cfg.btnId);
    const errEl = requireElement<HTMLElement>(cfg.errorId);
    const okEl = requireElement<HTMLElement>(cfg.successId);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.remove('show'); okEl.style.display = 'none';
      const err = cfg.validate();
      if (err) { errEl.textContent = err; errEl.classList.add('show'); return; }
      btn.disabled = true; btn.textContent = '提交中...';
      try {
        const res = await fetch(cfg.endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session!.token}` },
          body: JSON.stringify(cfg.buildBody())
        });
        const data = await readJson<ApiError & { message?: string }>(res);
        if (!res.ok) { errEl.textContent = data?.error ?? '操作失败。'; errEl.classList.add('show'); return; }
        okEl.textContent = cfg.successMessage; okEl.style.display = 'block'; form.reset();
      } catch { errEl.textContent = '无法连接到服务器。'; errEl.classList.add('show'); }
      finally { btn.disabled = false; btn.textContent = cfg.btnLabel; }
    });
  }
}
