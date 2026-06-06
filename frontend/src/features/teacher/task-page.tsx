import { Download, Edit, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { DateRangePickerField } from '@/shared/date-picker-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiResponseError, createApiClient, unwrapResponse } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDateTime } from '@/lib/format';
import type { ClassSummary, PracticeTaskDetail, StudentWithClassSummary, TeacherRecord, TeacherRecordSummary } from '@/lib/types';
import { defaultFilters, ErrorCard, Field, LoadingCard, PageFrame, RecordPreview, SortButton, StatusBadge, StudentMultiCombobox, toStudentOption, UserMultiCombobox } from './shared';
import { formToPayload, taskToForm, TaskFormDialog, type TaskFormState } from './task-form';

export function TeacherTaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const { signOut, user } = useSession();
  const navigate = useNavigate();
  const basePath = user?.role === 'admin' ? '/admin/tasks' : '/teacher/tasks';
  const [task, setTask] = useState<PracticeTaskDetail | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [records, setRecords] = useState<TeacherRecordSummary[]>([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState('');
  const [reviewRecord, setReviewRecord] = useState<TeacherRecord | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewScore, setReviewScore] = useState('');
  const [sortBy, setSortBy] = useState<'created_at_desc' | 'score_desc' | 'score_asc'>('created_at_desc');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<TaskFormState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeClassTargets, setRemoveClassTargets] = useState<ClassSummary[]>([]);
  const [removeClassRecordCount, setRemoveClassRecordCount] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportClassIds, setExportClassIds] = useState<number[]>([]);

  async function loadTask() {
    if (!Number.isInteger(taskId)) return;
    setLoading(true);
    setError('');

    try {
      const api = createApiClient();
      const [taskData, classData] = await Promise.all([
        unwrapResponse<{ task: PracticeTaskDetail }>(api.teacher.tasks({ id: taskId }).get()),
        unwrapResponse<{ classes: ClassSummary[] }>(api.teacher.classes.get())
      ]);
      setTask(taskData.task);
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

  async function loadRecords() {
    if (!Number.isInteger(taskId)) return;
    setRecordsLoading(true);

    try {
      const data = await unwrapResponse<{ records: TeacherRecordSummary[] }>(createApiClient().teacher.records.get({
        query: {
          task_id: String(taskId),
          student_ids: filters.student_ids.length > 0 ? filters.student_ids.join(',') : undefined,
          class_ids: filters.class_ids.length > 0 ? filters.class_ids.join(',') : undefined,
          status: filters.status ? (filters.status as 'approved' | 'pending' | 'rejected') : undefined,
          practice_after: filters.practice_after || undefined,
          practice_before: filters.practice_before || undefined,
          created_after: filters.created_after ? new Date(filters.created_after).toISOString() : undefined,
          created_before: filters.created_before ? new Date(`${filters.created_before}T23:59:59.999`).toISOString() : undefined,
          sort: sortBy
        }
      }));
      setRecords(data.records);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      toastError(nextError, '加载记录失败。');
    } finally {
      setRecordsLoading(false);
    }
  }

  useEffect(() => {
    void loadTask();
  }, [taskId]);

  useEffect(() => {
    void loadRecords();
  }, [taskId, filters, sortBy]);

  const loadClassOptions = useCallback(async (query: string) => {
    const normalized = query.trim().toLowerCase();
    return classes
      .filter((item) => !normalized || item.name.toLowerCase().includes(normalized))
      .map((item) => ({ label: item.name, value: String(item.id) }));
  }, [classes]);

  const searchStudents = useCallback(async (query: string) => {
    try {
      const data = await unwrapResponse<{ students: StudentWithClassSummary[] }>(createApiClient().teacher.students.search({
        query: {
          q: query.trim() || undefined,
          class_ids: filters.class_ids.length > 0 ? filters.class_ids.join(',') : task?.classes.map((item) => item.id).join(',')
        }
      }));
      return data.students.map(toStudentOption);
    } catch {
      return [];
    }
  }, [filters.class_ids, task]);

  const columns = useMemo<Array<ColumnDef<TeacherRecordSummary>>>(() => {
    const baseColumns: Array<ColumnDef<TeacherRecordSummary>> = [
      { accessorKey: 'student_name', header: '学生' },
      { accessorKey: 'student_uid', header: 'UID' },
      { accessorKey: 'title', header: '标题' },
      { accessorKey: 'practice_date', header: '实践日期' },
      { accessorKey: 'status', header: '状态', cell: ({ row }) => <StatusBadge status={row.original.status} /> }
    ];

    if (task?.score_enabled) {
      baseColumns.push({
        accessorKey: 'score',
        header: () => (
          <SortButton
            active={sortBy === 'score_desc' || sortBy === 'score_asc'}
            descending={sortBy === 'score_desc'}
            label="分数"
            onClick={() => setSortBy((current) => current === 'score_desc' ? 'score_asc' : 'score_desc')}
          />
        ),
        cell: ({ row }) => row.original.score ?? '-'
      });
    }

    baseColumns.push(
      {
        accessorKey: 'created_at',
        header: () => (
          <SortButton
            active={sortBy === 'created_at_desc'}
            descending
            label="提交时间"
            onClick={() => setSortBy('created_at_desc')}
          />
        ),
        cell: ({ row }) => formatDateTime(row.original.created_at)
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => (
          <Button size="sm" onClick={async () => {
            const data = await unwrapResponse<{ record: TeacherRecord }>(createApiClient().teacher.records({ id: row.original.id }).get());
            setReviewRecord(data.record);
            setReviewComment(data.record.teacher_comment ?? '');
            setReviewScore(data.record.score === null ? '' : String(data.record.score));
          }}>处理</Button>
        )
      }
    );

    return baseColumns;
  }, [sortBy, task?.score_enabled]);

  return (
    <PageFrame
      title={task?.title ?? '任务详情'}
      description={task ? `开始：${formatDateTime(task.start_at)}，截止：${formatDateTime(task.end_at)}` : ''}
      action={task ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { void loadTask(); void loadRecords(); }}><RefreshCw className="size-4" />刷新</Button>
          <Button variant="outline" onClick={() => { setForm(taskToForm(task)); setFormOpen(true); }}><Edit className="size-4" />编辑</Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" />删除</Button>
        </div>
      ) : null}
    >
      {loading ? (
        <LoadingCard label="正在加载任务..." />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void loadTask()} />
      ) : task ? (
        <div className="space-y-5">
          <Card>
            <CardContent className="space-y-4">
              {task.description ? <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{task.description}</p> : null}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {task.classes.map((item) => (
                  <div key={item.id} className="rounded-3xl bg-muted px-3 py-2">
                    <p className="truncate text-sm">{item.name}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle>记录列表</CardTitle>
              <Button size="sm" variant="secondary" onClick={() => { setExportClassIds([]); setExportOpen(true); }}><Download className="size-4" />导出</Button>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <UserMultiCombobox label="班级" value={filters.class_ids} loadOptions={loadClassOptions} onChange={(value) => setFilters((current) => ({ ...current, class_ids: value, student_ids: [] }))} />
                <StudentMultiCombobox label="学生" value={filters.student_ids} loadOptions={searchStudents} onChange={(value) => setFilters((current) => ({ ...current, student_ids: value }))} />
                <Field label="状态">
                  <Select value={filters.status || '__all__'} onValueChange={(value) => setFilters((current) => ({ ...current, status: value === '__all__' ? '' : value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">全部状态</SelectItem>
                      <SelectItem value="pending">待审核</SelectItem>
                      <SelectItem value="approved">已通过</SelectItem>
                      <SelectItem value="rejected">已驳回</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="实践日期范围">
                  <DateRangePickerField
                    value={{ from: filters.practice_after, to: filters.practice_before }}
                    onChange={(value) => setFilters((current) => ({ ...current, practice_after: value.from, practice_before: value.to }))}
                  />
                </Field>
                <Field label="提交日期范围">
                  <DateRangePickerField
                    value={{ from: filters.created_after, to: filters.created_before }}
                    onChange={(value) => setFilters((current) => ({ ...current, created_after: value.from, created_before: value.to }))}
                  />
                </Field>
              </div>
              {recordsLoading ? <LoadingCard label="正在加载记录..." /> : <DataTable columns={columns} data={records} pagination={{ pageSize: 50 }} />}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {form && task ? (
        <TaskFormDialog
          open={formOpen}
          title="编辑任务"
          classes={classes}
          form={form}
          onOpenChange={setFormOpen}
          onFormChange={setForm}
          lockedClassIds={task.classes.map((item) => item.id)}
          onRemoveClassRequest={async (targetClasses) => {
            if (!task) return;
            const counts = await Promise.all(targetClasses.map(async (targetClass) => {
              const data = await unwrapResponse<{ count: number }>(createApiClient().teacher.tasks({ id: task.id }).classes({ classId: targetClass.id }).recordCount.get());
              return data.count;
            }));
            setRemoveClassTargets(targetClasses);
            setRemoveClassRecordCount(counts.reduce((sum, count) => sum + count, 0));
          }}
          onSubmit={async () => {
            if (!task) return;
            try {
              const { score_enabled: _scoreEnabled, ...payload } = formToPayload(form);
              await unwrapResponse(createApiClient().teacher.tasks({ id: task.id }).put(payload));
              toastSuccess('任务已更新。');
              setFormOpen(false);
              await loadTask();
            } catch (nextError) {
              if (nextError instanceof ApiResponseError && nextError.status === 401) {
                signOut();
                return;
              }
              toastError(nextError, '保存失败。');
            }
          }}
        />
      ) : null}

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>导出记录</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <UserMultiCombobox label="导出班级" value={exportClassIds} loadOptions={loadClassOptions} onChange={setExportClassIds} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setExportOpen(false)}>取消</Button>
              <Button onClick={async () => {
                if (!task) return;
                if (exportClassIds.length === 0) {
                  toastError(new Error('导出班级不可为空。'));
                  return;
                }
                const response = await createApiClient().teacher.tasks({ id: task.id }).export.post({ class_ids: exportClassIds });
                if (response.error) throw new ApiResponseError(response.status, '导出失败。');
                const url = URL.createObjectURL(new Blob([response.data as string], { type: 'text/csv;charset=utf-8' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = `${task.title}.csv`;
                link.click();
                URL.revokeObjectURL(url);
                setExportOpen(false);
              }}>导出</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除任务"
        description="任务下的全部记录也会被永久删除。"
        confirmLabel="删除"
        variant="destructive"
        onConfirm={async () => {
          if (!task) return;
          await unwrapResponse(createApiClient().teacher.tasks({ id: task.id }).delete());
          navigate(basePath, { replace: true });
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
          if (!task || removeClassTargets.length === 0) return;
          for (const targetClass of removeClassTargets) {
            await unwrapResponse(createApiClient().teacher.tasks({ id: task.id }).classes({ classId: targetClass.id }).delete());
          }
          const removedClassIds = new Set(removeClassTargets.map((item) => item.id));
          setForm((current) => current ? {
            ...current,
            class_ids: current.class_ids.filter((classId) => !removedClassIds.has(classId))
          } : current);
          setRemoveClassTargets([]);
          setRemoveClassRecordCount(0);
          await loadTask();
          await loadRecords();
        }}
      />

      <Dialog open={Boolean(reviewRecord)} onOpenChange={(open) => !open && setReviewRecord(null)}>
        <DialogContent>
          {reviewRecord ? (
            <>
              <DialogHeader>
                <DialogTitle>{reviewRecord.title}</DialogTitle>
                <DialogDescription>学生：{reviewRecord.student_name}（{reviewRecord.student_uid}）</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <RecordPreview record={reviewRecord} />
                <Field label="评语"><Textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} /></Field>
                {task?.score_enabled ? (
                  <Field label="分数"><Input type="number" min="0" max="100" step="1" value={reviewScore} onChange={(event) => setReviewScore(event.target.value)} /></Field>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="destructive" onClick={async () => {
                    if (!reviewRecord) return;
                    await unwrapResponse(createApiClient().teacher.records({ id: reviewRecord.id }).delete());
                    setReviewRecord(null);
                    await loadRecords();
                  }}>删除</Button>
                  <Button variant="outline" onClick={async () => {
                    if (!reviewRecord) return;
                    await unwrapResponse(createApiClient().teacher.records({ id: reviewRecord.id }).review.put({ status: 'rejected', comment: reviewComment }));
                    setReviewRecord(null);
                    await loadRecords();
                  }}>驳回</Button>
                  <Button onClick={async () => {
                    if (!reviewRecord) return;
                    const score = Number(reviewScore);
                    if (task?.score_enabled && (reviewScore.trim() === '' || !Number.isInteger(score) || score < 0 || score > 100)) {
                      toastError(new Error('分数必须是 0 到 100 的整数。'));
                      return;
                    }
                    await unwrapResponse(createApiClient().teacher.records({ id: reviewRecord.id }).review.put({
                      status: 'approved',
                      comment: reviewComment,
                      ...(task?.score_enabled ? { score } : {})
                    }));
                    setReviewRecord(null);
                    await loadRecords();
                  }}>通过</Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
