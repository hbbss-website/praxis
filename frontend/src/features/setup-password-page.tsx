import { LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ApiResponseError, createApiClient, unwrapResponse, validatePlainPassword } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { toastError, toastSuccess } from '@/lib/feedback';
import { useRuntimeConfig } from '@/lib/runtime-config';
import { getDefaultPathByRole } from '@/lib/session';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function SetupPasswordPage() {
  const navigate = useNavigate();
  const { user, passwordSetupCurrentPassword, signIn, signOut } = useSession();
  const runtimeConfig = useRuntimeConfig();
  const [form, setForm] = useState({
    new_password: '',
    confirm_password: ''
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.password_setup_required || passwordSetupCurrentPassword) {
      return;
    }

    signOut();
    navigate('/login', { replace: true });
  }, [navigate, passwordSetupCurrentPassword, signOut, user?.password_setup_required]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.password_setup_required) {
    return <Navigate to={getDefaultPathByRole(user.role)} replace />;
  }

  if (!passwordSetupCurrentPassword) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 py-8">
      <Card className="w-full max-w-xl border-border/70 shadow-sm">
        <CardHeader className="space-y-4 pb-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheck className="size-6" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                signOut();
                navigate('/login', { replace: true });
              }}
            >
              <LogOut className="size-4" />
              退出
            </Button>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl">设置密码</CardTitle>
            <CardDescription className="text-sm leading-6">
              当前使用的是系统随机生成的初始密码。设置新密码后，才能进入系统面板。
              <br />
              新密码需为 8 到 32 位。
            </CardDescription>
          </div>
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p><span className="font-semibold text-foreground">UID：</span>{user.uid}</p>
            <p className="mt-1"><span className="font-semibold text-foreground">姓名：</span>{user.name}</p>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();

              if (form.new_password !== form.confirm_password) {
                toastError(new Error('两次输入的密码不一致。'));
                return;
              }

              const passwordError = validatePlainPassword(form.new_password, runtimeConfig);

              if (passwordError) {
                toastError(new Error(passwordError));
                return;
              }

              setSubmitting(true);

              try {
                const data = await unwrapResponse<{ token: string; user: typeof user }>(
                  createApiClient().auth.password.put({
                    current_password: passwordSetupCurrentPassword,
                    new_password: form.new_password
                  })
                );
                signIn(data.user, null);
                toastSuccess('密码设置成功。');
                navigate(getDefaultPathByRole(user.role), { replace: true });
              } catch (nextError) {
                if (nextError instanceof ApiResponseError && nextError.status === 401) {
                  signOut();
                  navigate('/login', { replace: true });
                  return;
                }

                toastError(nextError, '设置失败。');
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Field label="新密码">
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  value={form.new_password}
                  onChange={(event) => setForm((current) => ({ ...current, new_password: event.target.value }))}
                  className="pl-10"
                  required
                />
              </div>
            </Field>
            <Field label="确认密码">
              <Input
                type="password"
                value={form.confirm_password}
                onChange={(event) => setForm((current) => ({ ...current, confirm_password: event.target.value }))}
                required
              />
            </Field>
            <Button className="h-11 w-full" disabled={submitting} type="submit">
              {submitting ? <Spinner className="size-4 text-current" /> : null}
              {submitting ? '提交中...' : '确认并进入系统'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
