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

type UploadImageItem = {
  id: string;
  file?: File;
  path?: string;
  preview: string;
};

function createLocalImageItem(file: File): UploadImageItem {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    preview: URL.createObjectURL(file)
  };
}

function StudentPageFrame({
  title,
  description,
  action,
  children
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StudentDashboardPage() {
  const { token, signOut } = useSession();
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [statistics, setStatistics] = useState<RecordStatistics | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<StudentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<StudentRecord | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function load() {
    if (!token) return;
    setLoading(true);
    setError('');

    try {
      const data = await unwrapResponse<{ records: StudentRecord[]; statistics: RecordStatistics }>(createApiClient(token).student.records.get());
      setRecords(data.records);
      setStatistics(data.statistics);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      setError(nextError instanceof Error ? nextError.message : '加载记录失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  return (
    <StudentPageFrame
      title="实践概览"
      description="查看个人提交记录、审核状态与累计时长。待审核和已驳回的记录可以继续修改。"
      action={
        <Button asChild>
          <Link to="/student/upload">
            <PlusCircle className="size-4" />
            新建记录
          </Link>
        </Button>
      }
    >
      {statistics ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="总记录数" value={String(statistics.total_records)} hint="包含待审核、已通过和已驳回" icon={CalendarDays} />
          <StatCard title="累计时长" value={`${formatDuration(statistics.total_duration)} h`} hint="仅统计已通过记录" icon={Clock3} />
          <StatCard title="待审核" value={String(statistics.pending_count)} hint="可以继续删除或编辑" icon={Clock3} />
          <StatCard title="已通过" value={String(statistics.approved_count)} hint="通过后计入总时长" icon={CheckCircle2} />
        </div>
      ) : null}

      {loading ? (
        <LoadingCard label="正在加载你的实践记录..." />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : records.length === 0 ? (
        <EmptyState title="还没有实践记录" description="从上传页提交第一条记录后，这里会自动汇总统计和状态变化。" action={<Button asChild><Link to="/student/upload">去上传</Link></Button>} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {records.map((record) => (
            <Card key={record.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="grid min-h-full md:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="relative min-h-40 overflow-hidden bg-muted">
                    {record.cover_image_path ? (
                      <AuthenticatedImage
                        className="h-full w-full object-cover"
                        placeholderClassName="flex h-full w-full items-center justify-center bg-muted/40"
                        src={record.cover_image_path}
                        alt={record.title}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-white/85">
                        <ImagePlus className="size-12" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <h3 className="text-xl font-semibold">{record.title}</h3>
                        <div className="flex flex-wrap gap-2 text-sm text-[color:var(--muted-foreground)]">
                          <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />{formatDate(record.practice_date)}</span>
                          {record.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{record.location}</span> : null}
                          <span>{formatDuration(record.duration)} 小时</span>
                        </div>
                      </div>
                      <StatusBadge status={record.status} />
                    </div>
                    <p className="line-clamp-4 text-sm leading-6 text-[color:var(--muted-foreground)]">{record.content}</p>
                    {record.teacher_comment ? (
                      <div className="rounded-2xl bg-slate-100/80 p-4 text-sm">
                        <p className="mb-1 font-medium">教师评语</p>
                        <p className="text-[color:var(--muted-foreground)]">{record.teacher_comment}</p>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setSelectedRecord(record)}>
                        <Eye className="size-4" />
                        详情
                      </Button>
                      {record.status === 'pending' || record.status === 'rejected' ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/student/upload?id=${record.id}`}>
                            <Pencil className="size-4" />
                            修改
                          </Link>
                        </Button>
                      ) : null}
                      {record.status === 'pending' ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteTarget(record)}
                        >
                          <Trash2 className="size-4" />
                          删除
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(selectedRecord)} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <DialogContent>
          {selectedRecord ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedRecord.title}</DialogTitle>
                <DialogDescription>{formatDate(selectedRecord.practice_date)} · {formatDuration(selectedRecord.duration)} 小时</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {selectedRecord.image_paths.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedRecord.image_paths.map((imagePath) => (
                      <AuthenticatedImage
                        key={imagePath}
                        className="max-h-80 w-full rounded-2xl object-cover"
                        placeholderClassName="flex min-h-52 w-full items-center justify-center rounded-2xl bg-muted/40"
                        src={imagePath}
                        alt={selectedRecord.title}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={selectedRecord.status} />
                  {selectedRecord.location ? <Badge variant="outline">{selectedRecord.location}</Badge> : null}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--muted-foreground)]">{selectedRecord.content}</p>
                {selectedRecord.teacher_comment ? (
                  <div className="rounded-2xl bg-slate-100 p-4 text-sm">
                    <p className="mb-1 font-medium">教师评语</p>
                    <p className="text-[color:var(--muted-foreground)]">{selectedRecord.teacher_comment}</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="确认删除记录"
        description={deleteTarget ? `将删除《${deleteTarget.title}》，删除后不可恢复。` : ''}
        confirmLabel="删除"
        loading={deleteLoading}
        variant="destructive"
        onConfirm={async () => {
          if (!token || !deleteTarget) return;

          try {
            setDeleteLoading(true);
            await unwrapResponse(createApiClient(token).student.records({ id: deleteTarget.id }).delete());
            setDeleteTarget(null);
            toastSuccess('记录已删除。');
            await load();
          } catch (nextError) {
            if (nextError instanceof ApiResponseError && nextError.status === 401) {
              signOut();
              return;
            }
            toastError(nextError, '删除失败。');
          } finally {
            setDeleteLoading(false);
          }
        }}
      />
    </StudentPageFrame>
  );
}

export function StudentUploadPage() {
  const { token, signOut } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');
  const [loading, setLoading] = useState(Boolean(editId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [uploadImageMaxSizeBytes, setUploadImageMaxSizeBytes] = useState(5 * 1024 * 1024);
  const [images, setImages] = useState<UploadImageItem[]>([]);
  const [coverImageId, setCoverImageId] = useState('');
  const localPreviewUrls = useRef(new Set<string>());
  const [form, setForm] = useState({
    title: '',
    content: '',
    practice_date: normalizeDateInputValue(new Date()),
    location: '',
    duration: ''
  });

  useEffect(() => {
    getRuntimeConfig()
      .then((config) => setUploadImageMaxSizeBytes(config.upload_image_max_size_bytes))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId || !token) return;

    unwrapResponse<{ records: StudentRecord[]; statistics: RecordStatistics }>(createApiClient(token).student.records.get())
      .then((data) => {
        const record = data.records.find((item) => String(item.id) === editId);
        if (!record || (record.status !== 'pending' && record.status !== 'rejected')) {
          toastError(new Error('无法编辑该记录或记录不存在。'));
          navigate('/student/dashboard', { replace: true });
          return;
        }
        setForm({
          title: record.title,
          content: record.content,
          practice_date: normalizeDateInputValue(record.practice_date),
          location: record.location ?? '',
          duration: String(record.duration)
        });
        const recordImages = record.image_paths.map((imagePath) => ({
          id: imagePath,
          path: imagePath,
          preview: imagePath
        }));
        setImages(recordImages);
        setCoverImageId(record.cover_image_path ?? recordImages[0]?.id ?? '');
      })
      .catch((nextError) => {
        if (nextError instanceof ApiResponseError && nextError.status === 401) {
          signOut();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : '加载记录失败。');
      })
      .finally(() => setLoading(false));
  }, [editId, navigate, signOut, token]);

  useEffect(() => () => {
    for (const previewUrl of localPreviewUrls.current) {
      URL.revokeObjectURL(previewUrl);
    }
    localPreviewUrls.current.clear();
  }, []);

  const remainingImageSlots = MAX_RECORD_IMAGES - images.length;

  return (
    <StudentPageFrame
      title={editId ? '编辑实践记录' : '上传实践记录'}
      description="保留原有记录字段和校验规则，支持图片上传、编辑草稿和驳回后重新提交。"
    >
      <Card>
        <CardHeader>
          <CardTitle>{editId ? '保存修改' : '填写记录内容'}</CardTitle>
          <CardDescription>实践日期不能晚于今天，时长最少 0.1 小时，图片大小不超过 {formatUploadImageMaxSize(uploadImageMaxSizeBytes)}。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingCard label="正在加载记录内容..." />
          ) : error ? (
            <ErrorCard message={error} onRetry={() => navigate('/student/dashboard', { replace: true })} />
          ) : (
            <form
              className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!token) return;
                setError('');
                setSubmitting(true);

                try {
                  if (images.length > MAX_RECORD_IMAGES) {
                    throw new Error(`每条记录最多上传 ${MAX_RECORD_IMAGES} 张图片。`);
                  }

                  const uploadedImages = await Promise.all(images.map(async (image) => {
                    if (image.path) {
                      return {
                        id: image.id,
                        path: image.path
                      };
                    }

                    const uploadResult = await uploadImage(image.file!, token, uploadImageMaxSizeBytes);
                    return {
                      id: image.id,
                      path: uploadResult.imageUrl
                    };
                  }));
                  const imagePaths = uploadedImages.map((image) => image.path);
                  const coverImagePath = uploadedImages.find((image) => image.id === coverImageId)?.path ?? imagePaths[0] ?? null;

                  const api = createApiClient(token);
                  const payload = {
                    ...form,
                    title: form.title.trim(),
                    content: form.content.trim(),
                    location: form.location.trim() || null,
                    duration: form.duration.trim(),
                    image_paths: imagePaths,
                    cover_image_path: coverImagePath
                  };

                  if (editId) {
                    await unwrapResponse(api.student.records({ id: Number(editId) }).put(payload));
                  } else {
                    await unwrapResponse(api.student.records.post(payload));
                  }

                  toastSuccess(editId ? '记录更新成功。' : '记录提交成功。');
                  navigate('/student/dashboard', { replace: true });
                } catch (nextError) {
                  if (nextError instanceof ApiResponseError && nextError.status === 401) {
                    signOut();
                    return;
                  }
                  toastError(nextError, '提交失败。');
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <div className="space-y-5">
                <Field label="标题">
                  <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required />
                </Field>
                <Field label="实践内容">
                  <Textarea value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} required />
                </Field>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="实践日期">
                  <DatePickerField value={form.practice_date} onChange={(value) => setForm((current) => ({ ...current, practice_date: value }))} placeholder="选择实践日期" />
                </Field>
                  <Field label="时长（小时）">
                    <Input type="number" min="0.1" step="0.1" value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: event.target.value }))} required />
                  </Field>
                </div>
                <Field label="地点">
                  <Input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Button disabled={submitting} type="submit">
                    {submitting ? <Spinner className="size-4 text-current" /> : null}
                    {submitting ? '提交中...' : editId ? '保存修改' : '提交记录'}
                  </Button>
                  <Button variant="ghost" asChild>
                    <Link to="/student/dashboard">返回概览</Link>
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <Field label="实践图片">
                  <label className="group flex min-h-28 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center transition hover:border-primary hover:bg-background has-disabled:pointer-events-none has-disabled:opacity-60">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ImagePlus className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">选择图片</p>
                      <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">最多 {MAX_RECORD_IMAGES} 张，单张最大 {formatUploadImageMaxSize(uploadImageMaxSizeBytes)}</p>
                    </div>
                    <input
                      className="hidden"
                      type="file"
                      accept="image/jpeg,image/png,image/gif"
                      disabled={remainingImageSlots <= 0}
                      multiple
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        if (files.length === 0) {
                          return;
                        }

                        try {
                          if (files.length > remainingImageSlots) {
                            throw new Error(`还能选择 ${remainingImageSlots} 张图片。`);
                          }
                          validateUploadImageFiles(files, uploadImageMaxSizeBytes);
                        } catch (nextError) {
                          event.target.value = '';
                          toastError(nextError);
                          return;
                        }

                        const nextImages = files.map(createLocalImageItem);
                        for (const image of nextImages) {
                          localPreviewUrls.current.add(image.preview);
                        }
                        setImages((current) => {
                          const merged = [...current, ...nextImages];
                          if (!coverImageId && merged[0]) {
                            setCoverImageId(merged[0].id);
                          }
                          return merged;
                        });
                        event.target.value = '';
                      }}
                    />
                  </label>
                </Field>
                {images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {images.map((image) => (
                      <div key={image.id} className="space-y-2 rounded-lg border bg-card p-2">
                        <AuthenticatedImage
                          className="aspect-square w-full rounded-md object-cover"
                          placeholderClassName="flex aspect-square w-full items-center justify-center rounded-md bg-muted/40"
                          src={image.preview}
                          alt="实践图片"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            type="button"
                            variant={coverImageId === image.id ? 'default' : 'outline'}
                            onClick={() => setCoverImageId(image.id)}
                          >
                            封面
                          </Button>
                          <Button
                            size="sm"
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              if (image.file) {
                                URL.revokeObjectURL(image.preview);
                                localPreviewUrls.current.delete(image.preview);
                              }
                              setImages((current) => {
                                const nextImages = current.filter((item) => item.id !== image.id);
                                if (coverImageId === image.id) {
                                  setCoverImageId(nextImages[0]?.id ?? '');
                                }
                                return nextImages;
                              });
                            }}
                          >
                            移除
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </StudentPageFrame>
  );
}

export function StudentNotificationsPage() {
  const { token, signOut, setNotificationCount } = useSession();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;

    unwrapResponse<{ notifications: AppNotification[]; unreadCount: number }>(createApiClient(token).student.notifications.get())
      .then(async (data) => {
        setNotifications(data.notifications);
        setNotificationCount(0);
        if (data.unreadCount > 0) {
          await unwrapResponse(createApiClient(token).student.notifications.read.post());
        }
      })
      .catch((nextError) => {
        if (nextError instanceof ApiResponseError && nextError.status === 401) {
          signOut();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : '加载通知失败。');
      })
      .finally(() => setLoading(false));
  }, [setNotificationCount, signOut, token]);

  return (
    <StudentPageFrame title="消息通知" description="这里会展示审核通过、驳回、删除以及撤销审核等状态变更。">
      {loading ? (
        <LoadingCard label="正在同步通知..." />
      ) : error ? (
        <ErrorCard message={error} />
      ) : notifications.length === 0 ? (
        <EmptyState title="暂无通知" description="你目前还没有收到新的系统消息。" />
      ) : (
        <div className="space-y-4">
          {notifications.map((notification) => (
            <Card key={notification.id} className={notification.is_read ? '' : 'ring-2 ring-[color:var(--ring-soft)]'}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={notification.type === 'approved' ? 'default' : notification.type === 'rejected' || notification.type === 'deleted' ? 'destructive' : 'secondary'}>
                      {notificationLabel(notification.type)}
                    </Badge>
                    {!notification.is_read ? <Badge variant="default">未读</Badge> : null}
                  </div>
                  <p className="text-sm text-[color:var(--muted-foreground)]">{formatDateTime(notification.created_at)}</p>
                </div>
                <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">{notification.message}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </StudentPageFrame>
  );
}

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
  const { token, user, signOut } = useSession();
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
                    if (!token) return;
                    setSubmitting('name');
                    try {
                      await unwrapResponse(createApiClient(token).auth.profile.put(nameForm));
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
                  if (!token) return;
                  if (passwordForm.new_password !== passwordForm.confirm_password) {
                    toastError(new Error('两次输入的密码不一致。'));
                    return;
                  }
                  setSubmitting('password');
                  try {
                    await unwrapResponse(
                      createApiClient(token).auth.password.put({
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-52 items-center justify-center gap-3 p-6 text-sm text-[color:var(--muted-foreground)]">
        <Spinner />
        {label}
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card>
      <CardContent className="flex min-h-52 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-rose-700">{message}</p>
        {onRetry ? <Button variant="secondary" onClick={onRetry}>重新加载</Button> : null}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === 'approved' ? 'default' : status === 'rejected' ? 'destructive' : 'outline'}>
      {statusLabel(status)}
    </Badge>
  );
}
