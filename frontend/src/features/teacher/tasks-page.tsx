import { Edit, PlusCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { EmptyState } from '@/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiResponseError, createApiClient, unwrapResponse } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDateTime } from '@/lib/format';
import type { ClassSummary, PracticeTaskDetail, PracticeTaskSummary } from '@/lib/types';
import { ErrorCard, LoadingCard, PageFrame } from './shared';
import { emptyTaskForm, formToPayload, taskToForm, TaskFormDialog, type TaskFormState } from './task-form';

type TaskTab = 'active' | 'upcoming' | 'ended';

function getTaskTab(task: PracticeTaskSummary) {
  const now = new Date().toISOString();

  if (now < task.start_at) return 'upcoming';
  if (now > task.end_at) return 'ended';
  return 'active';
}

function sortTasks(tab: TaskTab, tasks: PracticeTaskSummary[]) {
  return [...tasks].sort((left, right) => {
    if (tab === 'active') return left.end_at.localeCompare(right.end_at);
    if (tab === 'upcoming') return left.start_at.localeCompare(right.start_at);
    return right.end_at.localeCompare(left.end_at);
  });
}

export function TeacherTasksPage() {
  const { signOut, user } = useSession();
  const navigate = useNavigate();
  const basePath = user?.role === 'admin' ? '/admin/tasks' : '/teacher/tasks';
  const [tasks, setTasks] = useState<PracticeTaskSummary[]>([]);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PracticeTaskDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PracticeTaskSummary | null>(null);
  const [removeClassTargets, setRemoveClassTargets] = useState<ClassSummary[]>([]);
  const [removeClassRecordCount, setRemoveClassRecordCount] = useState(0);
  const [form, setForm] = useState<TaskFormState>(emptyTaskForm);

  async function load() {
    setLoading(true);
    setError('');

    try {
      const api = createApiClient();
      const [taskData, classData] = await Promise.all([
        unwrapResponse<{ tasks: PracticeTaskSummary[] }>(api.teacher.tasks.get()),
        unwrapResponse<{ classes: ClassSummary[] }>(api.teacher.classes.get())
      ]);
      setTasks(taskData.tasks);
      setClasses(classData.classes);
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
  }, []);

  const grouped = useMemo(() => ({
    active: sortTasks('active', tasks.filter((task) => getTaskTab(task) === 'active')),
    upcoming: sortTasks('upcoming', tasks.filter((task) => getTaskTab(task) === 'upcoming')),
    ended: sortTasks('ended', tasks.filter((task) => getTaskTab(task) === 'ended'))
  }), [tasks]);

  async function openEdit(taskId: number) {
    try {
      const data = await unwrapResponse<{ task: PracticeTaskDetail }>(createApiClient().teacher.tasks({ id: taskId }).get());
      setEditingTask(data.task);
      setForm(taskToForm(data.task));
      setFormOpen(true);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      toastError(nextError, '加载任务失败。');
    }
  }

  return (
    <PageFrame
      title="任务管理"
      action={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}><RefreshCw className="size-4" />刷新</Button>
          <Button onClick={() => { setEditingTask(null); setForm(emptyTaskForm); setFormOpen(true); }}><PlusCircle className="size-4" />创建任务</Button>
        </div>
      }
    >
      {loading ? (
        <LoadingCard label="正在加载任务..." />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : (
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">进行中</TabsTrigger>
            <TabsTrigger value="upcoming">未开始</TabsTrigger>
            <TabsTrigger value="ended">已结束</TabsTrigger>
          </TabsList>
          <TaskList value="active" tasks={grouped.active} onOpen={(task) => navigate(`${basePath}/${task.id}`)} onEdit={openEdit} onDelete={setDeleteTarget} />
          <TaskList value="upcoming" tasks={grouped.upcoming} onOpen={(task) => navigate(`${basePath}/${task.id}`)} onEdit={openEdit} onDelete={setDeleteTarget} />
          <TaskList value="ended" tasks={grouped.ended} onOpen={(task) => navigate(`${basePath}/${task.id}`)} onEdit={openEdit} onDelete={setDeleteTarget} />
        </Tabs>
      )}

      <TaskFormDialog
        open={formOpen}
        title={editingTask ? '编辑任务' : '创建任务'}
        classes={classes}
        form={form}
        onOpenChange={setFormOpen}
        onFormChange={setForm}
        showScoreEnabled={!editingTask}
        lockedClassIds={editingTask?.classes.map((item) => item.id)}
        onRemoveClassRequest={async (targetClasses) => {
          if (!editingTask) return;
          const counts = await Promise.all(targetClasses.map(async (targetClass) => {
            const data = await unwrapResponse<{ count: number }>(createApiClient().teacher.tasks({ id: editingTask.id }).classes({ classId: targetClass.id }).recordCount.get());
            return data.count;
          }));
          setRemoveClassTargets(targetClasses);
          setRemoveClassRecordCount(counts.reduce((sum, count) => sum + count, 0));
        }}
        onSubmit={async () => {
          try {
            if (editingTask) {
              const { score_enabled: _scoreEnabled, ...payload } = formToPayload(form);
              await unwrapResponse(createApiClient().teacher.tasks({ id: editingTask.id }).put(payload));
            } else {
              await unwrapResponse(createApiClient().teacher.tasks.post(formToPayload(form)));
            }
            toastSuccess(editingTask ? '任务已更新。' : '任务已创建。');
            setFormOpen(false);
            await load();
          } catch (nextError) {
            if (nextError instanceof ApiResponseError && nextError.status === 401) {
              signOut();
              return;
            }
            toastError(nextError, '保存失败。');
          }
        }}
      />

      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="确认删除任务"
        description="任务下的全部记录也会被永久删除。"
        confirmLabel="删除"
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await unwrapResponse(createApiClient().teacher.tasks({ id: deleteTarget.id }).delete());
          setDeleteTarget(null);
          await load();
        }}
      />

      <ConfirmActionDialog
        open={removeClassTargets.length > 0}
        onOpenChange={(open) => !open && setRemoveClassTargets([])}
        title="确认移除班级"
        description={removeClassTargets.length > 0 ? `这 ${removeClassTargets.length} 个班级在该任务下的 ${removeClassRecordCount} 条记录也会被永久删除。` : ''}
        confirmLabel="删除"
        variant="destructive"
        onConfirm={async () => {
          if (!editingTask || removeClassTargets.length === 0) return;
          for (const targetClass of removeClassTargets) {
            await unwrapResponse(createApiClient().teacher.tasks({ id: editingTask.id }).classes({ classId: targetClass.id }).delete());
          }
          const removedClassIds = new Set(removeClassTargets.map((item) => item.id));
          setForm((current) => ({
            ...current,
            class_ids: current.class_ids.filter((classId) => !removedClassIds.has(classId))
          }));
          setEditingTask((current) => current ? {
            ...current,
            classes: current.classes.filter((item) => !removedClassIds.has(item.id))
          } : current);
          setRemoveClassTargets([]);
          setRemoveClassRecordCount(0);
          await load();
        }}
      />
    </PageFrame>
  );
}

