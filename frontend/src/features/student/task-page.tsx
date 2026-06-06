import { CalendarDays, ImagePlus, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { AuthenticatedImage } from '@/shared/authenticated-image';
import { EmptyState } from '@/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiResponseError, createApiClient, unwrapResponse } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDate, formatDateTime, formatDuration, getServerNowIso } from '@/lib/format';
import { useRuntimeConfig } from '@/lib/runtime-config';
import type { PracticeTaskSummary, StudentRecord } from '@/lib/types';
import { ErrorCard, LoadingCard, StatusBadge, StudentPageFrame } from './shared';

export function StudentTaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const { signOut } = useSession();
  const { client_time_offset_ms: clientOffsetMs } = useRuntimeConfig();
  const navigate = useNavigate();
  const [task, setTask] = useState<PracticeTaskSummary | null>(null);
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<StudentRecord | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function load() {
    if (!Number.isInteger(taskId)) return;
    setLoading(true);
    setError('');

    try {
      const data = await unwrapResponse<{ task: PracticeTaskSummary; records: StudentRecord[] }>(createApiClient().student.tasks({ id: taskId }).get());
      setTask(data.task);
      setRecords(data.records);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      setError(nextError instanceof Error ? nextError.message : '加载任务失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [taskId]);

  const now = getServerNowIso(clientOffsetMs);
  const canAdd = task ? now >= task.start_at && now <= task.end_at && records.length < task.max_records_per_student : false;

  return (
    <StudentPageFrame
      title={task?.title ?? '任务详情'}
      description={task ? `开始：${formatDateTime(task.start_at, '-', clientOffsetMs)}，截止：${formatDateTime(task.end_at, '-', clientOffsetMs)}` : ''}
      action={task && canAdd ? (
        <Button asChild>
          <Link to={`/student/tasks/${task.id}/upload`}>
            <PlusCircle className="size-4" />
            添加记录
          </Link>
        </Button>
      ) : null}
    >
      {loading ? (
        <LoadingCard label="正在加载任务记录..." />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : task ? (
        <div className="space-y-5">
          <Card>
            <CardContent className="space-y-3">
              {task.description ? <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{task.description}</p> : null}
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="outline">最少 {task.min_words} 字</Badge>
                <Badge variant="outline">最少 {task.min_images} 张图片</Badge>
                <Badge variant="outline">最多 {task.max_records_per_student} 条记录</Badge>
              </div>
            </CardContent>
          </Card>

          {records.length === 0 ? (
            <EmptyState title="还没有记录" action={canAdd ? <Button asChild><Link to={`/student/tasks/${task.id}/upload`}>添加记录</Link></Button> : undefined} />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {records.map((record) => (
                <Card key={record.id} padding="none">
                  <CardContent className="grid p-0 md:grid-cols-[160px_minmax(0,1fr)]">
                    <div className="relative min-h-36 bg-muted">
                      {record.cover_image_path ? (
                        <AuthenticatedImage className="h-full w-full object-cover" placeholderClassName="flex h-full w-full items-center justify-center bg-muted/40" src={record.cover_image_path} alt={record.title} />
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                          <ImagePlus className="size-10" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 p-(--card-spacing)">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <h3 className="truncate text-lg font-bold">{record.title}</h3>
                          <p className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" />{formatDate(record.practice_date)}</span>
                            <span>{formatDuration(record.duration)} 小时</span>
                          </p>
                        </div>
                        <StatusBadge status={record.status} />
                      </div>
                      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{record.content}</p>
                      {record.teacher_comment ? <p className="rounded-2xl bg-muted p-3 text-sm text-muted-foreground">{record.teacher_comment}</p> : null}
                      <div className="flex flex-wrap gap-2">
                        {record.status === 'pending' || record.status === 'rejected' ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/student/tasks/${task.id}/upload?id=${record.id}`}>
                              <Pencil className="size-4" />
                              修改
                            </Link>
                          </Button>
                        ) : null}
                        {record.status === 'pending' ? (
                          <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(record)}>
                            <Trash2 className="size-4" />
                            删除
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="确认删除记录"
        description={deleteTarget ? `《${deleteTarget.title}》将被永久删除。` : ''}
        confirmLabel="删除"
        loading={deleteLoading}
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            setDeleteLoading(true);
            await unwrapResponse(createApiClient().student.records({ id: deleteTarget.id }).delete());
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
