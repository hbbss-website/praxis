import { ArrowDown, ArrowUp, FileUp, Plus, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth';
import { ApiResponseError, createApiClient, importUserCsv, unwrapResponse } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDateTime, formatDuration } from '@/lib/format';
import { useShiftMultiSelect } from '@/lib/shift-selection';
import type { Assignment, CreatedUser, CsvImportEntry, CsvImportPreview, StudentSummary, TeacherStatistics, UserRole, UserSummary } from '@/lib/types';
import { EmptyState } from '@/shared/empty-state';
import { UserCredentialsResult } from '@/shared/user-credentials-result';

function AdminPageFrame({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function AdminUsersPage() {
  const { token, signOut } = useSession();
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
  const [singleForm, setSingleForm] = useState({ name: '', role: 'student' as UserRole, teacher_uid: '' });
  const [singleResult, setSingleResult] = useState<CreatedUser | null>(null);
  const [csvFileName, setCsvFileName] = useState('');
  const [csvEncoding, setCsvEncoding] = useState<CsvImportPreview['encoding'] | null>(null);
  const [csvResult, setCsvResult] = useState<CreatedUser[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [batchEntries, setBatchEntries] = useState([{ name: '', role: 'student' as UserRole, teacher_uid: '' }]);
  const [batchResult, setBatchResult] = useState<CreatedUser[]>([]);

  useEffect(() => {
    if (!token) return;

    unwrapResponse<{ users: UserSummary[] }>(createApiClient(token).admin.users.get({ query: { role: 'teacher' } }))
      .then((data) => setTeachers(data.users))
      .catch((error) => {
        if (error instanceof ApiResponseError && error.status === 401) {
          signOut();
          return;
        }

        toastError(error, '加载教师列表失败。');
      });
  }, [signOut, token]);

  return (
    <AdminPageFrame title="用户创建" description="管理员可以单个创建、批量填写或导入 CSV 创建账号，并下载生成结果。">
      <Tabs defaultValue="single">
        <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-3">
          <TabsTrigger value="single">单个创建</TabsTrigger>
          <TabsTrigger value="csv">CSV 导入</TabsTrigger>
          <TabsTrigger value="batch">批量填写</TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>单个创建</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="姓名">
                  <Input value={singleForm.name} onChange={(event) => setSingleForm((current) => ({ ...current, name: event.target.value }))} />
                </Field>
                <SelectRole value={singleForm.role} onChange={(role) => setSingleForm((current) => ({ ...current, role }))} />
                <Field label="管理老师 UID">
                  <Input
                    value={singleForm.teacher_uid}
                    disabled={singleForm.role !== 'student'}
                    onChange={(event) => setSingleForm((current) => ({ ...current, teacher_uid: event.target.value }))}
                    placeholder="仅学生可填写"
                  />
                </Field>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={async () => {
                    if (!token) return;

                    try {
                      const data = await unwrapResponse<{ message: string; user: CreatedUser }>(createApiClient(token).admin.users.post(singleForm));
                      setSingleResult(data.user);
                      toastSuccess('账号创建成功。');
                    } catch (error) {
                      if (error instanceof ApiResponseError && error.status === 401) {
                        signOut();
                        return;
                      }

                      toastError(error, '创建失败。');
                    }
                  }}
                >
                  <UserPlus className="size-4" />
                  创建账号
                </Button>
              </div>
              {singleResult ? <UserCredentialsResult users={[singleResult]} filename="created_user.csv" summary="成功生成 1 个账号。" /> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="csv" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle>CSV 导入</CardTitle>
                  <CardDescription>不包含表头，格式参见<CsvImportExampleDialog />。支持 UTF-8、UTF-16 和 GBK 编码。</CardDescription>
                </div>
                <CsvImportExampleDialog />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={csvInputRef}
                className="hidden"
                type="file"
                accept=".csv,text/csv"
                onChange={async (event) => {
                  if (!token) return;

                  const file = event.target.files?.[0];
                  if (!file) return;

                  setCsvResult([]);
                  setCsvFileName('');
                  setCsvEncoding(null);

                  if (file.size > 50 * 1024 * 1024) {
                    toastError(new Error('CSV 文件不能超过 50 MiB。'));
                    event.currentTarget.value = '';
                    return;
                  }

                  if (!file.name.toLowerCase().endsWith('.csv')) {
                    toastError(new Error('请上传 .csv 文件。'));
                    event.currentTarget.value = '';
                    return;
                  }

                  try {
                    setCsvImporting(true);
                    const data = await importUserCsv(file, token);
                    setCsvResult(data.users);
                    setCsvFileName(file.name);
                    setCsvEncoding(data.encoding);
                    toastSuccess(`成功导入 ${data.users.length} 个账号。`);
                  } catch (error) {
                    if (error instanceof ApiResponseError && error.status === 401) {
                      signOut();
                      return;
                    }

                    toastError(error, '导入失败。');
                  } finally {
                    setCsvImporting(false);
                    event.currentTarget.value = '';
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={csvImporting} onClick={() => csvInputRef.current?.click()}>
                  {csvImporting ? <Spinner className="size-4 text-current" /> : <FileUp className="size-4" />}
                  {csvImporting ? '导入中...' : '选择 CSV 并导入'}
                </Button>
                {csvFileName ? (
                  <p className="text-sm text-muted-foreground">
                    最近导入：{csvFileName}{csvEncoding ? ` · ${formatCsvEncoding(csvEncoding)}` : ''}
                  </p>
                ) : null}
              </div>
              {csvResult.length ? <UserCredentialsResult users={csvResult} filename="imported_users.csv" summary={`成功生成 ${csvResult.length} 个账号。`} /> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batch" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>批量填写</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {batchEntries.map((entry, index) => (
                  <div key={`${index}-${entry.role}`} className="grid gap-3 rounded-xl bg-muted/40 p-4 md:grid-cols-[1.2fr_1fr_1fr_auto]">
                    <Input
                      value={entry.name}
                      onChange={(event) =>
                        setBatchEntries((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)
                        )
                      }
                      placeholder="姓名"
                    />
                    <Select
                      value={entry.role}
                      onValueChange={(value) =>
                        setBatchEntries((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, role: value as UserRole, teacher_uid: value === 'student' ? item.teacher_uid : '' }
                              : item
                          )
                        )
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="student">学生</SelectItem>
                        <SelectItem value="teacher">教师</SelectItem>
                        <SelectItem value="admin">管理员</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={entry.teacher_uid}
                      disabled={entry.role !== 'student'}
                      onChange={(event) =>
                        setBatchEntries((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, teacher_uid: event.target.value } : item)
                        )
                      }
                      placeholder="管理老师 UID"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setBatchEntries((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => setBatchEntries((current) => [...current, { name: '', role: 'student', teacher_uid: '' }])}>
                  <Plus className="size-4" />
                  新增一行
                </Button>
                <Button
                  onClick={async () => {
                    if (!token) return;

                    const entries = batchEntries.filter((entry) => entry.name.trim());
                    if (entries.length === 0) {
                      toastError(new Error('请至少填写一条有效记录。'));
                      return;
                    }

                    try {
                      const data = await unwrapResponse<{ message: string; users: CreatedUser[] }>(createApiClient(token).admin.users.batch.post({ entries }));
                      setBatchResult(data.users);
                      toastSuccess(`成功创建 ${data.users.length} 个账号。`);
                    } catch (error) {
                      if (error instanceof ApiResponseError && error.status === 401) {
                        signOut();
                        return;
                      }

                      toastError(error, '批量创建失败。');
                    }
                  }}
                >
                  批量创建
                </Button>
              </div>
              {batchResult.length ? <UserCredentialsResult users={batchResult} filename="batch_created_users.csv" summary={`成功生成 ${batchResult.length} 个账号。`} /> : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminPageFrame>
  );
}

export function AdminAssignmentsPage() {
  const { token, signOut } = useSession();
  const { captureShiftKey, resetSelectionAnchor, updateSelection } = useShiftMultiSelect();
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [targetTeacherId, setTargetTeacherId] = useState('');
  const [filterTeacherId, setFilterTeacherId] = useState('__all__');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  async function loadData() {
    if (!token) return;

    try {
      const data = await unwrapResponse<{ assignments: Assignment[]; teachers: UserSummary[]; students: StudentSummary[] }>(createApiClient(token).admin.assignments.get());
      setAssignments(data.assignments);
      setTeachers(data.teachers);
      setStudents(data.students);
      setSelectedIds([]);
      resetSelectionAnchor();
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) {
        signOut();
        return;
      }

      toastError(error, '加载分配关系失败。');
    }
  }

  useEffect(() => {
    void loadData();
  }, [token]);

  const teacherMap = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher])), [teachers]);
  const assignmentMap = useMemo(() => new Map(assignments.map((assignment) => [assignment.student_id, assignment.teacher_id])), [assignments]);
  const filteredStudents = useMemo(() => {
    if (filterTeacherId === '__all__') {
      return students;
    }

    if (filterTeacherId === '__unassigned__') {
      return students.filter((student) => !assignmentMap.has(student.id));
    }

    return students.filter((student) => assignmentMap.get(student.id) === Number(filterTeacherId));
  }, [assignmentMap, filterTeacherId, students]);

  const tableStudentIds = filteredStudents.map((student) => student.id);
  const allSelected = filteredStudents.length > 0 && filteredStudents.every((student) => selectedIds.includes(student.id));

  const columns = useMemo<Array<ColumnDef<StudentSummary>>>(() => [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => {
            setSelectedIds((current) => {
              if (checked !== true) {
                return current.filter((id) => !tableStudentIds.includes(id));
              }

              return Array.from(new Set([...current, ...tableStudentIds]));
            });
          }}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIds.includes(row.original.id)}
          onClick={captureShiftKey}
          onCheckedChange={(checked) =>
            setSelectedIds((current) => {
              const currentVisible = current.filter((id) => tableStudentIds.includes(id));
              const nextVisible = updateSelection(
                tableStudentIds,
                currentVisible,
                row.original.id,
                checked === true
              );

              return [...current.filter((id) => !tableStudentIds.includes(id)), ...nextVisible];
            })
          }
        />
      )
    },
    {
      accessorKey: 'uid',
      header: 'UID'
    },
    {
      accessorKey: 'name',
      header: '姓名',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>
    },
    {
      accessorKey: 'created_at',
      header: '创建时间',
      cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.created_at)}</span>
    },
    {
      id: 'teacher',
      header: '当前教师',
      cell: ({ row }) => {
        const assignedTeacher = teacherMap.get(assignmentMap.get(row.original.id) ?? -1);
        return assignedTeacher ? `${assignedTeacher.name} (${assignedTeacher.uid})` : <span className="text-muted-foreground">未分配</span>;
      }
    }
  ], [allSelected, assignmentMap, captureShiftKey, selectedIds, tableStudentIds, teacherMap, updateSelection]);

  return (
    <AdminPageFrame title="关系分配" description="管理员可以把学生批量分配给教师，或者撤销现有分配关系。">
      <Card>
        <CardHeader>
          <CardTitle>教师与学生</CardTitle>
          <CardDescription>每个学生同一时间只属于一个教师。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(240px,320px)_minmax(240px,320px)_auto_auto] xl:items-end">
            <Field label="按老师筛选">
              <Select value={filterTeacherId} onValueChange={setFilterTeacherId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择筛选范围" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部老师</SelectItem>
                  <SelectItem value="__unassigned__">未分配</SelectItem>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={String(teacher.id)}>
                      {teacher.name} ({teacher.uid})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="操作教师">
              <Select value={targetTeacherId || '__none__'} onValueChange={(value) => setTargetTeacherId(value === '__none__' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择目标教师" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">请选择教师</SelectItem>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={String(teacher.id)}>
                      {teacher.name} ({teacher.uid})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Button onClick={() => void updateAssignments('POST')}>分配给教师</Button>
            <Button variant="outline" onClick={() => void updateAssignments('DELETE')}>取消分配</Button>
          </div>

          {filteredStudents.length === 0 ? (
            <EmptyState title="暂无学生" description="当前筛选条件下没有可显示的学生。" />
          ) : (
            <DataTable batchSize={60} columns={columns} data={filteredStudents} />
          )}
        </CardContent>
      </Card>
    </AdminPageFrame>
  );

  async function updateAssignments(method: 'POST' | 'DELETE') {
    if (!token) return;

    if (!targetTeacherId) {
      toastError(new Error('请选择操作教师。'));
      return;
    }

    if (selectedIds.length === 0) {
      toastError(new Error('请至少选择一个学生。'));
      return;
    }

    try {
      const api = createApiClient(token);

      if (method === 'POST') {
        await unwrapResponse(api.admin.assignments.post({ teacher_id: Number(targetTeacherId), student_ids: selectedIds }));
        toastSuccess('分配关系已更新。');
      } else {
        await unwrapResponse(api.admin.assignments.delete({ teacher_id: Number(targetTeacherId), student_ids: selectedIds }));
        toastSuccess('已取消选中学生的分配关系。');
      }

      await loadData();
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) {
        signOut();
        return;
      }

      toastError(error, '操作失败。');
    }
  }
}

