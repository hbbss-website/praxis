import { ArrowDown, ArrowUp, CheckCircle2, Clock3, FilePenLine, RefreshCw, UserRoundCog, Users } from 'lucide-react';
import { memo, useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { useSession } from '@/lib/auth';
import { DatePickerField } from '@/shared/date-picker-field';
import { EmptyState } from '@/shared/empty-state';
import { AuthenticatedImage } from '@/shared/authenticated-image';
import { StatCard } from '@/shared/stat-card';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ApiResponseError, createApiClient, unwrapResponse } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDate, formatDateTime, formatDuration, normalizeDateInputValue, statusLabel } from '@/lib/format';
import { useShiftMultiSelect } from '@/lib/shift-selection';
import type { CreatedUser, StudentSummary, TeacherRecord, TeacherRecordSummary, TeacherStatistics, UserSummary } from '@/lib/types';
import { UserCredentialsResult } from '@/shared/user-credentials-result';
import { AccountCard } from './student-pages';

function PageFrame({
  title,
  description,
  children,
  action
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

const defaultFilters = {
  student_id: '',
  teacher_id: '',
  status: '',
  practice_after: '',
  practice_before: '',
  created_after: '',
  created_before: ''
};

export function TeacherDashboardPage() {
  const { token, signOut, user } = useSession();
  const { captureShiftKey, resetSelectionAnchor, updateSelection } = useShiftMultiSelect();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [records, setRecords] = useState<TeacherRecordSummary[]>([]);
  const [statistics, setStatistics] = useState<TeacherStatistics | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [reviewRecord, setReviewRecord] = useState<TeacherRecord | null>(null);
  const [editRecord, setEditRecord] = useState<TeacherRecord | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [reviewComment, setReviewComment] = useState('');
  const [editForm, setEditForm] = useState({
    title: '',
    content: '',
    practice_date: '',
    duration: '',
    location: ''
  });
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TeacherRecordSummary | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const recordIds = useMemo(() => records.map((record) => record.id), [records]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const teacherFilterOptions = useMemo(
    () => [{ label: '全部老师', value: '' }, ...teachers.map((teacher) => ({ label: `${teacher.name} (${teacher.uid})`, value: String(teacher.id) }))],
    [teachers]
  );
  const studentFilterOptions = useMemo(
    () => [{ label: '全部学生', value: '' }, ...students.map((student) => ({ label: `${student.name} (${student.uid})`, value: String(student.id) }))],
    [students]
  );
  const allSelected = records.length > 0 && selectedIds.length === records.length;
  const openTeacherFilter = useEffectEvent(() => {
    void loadTeachers();
  });
  const openStudentFilter = useEffectEvent(() => {
    void loadStudents();
  });
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.student_id) params.set('student_id', filters.student_id);
    if (filters.teacher_id) params.set('teacher_id', filters.teacher_id);
    if (filters.status) params.set('status', filters.status);
    if (filters.practice_after) params.set('practice_after', filters.practice_after);
    if (filters.practice_before) params.set('practice_before', filters.practice_before);
    if (filters.created_after) params.set('created_after', new Date(filters.created_after).toISOString());
    if (filters.created_before) {
      const end = new Date(filters.created_before);
      end.setHours(23, 59, 59, 999);
      params.set('created_before', end.toISOString());
    }
    return params.toString();
  }, [filters]);

  async function loadStudents() {
    if (!token || studentsLoading || students.length > 0) return;
    setStudentsLoading(true);
    try {
      const data = await unwrapResponse<{ students: StudentSummary[] }>(createApiClient(token).teacher.students.get());
      setStudents(data.students);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    } finally {
      setStudentsLoading(false);
    }
  }

  async function loadTeachers() {
    if (!token || user?.role !== 'admin' || teachersLoading || teachers.length > 0) return;
    setTeachersLoading(true);
    try {
      const data = await unwrapResponse<{ users: UserSummary[] }>(createApiClient(token).admin.users.get({ query: { role: 'teacher' } }));
      setTeachers(data.users);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    } finally {
      setTeachersLoading(false);
    }
  }

  async function loadRecords() {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const data = await unwrapResponse<{ records: TeacherRecordSummary[] }>(
        createApiClient(token).teacher.records.get({
          query: {
            student_id: filters.student_id || undefined,
            teacher_id: filters.teacher_id || undefined,
            status: filters.status ? (filters.status as 'approved' | 'pending' | 'rejected') : undefined,
            practice_after: filters.practice_after || undefined,
            practice_before: filters.practice_before || undefined,
            created_after: filters.created_after ? new Date(filters.created_after).toISOString() : undefined,
            created_before: filters.created_before ? (() => {
              const end = new Date(filters.created_before);
              end.setHours(23, 59, 59, 999);
              return end.toISOString();
            })() : undefined
          }
        })
      );
      setRecords(data.records);
      setSelectedIds([]);
      resetSelectionAnchor();
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

  async function loadStatistics() {
    if (!token) return;
    setStatsLoading(true);
    try {
      const data = await unwrapResponse<{ statistics: TeacherStatistics }>(createApiClient(token).teacher.statistics.get());
      setStatistics(data.statistics);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    void loadRecords();
  }, [query, token]);

  useEffect(() => {
    void loadStatistics();
  }, [token]);

  const columns = useMemo<Array<ColumnDef<TeacherRecordSummary>>>(() => [
    {
      id: 'select',
      header: () => <Checkbox checked={allSelected} onCheckedChange={(checked) => setSelectedIds(checked ? recordIds : [])} />,
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIdSet.has(row.original.id)}
          onClick={captureShiftKey}
          onCheckedChange={(checked) =>
            setSelectedIds((current) =>
              updateSelection(
                recordIds,
                current,
                row.original.id,
                checked === true
              )
            )
          }
        />
      )
    },
    {
      id: 'student',
      header: '学生',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.student_name}</p>
          <p className="text-xs text-muted-foreground">{row.original.student_uid}</p>
        </div>
      )
    },
    { accessorKey: 'title', header: '标题' },
    {
      accessorKey: 'practice_date',
      header: '实践日期',
      cell: ({ row }) => formatDate(row.original.practice_date)
    },
    {
      id: 'status',
      header: '状态',
      cell: ({ row }) => <StatusBadge status={row.original.status} />
    },
    {
      accessorKey: 'created_at',
      header: '上传日期',
      cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.created_at)}</span>
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void openReview(row.original.id)}>审核</Button>
          <Button size="sm" variant="outline" onClick={() => void openEdit(row.original.id)}>编辑</Button>
          <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(row.original)}>删除</Button>
        </div>
      )
    }
  ], [allSelected, captureShiftKey, recordIds, selectedIdSet, updateSelection]);

  return (
    <PageFrame
      title={user?.role === 'admin' ? '记录管理' : '审核中心'}
      description={user?.role === 'admin' ? '管理员可以查看并审核全部实践记录，支持按学生、实践日期、上传日期和状态筛选，以及批量处理。' : '保留原有审核、编辑、删除和批量处理逻辑，支持按学生、实践日期和上传日期筛选。'}
      action={<Button variant="secondary" onClick={() => { void loadRecords(); void loadStatistics(); }}><RefreshCw className="size-4" />刷新数据</Button>}
    >
      {statistics ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="记录总数" value={String(statistics.total_records)} hint="当前可见范围内的全部记录" icon={FilePenLine} />
          <StatCard title="待审核" value={String(statistics.pending_count)} hint="需要尽快处理" icon={Clock3} />
          <StatCard title="已通过" value={String(statistics.approved_count)} hint="通过后计入时长" icon={CheckCircle2} />
          <StatCard title="学生人数" value={String(statistics.student_count)} hint={statsLoading ? '统计中...' : '当前可见学生数量'} icon={Users} />
        </div>
      ) : null}

      <div className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>记录筛选</CardTitle>
            <CardDescription>筛选条件会即时刷新列表。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {user?.role === 'admin' ? (
                <FilterSelect
                  label="管理老师"
                  value={filters.teacher_id}
                  options={teacherFilterOptions}
                  loading={teachersLoading}
                  onOpen={openTeacherFilter}
                  onChange={(value) => setFilters((current) => ({ ...current, teacher_id: value }))}
                />
              ) : null}
              <FilterSelect
                label="学生"
                value={filters.student_id}
                options={studentFilterOptions}
                loading={studentsLoading}
                onOpen={openStudentFilter}
                onChange={(value) => setFilters((current) => ({ ...current, student_id: value }))}
              />
              <FilterSelect
                label="状态"
                value={filters.status}
                options={[
                  { label: '全部状态', value: '' },
                  { label: '待审核', value: 'pending' },
                  { label: '已通过', value: 'approved' },
                  { label: '已驳回', value: 'rejected' }
                ]}
                onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
              />
              <Field label="实践日期起始">
                <DatePickerField value={filters.practice_after} onChange={(value) => setFilters((current) => ({ ...current, practice_after: value }))} />
              </Field>
              <Field label="实践日期结束">
                <DatePickerField value={filters.practice_before} onChange={(value) => setFilters((current) => ({ ...current, practice_before: value }))} />
              </Field>
              <Field label="上传日期起始">
                <DatePickerField value={filters.created_after} onChange={(value) => setFilters((current) => ({ ...current, created_after: value }))} />
              </Field>
              <Field label="上传日期结束">
                <DatePickerField value={filters.created_before} onChange={(value) => setFilters((current) => ({ ...current, created_before: value }))} />
              </Field>
            </div>

            {selectedIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-100 p-3">
                <p className="mr-2 text-sm text-[color:var(--muted-foreground)]">已选 {selectedIds.length} 条</p>
                <Button size="sm" onClick={() => void runBatchAction('approved')}>批量通过</Button>
                <Button size="sm" variant="outline" onClick={() => void runBatchAction('rejected')}>批量驳回</Button>
                <Button size="sm" variant="secondary" onClick={() => void runBatchAction('pending')}>撤回待审核</Button>
                <Button size="sm" variant="destructive" onClick={() => setBatchDeleteOpen(true)}>批量删除</Button>
              </div>
            ) : null}

            {loading ? (
              <LoadingCard label="正在加载记录列表..." />
            ) : error ? (
              <ErrorCard message={error} onRetry={() => void loadRecords()} />
            ) : records.length === 0 ? (
              <EmptyState title="暂无记录" description="当前筛选条件下没有找到对应的实践记录。" />
            ) : (
              <DataTable batchSize={60} columns={columns} data={records} />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(reviewRecord)} onOpenChange={(open) => !open && setReviewRecord(null)}>
        <DialogContent>
          {reviewRecord ? (
            <>
              <DialogHeader>
                <DialogTitle>审核记录</DialogTitle>
                <DialogDescription>{reviewRecord.student_name} · {reviewRecord.student_uid}</DialogDescription>
              </DialogHeader>
              <RecordPreview record={reviewRecord} />
              <div className="space-y-2">
                <Label>审核评语</Label>
                <Textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void submitReview('approved')}>通过</Button>
                <Button variant="outline" onClick={() => void submitReview('rejected')}>驳回</Button>
                <Button variant="secondary" onClick={() => void submitReview('pending')}>撤回待审核</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={editLoading || Boolean(editRecord)}
        onOpenChange={(open) => {
          if (!open) {
            setEditLoading(false);
            setEditRecord(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          {editRecord ? (
            <>
              <DialogHeader>
                <DialogTitle>编辑记录</DialogTitle>
                <DialogDescription>保留原有教师端编辑逻辑。</DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                <Field label="标题"><Input value={editForm.title} onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))} /></Field>
                <Field label="内容"><Textarea value={editForm.content} onChange={(event) => setEditForm((current) => ({ ...current, content: event.target.value }))} /></Field>
                <div className="grid gap-5 md:grid-cols-3">
                  <Field label="日期"><DatePickerField value={editForm.practice_date} onChange={(value) => setEditForm((current) => ({ ...current, practice_date: value }))} /></Field>
                  <Field label="时长"><Input type="number" step="0.1" min="0.1" value={editForm.duration} onChange={(event) => setEditForm((current) => ({ ...current, duration: event.target.value }))} /></Field>
                  <Field label="地点"><Input value={editForm.location} onChange={(event) => setEditForm((current) => ({ ...current, location: event.target.value }))} /></Field>
                </div>
                <Button className="w-full sm:w-auto" onClick={() => void saveEdit()}>保存修改</Button>
              </div>
            </>
          ) : editLoading ? (
            <LoadingCard label="正在加载记录详情..." />
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
          if (!deleteTarget) return;
          await deleteRecord(deleteTarget.id);
        }}
      />

      <ConfirmActionDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title="确认批量删除记录"
        description={`将删除当前选中的 ${selectedIds.length} 条记录，删除后不可恢复。`}
        confirmLabel="批量删除"
        loading={deleteLoading}
        variant="destructive"
        onConfirm={async () => {
          await runBatchAction('deleted');
        }}
      />
    </PageFrame>
  );

  async function openReview(recordId: number) {
    if (!token) return;
    try {
      const data = await unwrapResponse<{ record: TeacherRecord }>(createApiClient(token).teacher.records({ id: recordId }).get());
      setReviewRecord(data.record);
      setReviewComment(data.record.teacher_comment ?? '');
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      toastError(nextError, '加载记录详情失败。');
    }
  }

  async function openEdit(recordId: number) {
    if (!token) return;
    setEditLoading(true);
    setEditRecord(null);
    try {
      const data = await unwrapResponse<{ record: TeacherRecord }>(createApiClient(token).teacher.records({ id: recordId }).get());
      setEditRecord(data.record);
      setEditForm({
        title: data.record.title,
        content: data.record.content,
        practice_date: normalizeDateInputValue(data.record.practice_date),
        duration: String(data.record.duration ?? ''),
        location: data.record.location ?? ''
      });
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      setEditLoading(false);
      toastError(nextError, '加载记录详情失败。');
      return;
    }
    setEditLoading(false);
  }

  async function submitReview(status: 'approved' | 'rejected' | 'pending') {
    if (!token || !reviewRecord) return;
    try {
      await unwrapResponse(
        createApiClient(token).teacher.records({ id: reviewRecord.id }).review.put({
          status,
          comment: reviewComment.trim()
        })
      );
      setReviewRecord(null);
      setReviewComment('');
      toastSuccess('审核结果已保存。');
      await Promise.all([loadRecords(), loadStatistics()]);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      toastError(nextError, '保存审核结果失败。');
    }
  }

  async function runBatchAction(action: 'approved' | 'rejected' | 'pending' | 'deleted') {
    if (!token) return;
    try {
      await unwrapResponse(createApiClient(token).teacher.records['batch-review'].post({ ids: selectedIds, action }));
      if (action === 'deleted') {
        setBatchDeleteOpen(false);
        toastSuccess(`已删除 ${selectedIds.length} 条记录。`);
      } else {
        toastSuccess(`已处理 ${selectedIds.length} 条记录。`);
      }
      await Promise.all([loadRecords(), loadStatistics()]);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      toastError(nextError, '批量操作失败。');
    }
  }

  async function saveEdit() {
    if (!token || !editRecord) return;
    try {
      await unwrapResponse(
        createApiClient(token).teacher.records({ id: editRecord.id }).put({
          title: editForm.title.trim(),
          content: editForm.content.trim(),
          practice_date: editForm.practice_date,
          duration: editForm.duration,
          location: editForm.location.trim() || null
        })
      );
      setEditRecord(null);
      toastSuccess('记录修改已保存。');
      await loadRecords();
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      toastError(nextError, '保存修改失败。');
    }
  }

  async function deleteRecord(recordId: number) {
    if (!token) return;
    try {
      setDeleteLoading(true);
      await unwrapResponse(createApiClient(token).teacher.records({ id: recordId }).delete());
      setDeleteTarget(null);
      toastSuccess('记录已删除。');
      await Promise.all([loadRecords(), loadStatistics()]);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      toastError(nextError, '删除失败。');
    } finally {
      setDeleteLoading(false);
    }
  }
}

export function TeacherStudentsPage() {
  const { token, signOut } = useSession();
  const { captureShiftKey, resetSelectionAnchor, updateSelection } = useShiftMultiSelect();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [sortBy, setSortBy] = useState<'duration-desc' | 'duration-asc' | 'uid-asc' | 'uid-desc' | 'name-asc' | 'name-desc'>('duration-desc');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<StudentSummary | null>(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [batchResetOpen, setBatchResetOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<CreatedUser[]>([]);

  async function loadData() {
    if (!token) return;
    try {
      const [studentsData, statisticsData] = await Promise.all([
        unwrapResponse<{ students: StudentSummary[] }>(createApiClient(token).teacher.students.get()),
        unwrapResponse<{ statistics: TeacherStatistics }>(createApiClient(token).teacher.statistics.get())
      ]);

      setStudents(studentsData.students);
      setDurations(Object.fromEntries(statisticsData.statistics.student_durations.map((item) => [item.student_id, item.total_duration])));
      setSelectedIds([]);
      resetSelectionAnchor();
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }

      toastError(nextError, '加载学生列表失败。');
    }
  }

  useEffect(() => {
    if (!token) return;
    void loadData();
  }, [token]);

  const sortedStudents = useMemo(() => {
    return [...students].sort((left, right) => {
      const leftDuration = durations[left.id] ?? 0;
      const rightDuration = durations[right.id] ?? 0;
      if (sortBy === 'duration-desc') return rightDuration - leftDuration || left.name.localeCompare(right.name);
      if (sortBy === 'duration-asc') return leftDuration - rightDuration || left.name.localeCompare(right.name);
      if (sortBy === 'uid-desc') return right.uid.localeCompare(left.uid);
      if (sortBy === 'uid-asc') return left.uid.localeCompare(right.uid);
      if (sortBy === 'name-desc') return right.name.localeCompare(left.name);
      return left.name.localeCompare(right.name);
    });
  }, [durations, sortBy, students]);
  const sortedStudentIds = useMemo(() => sortedStudents.map((student) => student.id), [sortedStudents]);
  const selectedStudentIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const columns = useMemo<Array<ColumnDef<StudentSummary>>>(() => [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={sortedStudents.length > 0 && selectedIds.length === sortedStudents.length}
          onCheckedChange={(checked) => setSelectedIds(checked ? sortedStudentIds : [])}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selectedStudentIdSet.has(row.original.id)}
          onClick={captureShiftKey}
          onCheckedChange={(checked) =>
            setSelectedIds((current) =>
              updateSelection(
                sortedStudentIds,
                current,
                row.original.id,
                checked === true
              )
            )
          }
        />
      )
    },
    {
      accessorKey: 'uid',
      header: () => (
        <SortButton
          active={sortBy === 'uid-asc' || sortBy === 'uid-desc'}
          descending={sortBy === 'uid-desc'}
          label="UID"
          onClick={() => setSortBy((current) => current === 'uid-asc' ? 'uid-desc' : 'uid-asc')}
        />
      )
    },
    {
      accessorKey: 'name',
      header: () => (
        <SortButton
          active={sortBy === 'name-asc' || sortBy === 'name-desc'}
          descending={sortBy === 'name-desc'}
          label="姓名"
          onClick={() => setSortBy((current) => current === 'name-asc' ? 'name-desc' : 'name-asc')}
        />
      ),
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>
    },
    {
      id: 'duration',
      header: () => (
        <SortButton
          active={sortBy === 'duration-desc' || sortBy === 'duration-asc'}
          descending={sortBy === 'duration-desc'}
          label="总时长"
          onClick={() => setSortBy((current) => current === 'duration-desc' ? 'duration-asc' : 'duration-desc')}
        />
      ),
      cell: ({ row }) => `${formatDuration(durations[row.original.id] ?? 0)} h`
    },
    {
      accessorKey: 'created_at',
      header: '创建时间',
      cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.created_at)}</span>
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(row.original);
            setForm({ name: row.original.name, password: '' });
          }}
        >
          <UserRoundCog className="size-4" />
          编辑
        </Button>
      )
    }
  ], [captureShiftKey, durations, selectedIds.length, selectedStudentIdSet, sortBy, sortedStudentIds, sortedStudents.length, updateSelection]);

  return (
    <PageFrame title="学生列表" description="教师可以查看学生总时长，支持批量重置密码，并按总时长或姓名排序。">
      <Card>
        <CardHeader>
          <CardTitle>学生列表</CardTitle>
          <CardDescription>这里只展示已分配给当前教师的学生，总时长仅统计已通过记录。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {selectedIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-100 p-3">
                <p className="mr-2 text-sm text-muted-foreground">已选 {selectedIds.length} 人</p>
                <Button size="sm" onClick={() => setBatchResetOpen(true)}>重置密码</Button>
              </div>
            ) : <div />}
            <FilterSelect
              label="排序"
              value={sortBy}
              options={[
                { label: '总时长从高到低', value: 'duration-desc' },
                { label: '总时长从低到高', value: 'duration-asc' },
                { label: 'UID 从小到大', value: 'uid-asc' },
                { label: 'UID 从大到小', value: 'uid-desc' },
                { label: '姓名 A-Z', value: 'name-asc' },
                { label: '姓名 Z-A', value: 'name-desc' }
              ]}
              onChange={(value) => setSortBy(value as typeof sortBy)}
            />
          </div>
          {sortedStudents.length === 0 ? (
            <EmptyState title="暂无学生" description="管理员分配学生后，这里会自动显示。" />
          ) : (
            <DataTable batchSize={60} columns={columns} data={sortedStudents} />
          )}
          {resetResult.length > 0 ? (
            <UserCredentialsResult
              autoDownload
              users={resetResult}
              filename="reset_teacher_students.csv"
              summary={`成功重置 ${resetResult.length} 个学生的密码。`}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑学生信息</DialogTitle>
            <DialogDescription>密码留空表示不修改。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="姓名"><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
            <Field label="新密码"><Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></Field>
            <Button
              onClick={async () => {
                if (!token || !editing) return;
                try {
                  await unwrapResponse(
                    createApiClient(token).teacher.students({ id: editing.id }).put({
                      name: form.name.trim(),
                      password: form.password
                    })
                  );
                  setEditing(null);
                  toastSuccess('学生信息已保存。');
                  await loadData();
                } catch (nextError) {
                  if (nextError instanceof ApiResponseError && nextError.status === 401) {
                    signOut();
                    return;
                  }
                  toastError(nextError, '更新失败。');
                }
              }}
            >
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={batchResetOpen}
        onOpenChange={setBatchResetOpen}
        title="确认重置密码"
        description={`将重置当前选中的 ${selectedIds.length} 个学生密码，并下载包含新密码的 CSV 文件。`}
        confirmLabel="重置密码"
        loading={resetLoading}
        onConfirm={async () => {
          if (!token) return;

          try {
            setResetLoading(true);
            const data = await unwrapResponse<{ message: string; users: CreatedUser[] }>(
              createApiClient(token).teacher.students.password.patch({ ids: selectedIds })
            );
            setBatchResetOpen(false);
            setResetResult(data.users);
            toastSuccess(`已重置 ${data.users.length} 个学生的密码。`);
          } catch (nextError) {
            if (nextError instanceof ApiResponseError && nextError.status === 401) {
              signOut();
              return;
            }
            toastError(nextError, '重置失败。');
          } finally {
            setResetLoading(false);
          }
        }}
      />
    </PageFrame>
  );
}

