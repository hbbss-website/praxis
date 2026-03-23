import { ArrowDown, ArrowUp, Download, FileUp, LoaderCircle, Plus, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useSession } from '@/lib/auth';
import { EmptyState } from '@/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiRequest, ApiResponseError, previewUserImportCsv } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { Assignment, CreatedUser, CsvImportEntry, CsvImportPreview, StudentSummary, TeacherStatistics, UserRole, UserSummary } from '@/lib/types';

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
  const [singleError, setSingleError] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvEncoding, setCsvEncoding] = useState<CsvImportPreview['encoding'] | null>(null);
  const [csvResult, setCsvResult] = useState<CreatedUser[]>([]);
  const [csvError, setCsvError] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvProgressCurrent, setCsvProgressCurrent] = useState(0);
  const [csvProgressTotal, setCsvProgressTotal] = useState(0);
  const [csvProgressStudentCount, setCsvProgressStudentCount] = useState(0);
  const [batchEntries, setBatchEntries] = useState([{ name: '', role: 'student' as UserRole, teacher_uid: '' }]);
  const [batchResult, setBatchResult] = useState<CreatedUser[]>([]);
  const [batchError, setBatchError] = useState('');

  useEffect(() => {
    if (!token) return;
    apiRequest<{ users: UserSummary[] }>('/admin/users?role=teacher', {}, token)
      .then((data) => setTeachers(data.users))
      .catch((nextError) => {
        if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
      });
  }, [token]);

  const showCsvProgress = csvImporting && csvProgressStudentCount > 10 && csvProgressTotal > 0;
  const csvProgressValue = csvProgressTotal > 0 ? Math.round((csvProgressCurrent / csvProgressTotal) * 100) : 0;

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
                <Field label="姓名"><Input value={singleForm.name} onChange={(event) => setSingleForm((current) => ({ ...current, name: event.target.value }))} /></Field>
                <SelectRole value={singleForm.role} onChange={(role) => setSingleForm((current) => ({ ...current, role }))} />
                <Field label="管理老师 UID">
                  <Input value={singleForm.teacher_uid} disabled={singleForm.role !== 'student'} onChange={(event) => setSingleForm((current) => ({ ...current, teacher_uid: event.target.value }))} placeholder="仅学生可填写" />
                </Field>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={async () => {
                    if (!token) return;
                    setSingleError('');
                    try {
                      const data = await apiRequest<{ user: CreatedUser }>('/admin/users', { method: 'POST', body: JSON.stringify(singleForm) }, token);
                      setSingleResult(data.user);
                    } catch (nextError) {
                      if (nextError instanceof ApiResponseError && nextError.status === 401) {
                        signOut();
                        return;
                      }
                      setSingleError(nextError instanceof Error ? nextError.message : '创建失败。');
                    }
                  }}
                >
                  <UserPlus className="size-4" />
                  创建账号
                </Button>
              </div>
              {singleError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{singleError}</p> : null}
              {singleResult ? <ResultTable users={[singleResult]} filename="created_user.csv" /> : null}
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

                  setCsvError('');
                  setCsvResult([]);
                  setCsvFileName('');
                  setCsvEncoding(null);
                  setCsvProgressCurrent(0);
                  setCsvProgressTotal(0);
                  setCsvProgressStudentCount(0);

                  if (file.size > 50 * 1024 * 1024) {
                    setCsvError('CSV 文件不能超过 50 MiB。');
                    event.currentTarget.value = '';
                    return;
                  }

                  if (!file.name.toLowerCase().endsWith('.csv')) {
                    setCsvError('请上传 .csv 文件。');
                    event.currentTarget.value = '';
                    return;
                  }

                  try {
                    setCsvImporting(true);
                    const preview = await previewUserImportCsv(file, token);
                    setCsvProgressTotal(preview.totalCount);
                    setCsvProgressStudentCount(preview.studentCount);
                    await importCsvEntries(preview.entries, preview, file.name, token, signOut, setCsvProgressCurrent, setCsvResult);
                    setCsvFileName(file.name);
                    setCsvEncoding(preview.encoding);
                  } catch (nextError) {
                    if (nextError instanceof ApiResponseError && nextError.status === 401) {
                      signOut();
                      return;
                    }
                    setCsvError(nextError instanceof Error ? nextError.message : '导入失败。');
                  } finally {
                    setCsvImporting(false);
                    event.currentTarget.value = '';
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={csvImporting} onClick={() => csvInputRef.current?.click()}>
                  {csvImporting ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                  {csvImporting ? '导入中...' : '选择 CSV 并导入'}
                </Button>
                {csvFileName ? (
                  <p className="text-sm text-muted-foreground">
                    最近导入：{csvFileName}{csvEncoding ? ` · ${formatCsvEncoding(csvEncoding)}` : ''}
                  </p>
                ) : null}
              </div>
              {showCsvProgress ? (
                <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">导入中 ({csvProgressCurrent}/{csvProgressTotal})</p>
                    <p className="text-xs text-muted-foreground">{csvProgressValue}%</p>
                  </div>
                  <Progress value={csvProgressValue} />
                </div>
              ) : null}
              {csvError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{csvError}</p> : null}
              {csvResult.length ? <ResultTable users={csvResult} filename="imported_users.csv" /> : null}
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
                    <Input value={entry.name} onChange={(event) => setBatchEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="姓名" />
                    <Select value={entry.role} onValueChange={(value) => setBatchEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, role: value as UserRole, teacher_uid: value === 'student' ? item.teacher_uid : '' } : item))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="student">学生</SelectItem>
                        <SelectItem value="teacher">教师</SelectItem>
                        <SelectItem value="admin">管理员</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={entry.teacher_uid} disabled={entry.role !== 'student'} onChange={(event) => setBatchEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, teacher_uid: event.target.value } : item))} placeholder="管理老师 UID" />
                    <Button variant="ghost" size="icon" onClick={() => setBatchEntries((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>
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
                    setBatchError('');
                    try {
                      const entries = batchEntries.filter((entry) => entry.name.trim());
                      const data = await apiRequest<{ users: CreatedUser[] }>('/admin/users/batch', { method: 'POST', body: JSON.stringify({ entries }) }, token);
                      setBatchResult(data.users);
                    } catch (nextError) {
                      if (nextError instanceof ApiResponseError && nextError.status === 401) {
                        signOut();
                        return;
                      }
                      setBatchError(nextError instanceof Error ? nextError.message : '批量创建失败。');
                    }
                  }}
                >
                  批量创建
                </Button>
              </div>
              {batchError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{batchError}</p> : null}
              {batchResult.length ? <ResultTable users={batchResult} filename="batch_created_users.csv" /> : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminPageFrame>
  );
}