export function AdminStudentsPage() {
  return <AdminStudentListPage />;
}

export function AdminTeachersPage() {
  return <UserListPage role="teacher" title="教师列表" description="管理员可以维护教师信息，并清理无效账号。" />;
}

function UserListPage({
  role,
  title,
  description
}: {
  role: 'student' | 'teacher';
  title: string;
  description: string;
}) {
  const { token, signOut } = useSession();
  const { captureShiftKey, resetSelectionAnchor, updateSelection } = useShiftMultiSelect();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [sortBy, setSortBy] = useState<'uid-asc' | 'uid-desc' | 'name-asc' | 'name-desc'>('uid-asc');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [batchResetOpen, setBatchResetOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<CreatedUser[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function loadUsers() {
    if (!token) return;

    try {
      const data = await unwrapResponse<{ users: UserSummary[] }>(createApiClient(token).admin.users.get({ query: { role } }));
      setUsers(data.users);
      setSelectedIds([]);
      resetSelectionAnchor();
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) {
        signOut();
        return;
      }

      toastError(error, '加载账号列表失败。');
    }
  }

  useEffect(() => {
    void loadUsers();
  }, [role, token]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((left, right) => {
      if (sortBy === 'uid-desc') return right.uid.localeCompare(left.uid);
      if (sortBy === 'name-asc') return left.name.localeCompare(right.name);
      if (sortBy === 'name-desc') return right.name.localeCompare(left.name);
      return left.uid.localeCompare(right.uid);
    });
  }, [sortBy, users]);

  const userIds = sortedUsers.map((user) => user.id);
  const allSelected = sortedUsers.length > 0 && selectedIds.length === sortedUsers.length;

  const columns = useMemo<Array<ColumnDef<UserSummary>>>(() => [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => setSelectedIds(checked ? userIds : [])}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIds.includes(row.original.id)}
          onClick={captureShiftKey}
          onCheckedChange={(checked) =>
            setSelectedIds((current) =>
              updateSelection(userIds, current, row.original.id, checked === true)
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
      accessorKey: 'created_at',
      header: '创建时间',
      cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.created_at)}</span>
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(row.original);
              setForm({ name: row.original.name, password: '' });
            }}
          >
            编辑
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(row.original)}>
            删除
          </Button>
        </div>
      )
    }
  ], [allSelected, captureShiftKey, selectedIds, sortBy, updateSelection, userIds]);

  return (
    <AdminPageFrame title={title} description={description}>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {selectedIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-100 p-3">
                <p className="mr-2 text-sm text-muted-foreground">已选 {selectedIds.length} 人</p>
                <Button size="sm" onClick={() => setBatchResetOpen(true)}>重置密码</Button>
                <Button size="sm" variant="destructive" onClick={() => setBatchDeleteOpen(true)}>删除</Button>
              </div>
            ) : <div />}
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="uid-asc">UID 从小到大</SelectItem>
                <SelectItem value="uid-desc">UID 从大到小</SelectItem>
                <SelectItem value="name-asc">姓名 A-Z</SelectItem>
                <SelectItem value="name-desc">姓名 Z-A</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sortedUsers.length === 0 ? (
            <EmptyState title="暂无账号" description="在用户创建页添加账号后，这里会同步显示。" />
          ) : (
            <DataTable columns={columns} data={sortedUsers} />
          )}
          {resetResult.length > 0 ? (
            <UserCredentialsResult
              autoDownload
              users={resetResult}
              filename="reset_teachers.csv"
              summary={`成功重置 ${resetResult.length} 个教师的密码。`}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑账号</DialogTitle>
            <DialogDescription>密码留空表示不修改。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="姓名">
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="新密码">
              <Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
            </Field>
            <Button
              onClick={async () => {
                if (!token || !editing) return;

                try {
                  await unwrapResponse(createApiClient(token).admin.users({ id: editing.id }).put({
                    name: form.name.trim(),
                    password: form.password
                  }));
                  setEditing(null);
                  toastSuccess('账号信息已保存。');
                  await loadUsers();
                } catch (error) {
                  if (error instanceof ApiResponseError && error.status === 401) {
                    signOut();
                    return;
                  }

                  toastError(error, '更新失败。');
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
        description={`将重置当前选中的 ${selectedIds.length} 个教师密码，并下载包含新密码的 CSV 文件。`}
        confirmLabel="重置密码"
        loading={resetLoading}
        onConfirm={async () => {
          if (!token) return;

          try {
            setResetLoading(true);
            const data = await unwrapResponse<{ message: string; users: CreatedUser[] }>(
              createApiClient(token).admin.users.password.patch({ ids: selectedIds })
            );
            setBatchResetOpen(false);
            setResetResult(data.users);
            toastSuccess(`已重置 ${data.users.length} 个教师的密码。`);
          } catch (error) {
            if (error instanceof ApiResponseError && error.status === 401) {
              signOut();
              return;
            }

            toastError(error, '重置失败。');
          } finally {
            setResetLoading(false);
          }
        }}
      />

      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="确认删除账号"
        description={deleteTarget ? `将删除 ${deleteTarget.name}（${deleteTarget.uid}）账号，删除后不可恢复。` : ''}
        confirmLabel="删除"
        loading={deleteLoading}
        variant="destructive"
        onConfirm={async () => {
          if (!token || !deleteTarget) return;

          try {
            setDeleteLoading(true);
            await unwrapResponse(createApiClient(token).admin.users({ id: deleteTarget.id }).delete());
            setDeleteTarget(null);
            toastSuccess('账号已删除。');
            await loadUsers();
          } catch (error) {
            if (error instanceof ApiResponseError && error.status === 401) {
              signOut();
              return;
            }

            toastError(error, '删除失败。');
          } finally {
            setDeleteLoading(false);
          }
        }}
      />

      <ConfirmActionDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title="确认批量删除教师账号"
        description={`将删除当前选中的 ${selectedIds.length} 个教师账号，删除后不可恢复。`}
        confirmLabel="删除"
        loading={deleteLoading}
        variant="destructive"
        onConfirm={async () => {
          if (!token) return;

          try {
            setDeleteLoading(true);
            await unwrapResponse(createApiClient(token).admin.users.delete({ ids: selectedIds }));
            setBatchDeleteOpen(false);
            toastSuccess(`已删除 ${selectedIds.length} 个教师账号。`);
            await loadUsers();
          } catch (error) {
            if (error instanceof ApiResponseError && error.status === 401) {
              signOut();
              return;
            }

            toastError(error, '删除失败。');
          } finally {
            setDeleteLoading(false);
          }
        }}
      />
    </AdminPageFrame>
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

function SelectRole({ value, onChange }: { value: UserRole; onChange: (role: UserRole) => void }) {
  return (
    <Field label="角色">
      <Select value={value} onValueChange={(nextValue) => onChange(nextValue as UserRole)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="student">学生</SelectItem>
          <SelectItem value="teacher">教师</SelectItem>
          <SelectItem value="admin">管理员</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function AdminStudentListPage() {
  const { token, signOut } = useSession();
  const { captureShiftKey, resetSelectionAnchor, updateSelection } = useShiftMultiSelect();
  const [students, setStudents] = useState<UserSummary[]>([]);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [sortBy, setSortBy] = useState<'duration-desc' | 'duration-asc' | 'uid-asc' | 'uid-desc' | 'name-asc' | 'name-desc'>('duration-desc');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [batchResetOpen, setBatchResetOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<CreatedUser[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function reload() {
    if (!token) return;

    try {
      const [usersData, statisticsData] = await Promise.all([
        unwrapResponse<{ users: UserSummary[] }>(createApiClient(token).admin.users.get({ query: { role: 'student' } })),
        unwrapResponse<{ statistics: TeacherStatistics }>(createApiClient(token).teacher.statistics.get())
      ]);

      setStudents(usersData.users);
      setDurations(Object.fromEntries(statisticsData.statistics.student_durations.map((item) => [item.student_id, item.total_duration])));
      setSelectedIds([]);
      resetSelectionAnchor();
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) {
        signOut();
        return;
      }

      toastError(error, '加载学生列表失败。');
    }
  }

  useEffect(() => {
    if (!token) return;
    void reload();
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

  const studentIds = sortedStudents.map((student) => student.id);
  const allSelected = sortedStudents.length > 0 && selectedIds.length === sortedStudents.length;

  const columns = useMemo<Array<ColumnDef<UserSummary>>>(() => [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => setSelectedIds(checked ? studentIds : [])}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIds.includes(row.original.id)}
          onClick={captureShiftKey}
          onCheckedChange={(checked) =>
            setSelectedIds((current) =>
              updateSelection(studentIds, current, row.original.id, checked === true)
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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(row.original);
              setForm({ name: row.original.name, password: '' });
            }}
          >
            编辑
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(row.original)}>
            删除
          </Button>
        </div>
      )
    }
  ], [allSelected, captureShiftKey, durations, selectedIds, sortBy, studentIds, updateSelection]);

  return (
    <AdminPageFrame title="学生列表" description="管理员可以维护学生姓名和密码，支持批量重置密码、批量删除，并按总时长查看排序。">
      <Card>
        <CardHeader>
          <CardTitle>学生列表</CardTitle>
          <CardDescription>总时长仅统计已通过记录。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {selectedIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-100 p-3">
                <p className="mr-2 text-sm text-muted-foreground">已选 {selectedIds.length} 人</p>
                <Button size="sm" onClick={() => setBatchResetOpen(true)}>重置密码</Button>
                <Button size="sm" variant="destructive" onClick={() => setBatchDeleteOpen(true)}>删除</Button>
              </div>
            ) : <div />}

            <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="duration-desc">总时长从高到低</SelectItem>
                <SelectItem value="duration-asc">总时长从低到高</SelectItem>
                <SelectItem value="uid-asc">UID 从小到大</SelectItem>
                <SelectItem value="uid-desc">UID 从大到小</SelectItem>
                <SelectItem value="name-asc">姓名 A-Z</SelectItem>
                <SelectItem value="name-desc">姓名 Z-A</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sortedStudents.length === 0 ? (
            <EmptyState title="暂无账号" description="在用户创建页添加学生账号后，这里会同步显示。" />
          ) : (
            <DataTable batchSize={60} columns={columns} data={sortedStudents} />
          )}
          {resetResult.length > 0 ? (
            <UserCredentialsResult
              autoDownload
              users={resetResult}
              filename="reset_students.csv"
              summary={`成功重置 ${resetResult.length} 个学生的密码。`}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑账号</DialogTitle>
            <DialogDescription>密码留空表示不修改。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="姓名">
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="新密码">
              <Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
            </Field>
            <Button
              onClick={async () => {
                if (!token || !editing) return;

                try {
                  await unwrapResponse(createApiClient(token).admin.users({ id: editing.id }).put({
                    name: form.name.trim(),
                    password: form.password
                  }));
                  setEditing(null);
                  toastSuccess('学生信息已保存。');
                  await reload();
                } catch (error) {
                  if (error instanceof ApiResponseError && error.status === 401) {
                    signOut();
                    return;
                  }

                  toastError(error, '更新失败。');
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
              createApiClient(token).admin.users.password.patch({ ids: selectedIds })
            );
            setBatchResetOpen(false);
            setResetResult(data.users);
            toastSuccess(`已重置 ${data.users.length} 个学生的密码。`);
          } catch (error) {
            if (error instanceof ApiResponseError && error.status === 401) {
              signOut();
              return;
            }

            toastError(error, '重置失败。');
          } finally {
            setResetLoading(false);
          }
        }}
      />

      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="确认删除学生账号"
        description={deleteTarget ? `将删除 ${deleteTarget.name}（${deleteTarget.uid}）账号，删除后不可恢复。` : ''}
        confirmLabel="删除"
        loading={deleteLoading}
        variant="destructive"
        onConfirm={async () => {
          if (!token || !deleteTarget) return;

          try {
            setDeleteLoading(true);
            await unwrapResponse(createApiClient(token).admin.users({ id: deleteTarget.id }).delete());
            setDeleteTarget(null);
            toastSuccess('学生账号已删除。');
            await reload();
          } catch (error) {
            if (error instanceof ApiResponseError && error.status === 401) {
              signOut();
              return;
            }

            toastError(error, '删除失败。');
          } finally {
            setDeleteLoading(false);
          }
        }}
      />

      <ConfirmActionDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title="确认批量删除学生账号"
        description={`将删除当前选中的 ${selectedIds.length} 个学生账号，删除后不可恢复。`}
        confirmLabel="批量删除"
        loading={deleteLoading}
        variant="destructive"
        onConfirm={async () => {
          if (!token) return;

          try {
            setDeleteLoading(true);
            await unwrapResponse(createApiClient(token).admin.users.delete({ ids: selectedIds }));
            setBatchDeleteOpen(false);
            toastSuccess(`已删除 ${selectedIds.length} 个学生账号。`);
            await reload();
          } catch (error) {
            if (error instanceof ApiResponseError && error.status === 401) {
              signOut();
              return;
            }

            toastError(error, '批量删除失败。');
          } finally {
            setDeleteLoading(false);
          }
        }}
      />
    </AdminPageFrame>
  );
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

const CSV_IMPORT_EXAMPLE_ROWS: CsvImportEntry[] = [
  { lineNumber: 1, name: '小奶龙', role: 'student', teacher_uid: 'T00001' },
  { lineNumber: 2, name: '大奶龙', role: 'teacher', teacher_uid: '' },
  { lineNumber: 3, name: '超级奶龙', role: 'admin', teacher_uid: '' }
];

function CsvImportExampleDialog() {
  const columns = useMemo<Array<ColumnDef<CsvImportEntry>>>(() => [
    { accessorKey: 'name', header: '姓名' },
    { accessorKey: 'role', header: '角色' },
    {
      accessorKey: 'teacher_uid',
      header: '管理老师 UID',
      cell: ({ row }) => row.original.teacher_uid || <span className="text-muted-foreground">留空</span>
    }
  ], []);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="h-auto p-0 text-sm" variant="link">示例</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>CSV 示例</DialogTitle>
          <DialogDescription>导入文件不包含表头。学生可填写管理老师 UID，教师和管理员最后一列留空即可。</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="source">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="source">源码</TabsTrigger>
            <TabsTrigger value="table">表格</TabsTrigger>
          </TabsList>
          <TabsContent value="source" className="mt-4">
            <pre className="overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-4 text-sm leading-6">
              {CSV_IMPORT_EXAMPLE_ROWS.map((row) => `${row.name},${row.role},${row.teacher_uid}`).join('\n')}
            </pre>
          </TabsContent>
          <TabsContent value="table" className="mt-4">
            <DataTable batchSize={10} columns={columns} data={CSV_IMPORT_EXAMPLE_ROWS} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function formatCsvEncoding(encoding: CsvImportPreview['encoding']) {
  if (encoding === 'utf-16') return 'UTF-16';
  if (encoding === 'gbk') return 'GBK';
  return 'UTF-8';
}