export function AccountSettingsPage({ allowNameChange }: { allowNameChange: boolean }) {
  return <AccountCard title="账号信息" allowNameChange={allowNameChange} />;
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

const FilterSelect = memo(function FilterSelect({
  label,
  value,
  options,
  loading = false,
  onOpen,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  loading?: boolean;
  onOpen?: () => void;
  onChange: (value: string) => void;
}) {
  const resolvedValue = value || '__all__';
  const [open, setOpen] = useState(false);

  return (
    <Field label={label}>
      <Select
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            onOpen?.();
          }
        }}
        value={resolvedValue}
        onValueChange={(nextValue) => onChange(nextValue === '__all__' ? '' : nextValue)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {loading ? (
            <SelectItem disabled value="__loading__">加载中...</SelectItem>
          ) : options.length > 0 ? (
            options.map((option) => (
              <SelectItem key={option.value || option.label} value={option.value || '__all__'}>
                {option.label}
              </SelectItem>
            ))
          ) : (
            <SelectItem disabled value="__empty__">暂无可选项</SelectItem>
          )}
        </SelectContent>
      </Select>
    </Field>
  );
});

function RecordPreview({ record }: { record: TeacherRecord }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={record.status} />
        <Badge variant="secondary">{formatDate(record.practice_date)}</Badge>
        <Badge variant="secondary">{formatDuration(record.duration)} h</Badge>
        {record.location ? <Badge variant="outline">{record.location}</Badge> : null}
      </div>
      <div className="rounded-xl bg-muted/40 p-4 text-sm leading-7 text-muted-foreground">
        {record.content}
      </div>
      {record.image_path ? (
        <AuthenticatedImage
          className="max-h-72 w-full rounded-2xl object-cover"
          placeholderClassName="flex min-h-52 w-full items-center justify-center rounded-2xl bg-muted/40"
          src={record.image_path}
          alt={record.title}
        />
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'approved' ? 'default' : status === 'rejected' ? 'destructive' : 'outline'}>{statusLabel(status)}</Badge>;
}

function SortButton({
  active,
  descending,
  label,
  onClick
}: {
  active: boolean;
  descending: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="inline-flex items-center gap-1 font-medium" type="button" onClick={onClick}>
      {label}
      {active ? descending ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" /> : null}
    </button>
  );
}