export function AdminAssignmentsPage() {
  const { token, signOut } = useSession();
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [teacherId, setTeacherId] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  async function loadData() {
    if (!token) return;
    try {
      const data = await apiRequest<{ assignments: Assignment[]; teachers: UserSummary[]; students: StudentSummary[] }>('/admin/assignments', {}, token);
      setAssignments(data.assignments);
      setTeachers(data.teachers);
      setStudents(data.students);
      setSelectedIds([]);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
    }
  }

  useEffect(() => {
    void loadData();
  }, [token]);

  const teacherMap = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher])), [teachers]);
  const assignmentMap = useMemo(() => new Map(assignments.map((assignment) => [assignment.student_id, assignment.teacher_id])), [assignments]);

  return (
    <AdminPageFrame title="关系分配" description="管理员可以把学生批量分配给教师，或者撤销现有分配关系。">
      <Card>
        <CardHeader>
          <CardTitle>教师与学生</CardTitle>
          <CardDescription>每个学生同一时间只属于一个教师。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="教师">
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger className="min-w-64">
                  <SelectValue placeholder="选择教师" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((teacher) => <SelectItem key={teacher.id} value={String(teacher.id)}>{teacher.name} ({teacher.uid})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Button onClick={() => void updateAssignments('POST')}>分配给教师</Button>
            <Button variant="outline" onClick={() => void updateAssignments('DELETE')}>取消分配</Button>
          </div>

          {students.length === 0 ? (
            <EmptyState title="暂无学生" description="创建学生后即可在这里配置所属教师。" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox checked={students.length > 0 && selectedIds.length === students.length} onCheckedChange={(checked) => setSelectedIds(checked ? students.map((student) => student.id) : [])} />
                    </TableHead>
                    <TableHead>UID</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>当前教师</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                    {students.map((student) => {
                      const assignedTeacher = teacherMap.get(assignmentMap.get(student.id) ?? -1);
                      return (
                        <TableRow key={student.id}>
                          <TableCell>
                            <Checkbox checked={selectedIds.includes(student.id)} onCheckedChange={(checked) => setSelectedIds((current) => checked ? [...current, student.id] : current.filter((item) => item !== student.id))} />
                          </TableCell>
                          <TableCell>{student.uid}</TableCell>
                          <TableCell className="font-medium">{student.name}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDateTime(student.created_at)}</TableCell>
                          <TableCell>{assignedTeacher ? `${assignedTeacher.name} (${assignedTeacher.uid})` : <span className="text-muted-foreground">未分配</span>}</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </AdminPageFrame>
  );

  async function updateAssignments(method: 'POST' | 'DELETE') {
    if (!token || !teacherId || selectedIds.length === 0) {
      window.alert('请选择教师和至少一个学生。');
      return;
    }

    try {
      await apiRequest('/admin/assignments', { method, body: JSON.stringify({ teacher_id: Number(teacherId), student_ids: selectedIds }) }, token);
      await loadData();
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      window.alert(nextError instanceof Error ? nextError.message : '操作失败。');
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
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [sortBy, setSortBy] = useState<'uid-asc' | 'uid-desc' | 'name-asc' | 'name-desc'>('uid-asc');
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [error, setError] = useState('');

  async function loadUsers() {
    if (!token) return;
    try {
      const data = await apiRequest<{ users: UserSummary[] }>(`/admin/users?role=${role}`, {}, token);
      setUsers(data.users);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
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

  return (
    <AdminPageFrame title={title} description={description}>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
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
                    <TableHead>创建时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.uid}</TableCell>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDateTime(user.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(user);
                                setForm({ name: user.name, password: '' });
                              }}
                            >
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={async () => {
                                if (!token || !window.confirm('确定删除该账号吗？')) return;
                                try {
                                  await apiRequest(`/admin/users/${user.id}`, { method: 'DELETE' }, token);
                                  await loadUsers();
                                } catch (nextError) {
                                  if (nextError instanceof ApiResponseError && nextError.status === 401) {
                                    signOut();
                                    return;
                                  }
                                  window.alert(nextError instanceof Error ? nextError.message : '删除失败。');
                                }
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

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑账号</DialogTitle>
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
                  await apiRequest(`/admin/users/${editing.id}`, { method: 'PUT', body: JSON.stringify({ name: form.name.trim(), password: form.password }) }, token);
                  setEditing(null);
                  await loadUsers();
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
    </AdminPageFrame>
  );
}

function ResultTable({ users, filename }: { users: CreatedUser[]; filename: string }) {
  const csvData = `name,uid,role,password\n${users.map((user) => `${user.name},${user.uid},${user.role},${user.password}`).join('\n')}`;
  const downloadUrl = URL.createObjectURL(new Blob([csvData], { type: 'text/csv' }));

  return (
    <div className="space-y-4 rounded-xl bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">成功生成 {users.length} 个账号。</p>
        <Button variant="secondary" asChild>
          <a href={downloadUrl} download={filename}>
            <Download className="size-4" />
            下载 CSV
          </a>
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>姓名</TableHead>
            <TableHead>UID</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>密码</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
            {users.map((user) => (
              <TableRow key={user.uid}>
                <TableCell>{user.name}</TableCell>
                <TableCell>{user.uid}</TableCell>
                <TableCell>{user.role}</TableCell>
                <TableCell className="font-mono text-xs">{user.password}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
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
  const [students, setStudents] = useState<UserSummary[]>([]);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [sortBy, setSortBy] = useState<'duration-desc' | 'duration-asc' | 'uid-asc' | 'uid-desc' | 'name-asc' | 'name-desc'>('duration-desc');
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;

    void Promise.all([
      apiRequest<{ users: UserSummary[] }>('/admin/users?role=student', {}, token),
      apiRequest<{ statistics: TeacherStatistics }>('/teacher/statistics', {}, token)
    ])
      .then(([usersData, statisticsData]) => {
        setStudents(usersData.users);
        setDurations(Object.fromEntries(statisticsData.statistics.student_durations.map((item) => [item.student_id, item.total_duration])));
      })
      .catch((nextError) => {
        if (nextError instanceof ApiResponseError && nextError.status === 401) signOut();
      });
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

  async function reload() {
    if (!token) return;
    const usersData = await apiRequest<{ users: UserSummary[] }>('/admin/users?role=student', {}, token);
    setStudents(usersData.users);
  }

  return (
    <AdminPageFrame title="学生列表" description="管理员可以维护学生姓名和密码，并按总时长查看排序。">
      <Card>
        <CardHeader>
          <CardTitle>学生列表</CardTitle>
          <CardDescription>总时长仅统计已通过记录。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
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
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setEditing(student); setForm({ name: student.name, password: '' }); }}>
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (!token || !window.confirm('确定删除该账号吗？')) return;
                              try {
                                await apiRequest(`/admin/users/${student.id}`, { method: 'DELETE' }, token);
                                await reload();
                              } catch (nextError) {
                                if (nextError instanceof ApiResponseError && nextError.status === 401) {
                                  signOut();
                                  return;
                                }
                                window.alert(nextError instanceof Error ? nextError.message : '删除失败。');
                              }
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

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑账号</DialogTitle>
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
                  await apiRequest(`/admin/users/${editing.id}`, { method: 'PUT', body: JSON.stringify({ name: form.name.trim(), password: form.password }) }, token);
                  setEditing(null);
                  await reload();
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
            <pre className="overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-4 text-sm leading-6">{CSV_IMPORT_EXAMPLE_ROWS.map((row) => `${row.name},${row.role},${row.teacher_uid}`).join('\n')}</pre>
          </TabsContent>
          <TabsContent value="table" className="mt-4">
            <div className="overflow-hidden rounded-xl border border-border/70">
              <Table>
                {/* <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>管理老师 UID</TableHead>
                  </TableRow>
                </TableHeader> */}
                <TableBody>
                  {CSV_IMPORT_EXAMPLE_ROWS.map((row) => (
                    <TableRow key={row.lineNumber}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.role}</TableCell>
                      <TableCell>{row.teacher_uid || <span className="text-muted-foreground">留空</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

async function importCsvEntries(
  entries: CsvImportEntry[],
  preview: CsvImportPreview,
  fileName: string,
  token: string,
  signOut: () => void,
  setCsvProgressCurrent: React.Dispatch<React.SetStateAction<number>>,
  setCsvResult: React.Dispatch<React.SetStateAction<CreatedUser[]>>
) {
  const createdUsers: CreatedUser[] = [];

  setCsvProgressCurrent(0);
  setCsvResult([]);

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    try {
      const data = await apiRequest<{ user: CreatedUser }>(
        '/admin/users',
        {
          method: 'POST',
          body: JSON.stringify({
            name: entry.name,
            role: entry.role,
            teacher_uid: entry.teacher_uid
          })
        },
        token
      );

      createdUsers.push(data.user);
      setCsvResult([...createdUsers]);
      setCsvProgressCurrent(index + 1);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        throw nextError;
      }

      const message = nextError instanceof Error ? nextError.message : '导入失败。';
      throw new Error(`文件 ${fileName} 第 ${entry.lineNumber} 行导入失败：${message}`);
    }
  }

  setCsvProgressCurrent(preview.totalCount);
}

function formatCsvEncoding(encoding: CsvImportPreview['encoding']) {
  if (encoding === 'utf-16') return 'UTF-16';
  if (encoding === 'gbk') return 'GBK';
  return 'UTF-8';
}
