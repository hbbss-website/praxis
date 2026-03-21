import { ArrowDown, ArrowUp, BarChart3, CheckCheck, FilePenLine, LoaderCircle, Search, UserRoundCog, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useSession } from '@/lib/auth';
import { DatePickerField } from '@/shared/date-picker-field';
import { EmptyState } from '@/shared/empty-state';
import { StatCard } from '@/shared/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest, ApiResponseError, getApiOrigin } from '@/lib/api';
import { formatDate, formatDateTime, formatDuration, statusLabel } from '@/lib/format';
import type { StudentSummary, TeacherRecord, TeacherStatistics, UserSummary } from '@/lib/types';
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
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [records, setRecords] = useState<TeacherRecord[]>([]);
  const [statistics, setStatistics] = useState<TeacherStatistics | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [reviewRecord, setReviewRecord] = useState<TeacherRecord | null>(null);
  const [editRecord, setEditRecord] = useState<TeacherRecord | null>(null);
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

  const allSelected = records.length > 0 && selectedIds.length === records.length;
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
    if (!token) return;
    try {
      const data = await apiRequest<{ students: StudentSummary[] }>('/teacher/students', {}, token);
      setStudents(data.students);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    }
  }

  async function loadTeachers() {
    if (!token || user?.role !== 'admin') return;
    try {
      const data = await apiRequest<{ users: UserSummary[] }>('/admin/users?role=teacher', {}, token);
      setTeachers(data.users);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    }
  }

  async function loadRecords() {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ records: TeacherRecord[] }>(`/teacher/records${query ? `?${query}` : ''}`, {}, token);
      setRecords(data.records);
      setSelectedIds([]);
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
      const data = await apiRequest<{ statistics: TeacherStatistics }>('/teacher/statistics', {}, token);
      setStatistics(data.statistics);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    void loadStudents();
  }, [token]);

  useEffect(() => {
    void loadTeachers();
  }, [token, user?.role]);

  useEffect(() => {
    void loadRecords();
  }, [query, token]);

  useEffect(() => {
    void loadStatistics();
  }, [token]);

  return (
    <PageFrame
      title={user?.role === 'admin' ? '记录管理' : '审核中心'}
      description={user?.role === 'admin' ? '管理员可以查看并审核全部实践记录，支持按学生、实践日期、上传日期和状态筛选，以及批量处理。' : '保留原有审核、编辑、删除和批量处理逻辑，支持按学生、实践日期和上传日期筛选。'}
      action={<Button variant="secondary" onClick={() => { void loadRecords(); void loadStatistics(); }}><Search className="size-4" />刷新数据</Button>}
    >
      {statistics ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="记录总数" value={String(statistics.total_records)} hint="当前可见范围内的全部记录" icon={FilePenLine} />
          <StatCard title="待审核" value={String(statistics.pending_count)} hint="需要尽快处理" icon={CheckCheck} />
          <StatCard title="已通过" value={String(statistics.approved_count)} hint="通过后计入时长" icon={BarChart3} />
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
                  options={[{ label: '全部老师', value: '' }, ...teachers.map((teacher) => ({ label: `${teacher.name} (${teacher.uid})`, value: String(teacher.id) }))]}
                  onChange={(value) => setFilters((current) => ({ ...current, teacher_id: value }))}
                />
              ) : null}
              <FilterSelect
                label="学生"
                value={filters.student_id}
                options={[{ label: '全部学生', value: '' }, ...students.map((student) => ({ label: `${student.name} (${student.uid})`, value: String(student.id) }))]}
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
                <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`确定删除 ${selectedIds.length} 条记录吗？`)) void runBatchAction('deleted'); }}>批量删除</Button>
              </div>
            ) : null}

            {loading ? (
              <LoadingCard label="正在加载记录列表..." />
            ) : error ? (
              <ErrorCard message={error} onRetry={() => void loadRecords()} />
            ) : records.length === 0 ? (
              <EmptyState title="暂无记录" description="当前筛选条件下没有找到对应的实践记录。" />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-12"><Checkbox checked={allSelected} onCheckedChange={(checked) => setSelectedIds(checked ? records.map((record) => record.id) : [])} /></TableHead>
                      <TableHead>学生</TableHead>
                      <TableHead>标题</TableHead>
                      <TableHead>实践日期</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>上传日期</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                      {records.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.includes(record.id)}
                              onCheckedChange={(checked) =>
                                setSelectedIds((current) =>
                                  checked ? [...current, record.id] : current.filter((item) => item !== record.id)
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{record.student_name}</p>
                            <p className="text-xs text-muted-foreground">{record.student_uid}</p>
                          </TableCell>
                          <TableCell>{record.title}</TableCell>
                          <TableCell>{formatDate(record.practice_date)}</TableCell>
                          <TableCell><StatusBadge status={record.status} /></TableCell>
                          <TableCell className="text-muted-foreground">{formatDateTime(record.created_at)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => void openReview(record.id)}>审核</Button>
                              <Button size="sm" variant="outline" onClick={() => void openEdit(record.id)}>编辑</Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  if (!window.confirm('确定删除这条记录吗？')) return;
                                  void deleteRecord(record.id);
                                }}
                              >
                                删除
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
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

      <Dialog open={Boolean(editRecord)} onOpenChange={(open) => !open && setEditRecord(null)}>
        <DialogContent>
          {editRecord ? (
            <>
              <DialogHeader>
                <DialogTitle>编辑记录</DialogTitle>
                <DialogDescription>保留原有教师端编辑逻辑。</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Field label="标题"><Input value={editForm.title} onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))} /></Field>
                <Field label="内容"><Textarea value={editForm.content} onChange={(event) => setEditForm((current) => ({ ...current, content: event.target.value }))} /></Field>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="日期"><DatePickerField value={editForm.practice_date} onChange={(value) => setEditForm((current) => ({ ...current, practice_date: value }))} /></Field>
                  <Field label="时长"><Input type="number" step="0.1" min="0.1" value={editForm.duration} onChange={(event) => setEditForm((current) => ({ ...current, duration: event.target.value }))} /></Field>
                  <Field label="地点"><Input value={editForm.location} onChange={(event) => setEditForm((current) => ({ ...current, location: event.target.value }))} /></Field>
                </div>
                <Button onClick={() => void saveEdit()}>保存修改</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageFrame>
  );

  async function openReview(recordId: number) {
    if (!token) return;
    try {
      const data = await apiRequest<{ record: TeacherRecord }>(`/teacher/records/${recordId}`, {}, token);
      setReviewRecord(data.record);
      setReviewComment(data.record.teacher_comment ?? '');
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      window.alert(nextError instanceof Error ? nextError.message : '加载记录详情失败。');
    }
  }

  async function openEdit(recordId: number) {
    if (!token) return;
    try {
      const data = await apiRequest<{ record: TeacherRecord }>(`/teacher/records/${recordId}`, {}, token);
      setEditRecord(data.record);
      setEditForm({
        title: data.record.title,
        content: data.record.content,
        practice_date: data.record.practice_date.split('T')[0] ?? data.record.practice_date,
        duration: String(data.record.duration ?? ''),
        location: data.record.location ?? ''
      });
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      window.alert(nextError instanceof Error ? nextError.message : '加载记录详情失败。');
    }
  }

  async function submitReview(status: 'approved' | 'rejected' | 'pending') {
    if (!token || !reviewRecord) return;
    try {
      await apiRequest(
        `/teacher/records/${reviewRecord.id}/review`,
        { method: 'PUT', body: JSON.stringify({ status, comment: reviewComment.trim() }) },
        token
      );
      setReviewRecord(null);
      setReviewComment('');
      await Promise.all([loadRecords(), loadStatistics()]);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      window.alert(nextError instanceof Error ? nextError.message : '保存审核结果失败。');
    }
  }

  async function runBatchAction(action: 'approved' | 'rejected' | 'pending' | 'deleted') {
    if (!token) return;
    try {
      await apiRequest(
        '/teacher/records/batch-review',
        { method: 'POST', body: JSON.stringify({ ids: selectedIds, action }) },
        token
      );
      await Promise.all([loadRecords(), loadStatistics()]);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      window.alert(nextError instanceof Error ? nextError.message : '批量操作失败。');
    }
  }

  async function saveEdit() {
    if (!token || !editRecord) return;
    try {
      await apiRequest(
        `/teacher/records/${editRecord.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            title: editForm.title.trim(),
            content: editForm.content.trim(),
            practice_date: editForm.practice_date,
            duration: editForm.duration,
            location: editForm.location.trim() || null
          })
        },
        token
      );
      setEditRecord(null);
      await loadRecords();
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      window.alert(nextError instanceof Error ? nextError.message : '保存修改失败。');
    }
  }

  async function deleteRecord(recordId: number) {
    if (!token) return;
    try {
      await apiRequest(`/teacher/records/${recordId}`, { method: 'DELETE' }, token);
      await Promise.all([loadRecords(), loadStatistics()]);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      window.alert(nextError instanceof Error ? nextError.message : '删除失败。');
    }
  }
}

export function TeacherStudentsPage() {
  const { token, signOut } = useSession();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [sortBy, setSortBy] = useState<'duration-desc' | 'duration-asc' | 'uid-asc' | 'uid-desc' | 'name-asc' | 'name-desc'>('duration-desc');
  const [editing, setEditing] = useState<StudentSummary | null>(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [error, setError] = useState('');

  async function loadStudents() {
    if (!token) return;
    try {
      const data = await apiRequest<{ students: StudentSummary[] }>('/teacher/students', {}, token);
      setStudents(data.students);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    }
  }

  async function loadDurations() {
    if (!token) return;
    try {
      const data = await apiRequest<{ statistics: TeacherStatistics }>('/teacher/statistics', {}, token);
      setDurations(Object.fromEntries(data.statistics.student_durations.map((item) => [item.student_id, item.total_duration])));
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    }
  }

  useEffect(() => {
    void loadStudents();
    void loadDurations();
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

  return (
    <PageFrame title="学生管理" description="教师可以查看学生总时长，并按总时长或姓名排序。">
      <Card>
        <CardHeader>
          <CardTitle>学生列表</CardTitle>
          <CardDescription>这里只展示已分配给当前教师的学生，总时长仅统计已通过记录。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
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
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>
                      <SortButton
                        active={sortBy === 'uid-asc' || sortBy === 'uid-desc'}
                        descending={sortBy === 'uid-desc'}
                        label="UID"
                        onClick={() => setSortBy((current) => current === 'uid-asc' ? 'uid-desc' : 'uid-asc')}
                      />
                    </TableHead>
                    <TableHead>
                      <SortButton
                        active={sortBy === 'name-asc' || sortBy === 'name-desc'}
                        descending={sortBy === 'name-desc'}
                        label="姓名"
                        onClick={() => setSortBy((current) => current === 'name-asc' ? 'name-desc' : 'name-asc')}
                      />
                    </TableHead>
                    <TableHead>
                      <SortButton
                        active={sortBy === 'duration-desc' || sortBy === 'duration-asc'}
                        descending={sortBy === 'duration-desc'}
                        label="总时长"
                        onClick={() => setSortBy((current) => current === 'duration-desc' ? 'duration-asc' : 'duration-desc')}
                      />
                    </TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedStudents.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>{student.uid}</TableCell>
                        <TableCell className="font-medium">{student.name}</TableCell>
                        <TableCell>{formatDuration(durations[student.id] ?? 0)} h</TableCell>
                        <TableCell className="text-muted-foreground">{formatDateTime(student.created_at)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditing(student);
                              setForm({ name: student.name, password: '' });
                            }}
                          >
                            <UserRoundCog className="size-4" />
                            编辑
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
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
            {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
            <Button
              onClick={async () => {
                if (!token || !editing) return;
                setError('');
                try {
                  await apiRequest(
                    `/teacher/students/${editing.id}`,
                    { method: 'PUT', body: JSON.stringify({ name: form.name.trim(), password: form.password }) },
                    token
                  );
                  setEditing(null);
                  await loadStudents();
                } catch (nextError) {
                  if (nextError instanceof ApiResponseError && nextError.status === 401) {
                    signOut();
                    return;
                  }
                  setError(nextError instanceof Error ? nextError.message : '更新失败。');
                }
              }}
            >
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
        <LoaderCircle className="size-4 animate-spin" />
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

function FilterSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  const resolvedValue = value || '__all__';

  return (
    <Field label={label}>
      <Select value={resolvedValue} onValueChange={(nextValue) => onChange(nextValue === '__all__' ? '' : nextValue)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value || option.label} value={option.value || '__all__'}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

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
        <img className="max-h-72 w-full rounded-2xl object-cover" src={`${getApiOrigin()}${record.image_path}`} alt={record.title} />
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
