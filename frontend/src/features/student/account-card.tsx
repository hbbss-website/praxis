import { CalendarDays, CheckCircle2, Clock3, Eye, ImagePlus, MapPin, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useSession } from '@/lib/auth';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { AuthenticatedImage } from '@/shared/authenticated-image';
import { DatePickerField } from '@/shared/date-picker-field';
import { EmptyState } from '@/shared/empty-state';
import { StatCard } from '@/shared/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ApiResponseError, createApiClient, formatUploadImageMaxSize, getRuntimeConfig, unwrapResponse, uploadImage, validateUploadImageFiles } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDate, formatDateTime, formatDuration, normalizeDateInputValue, notificationLabel, statusLabel } from '@/lib/format';
import { MAX_RECORD_IMAGES, type AppNotification, type RecordStatistics, type StudentRecord } from '@/lib/types';
import { Field, StudentPageFrame } from './shared';

export function StudentAccountPage() {
  return <AccountCard title="修改密码" allowNameChange={false} />;
}

export function AccountCard({
  title,
  allowNameChange
}: {
  title: string;
  allowNameChange: boolean;
}) {
  const { user, signOut } = useSession();
  const [nameForm, setNameForm] = useState({ name: user?.name ?? '', current_password: '' });
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [submitting, setSubmitting] = useState('');

  return (
    <StudentPageFrame
      title="账号设置"
      description="当前登录信息存储在会话中，关闭浏览器标签页后需要重新登录。"
    >
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="space-y-1">
              <p>
                <span className="font-semibold text-foreground">UID：</span>{user?.uid}
              </p>
              <p>
                <span className="font-semibold text-foreground">姓名：</span>{user?.name}
              </p>
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="space-y-6">
          {allowNameChange ? (
            <Card>
              <CardHeader>
                <CardTitle>修改姓名</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-4"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setSubmitting('name');
                    try {
                      await unwrapResponse(createApiClient().auth.profile.put(nameForm));
                      toastSuccess('姓名修改成功，重新登录后生效。');
                      setNameForm((current) => ({ ...current, current_password: '' }));
                    } catch (nextError) {
                      if (nextError instanceof ApiResponseError && nextError.status === 401) {
                        signOut();
                        return;
                      }
                      toastError(nextError, '操作失败。');
                    } finally {
                      setSubmitting('');
                    }
                  }}
                >
                  <Field label="新姓名">
                    <Input value={nameForm.name} onChange={(event) => setNameForm((current) => ({ ...current, name: event.target.value }))} required />
                  </Field>
                  <Field label="当前密码">
                    <Input type="password" value={nameForm.current_password} onChange={(event) => setNameForm((current) => ({ ...current, current_password: event.target.value }))} required />
                  </Field>
                  <Button disabled={submitting === 'name'} type="submit">{submitting === 'name' ? '提交中...' : '修改姓名'}</Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>修改密码</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (passwordForm.new_password !== passwordForm.confirm_password) {
                    toastError(new Error('两次输入的密码不一致。'));
                    return;
                  }
                  setSubmitting('password');
                  try {
                    await unwrapResponse(
                      createApiClient().auth.password.put({
                        current_password: passwordForm.current_password,
                        new_password: passwordForm.new_password
                      })
                    );
                    toastSuccess('密码修改成功。');
                    setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
                  } catch (nextError) {
                    if (nextError instanceof ApiResponseError && nextError.status === 401) {
                      signOut();
                      return;
                    }
                    toastError(nextError, '修改失败。');
                  } finally {
                    setSubmitting('');
                  }
                }}
              >
                <Field label="当前密码">
                  <Input type="password" value={passwordForm.current_password} onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))} required />
                </Field>
                <Field label="新密码">
                  <Input type="password" value={passwordForm.new_password} onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))} required />
                </Field>
                <Field label="确认密码">
                  <Input type="password" value={passwordForm.confirm_password} onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))} required />
                </Field>
                <Button disabled={submitting === 'password'} type="submit">
                  {submitting === 'password' ? '提交中...' : '修改密码'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </StudentPageFrame>
  );
}
