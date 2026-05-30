import { ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useSession } from '@/lib/auth';
import { AuthenticatedImage } from '@/shared/authenticated-image';
import { DatePickerField } from '@/shared/date-picker-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ApiResponseError, createApiClient, formatUploadImageMaxSize, getRuntimeConfig, unwrapResponse, uploadImage, validateUploadImageFiles } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/feedback';
import { normalizeDateInputValue } from '@/lib/format';
import { MAX_RECORD_IMAGES, type PracticeTaskSummary, type StudentRecord } from '@/lib/types';
import { createLocalImageItem, type UploadImageItem } from './upload-types';
import { ErrorCard, Field, LoadingCard, StudentPageFrame } from './shared';

export function StudentUploadPage() {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const { taskId: taskIdParam } = useParams();
  const taskId = Number(taskIdParam);
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [uploadImageMaxSizeBytes, setUploadImageMaxSizeBytes] = useState(5 * 1024 * 1024);
  const [task, setTask] = useState<PracticeTaskSummary | null>(null);
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
    if (!Number.isInteger(taskId) || taskId <= 0) return;
 
    unwrapResponse<{ task: PracticeTaskSummary; records: StudentRecord[] }>(createApiClient().student.tasks({ id: taskId }).get())
      .then((data) => {
        setTask(data.task);
        if (editId) {
          const record = data.records.find((item) => String(item.id) === editId);
          if (!record || (record.status !== 'pending' && record.status !== 'rejected')) {
            toastError(new Error('无法编辑该记录或记录不存在。'));
            navigate(`/student/tasks/${taskId}`, { replace: true });
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
        }
      })
      .catch((nextError) => {
        if (nextError instanceof ApiResponseError && nextError.status === 401) {
          signOut();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : '加载任务失败。');
      })
      .finally(() => setLoading(false));
  }, [editId, navigate, signOut, taskId]);

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
      description={task ? task.title : '提交任务记录。'}
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
                setError('');
                setSubmitting(true);

                try {
                  if (images.length > MAX_RECORD_IMAGES) {
                    throw new Error(`每条记录最多上传 ${MAX_RECORD_IMAGES} 张图片。`);
                  }
                  if (!task) {
                    throw new Error('任务不存在。');
                  }
                  if (form.content.trim().length < task.min_words) {
                    throw new Error(`实践内容不能少于 ${task.min_words} 字。`);
                  }
                  if (images.length < task.min_images) {
                    throw new Error(`至少需要上传 ${task.min_images} 张图片。`);
                  }

                  const uploadedImages = await Promise.all(images.map(async (image) => {
                    if (image.path) {
                      return {
                        id: image.id,
                        path: image.path
                      };
                    }

                    const uploadResult = await uploadImage(image.file!, uploadImageMaxSizeBytes);
                    return {
                      id: image.id,
                      path: uploadResult.imageUrl
                    };
                  }));
                  const imagePaths = uploadedImages.map((image) => image.path);
                  const coverImagePath = uploadedImages.find((image) => image.id === coverImageId)?.path ?? imagePaths[0] ?? null;

                  const api = createApiClient();
                  const payload = {
                    ...form,
                    task_id: task.id,
                    title: form.title.trim(),
                    content: form.content.trim(),
                    location: form.location.trim() || null,
                    duration: form.duration.trim()
                  };

                  if (editId) {
                    await unwrapResponse(api.student.records({ id: Number(editId) }).put({
                      ...payload,
                      image_paths: imagePaths,
                      cover_image_path: coverImagePath
                    }));
                  } else {
                    await unwrapResponse(api.student.records.post({
                      ...payload,
                      image_paths: imagePaths,
                      cover_image_path: coverImagePath
                    }));
                  }

                  toastSuccess(editId ? '记录更新成功。' : '记录提交成功。');
                  navigate(`/student/tasks/${task.id}`, { replace: true });
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
                    <Link to={task ? `/student/tasks/${task.id}` : '/student/dashboard'}>返回任务</Link>
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