function TaskList({
  value,
  tasks,
  onOpen,
  onEdit,
  onDelete
}: {
  value: TaskTab;
  tasks: PracticeTaskSummary[];
  onOpen: (task: PracticeTaskSummary) => void;
  onEdit: (taskId: number) => Promise<void>;
  onDelete: (task: PracticeTaskSummary) => void;
}) {
  return (
    <TabsContent value={value} className="mt-4">
      {tasks.length === 0 ? (
        <EmptyState title="暂无任务" />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <Card
              key={task.id}
              size="sm"
              variant="interactive"
              onClick={() => onOpen(task)}
            >
              <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-bold">{task.title}</h2>
                    <Badge variant="outline">{task.class_count} 个班级</Badge>
                    <Badge variant={task.pending_count > 0 ? 'destructive' : 'secondary'}>{task.pending_count} 待审核</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>开始：{formatDateTime(task.start_at)}</span>
                    <span>截止：{formatDateTime(task.end_at)}</span>
                    <span>记录：{task.record_count}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2" onClick={(event) => event.stopPropagation()}>
                  <Button size="icon" variant="ghost" aria-label="编辑任务" onClick={() => void onEdit(task.id)}>
                    <Edit className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="删除任务" onClick={() => onDelete(task)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </TabsContent>
  );
}
