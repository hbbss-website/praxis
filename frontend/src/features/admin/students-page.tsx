import { ArrowDown, ArrowUp, ChevronDown, FileUp, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  useComboboxAnchor
} from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth';
import { ApiResponseError, createApiClient, importUserCsv, unwrapResponse, validatePlainPassword } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDateTime, formatDuration } from '@/lib/format';
import { useRuntimeConfig } from '@/lib/runtime-config';
import { useShiftMultiSelect } from '@/lib/shift-selection';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { ClassAssignments, ClassSummary, CreatedUser, CreatedUserPayload, CreatedUsersPayload, CsvImportEntry, CsvImportPreview, StudentSummary, StudentWithClassSummary, TeacherStatistics, UserRole, UserSummary } from '@/lib/types';
import { includesSearch, ListSearchBar, type ListSearchState } from '@/shared/list-search-bar';
import { UserCredentialsResult } from '@/shared/user-credentials-result';
import { AdminPageFrame, compareStudentClass, Field, formatStudentClass, SelectClass, SortButton, type CredentialsResult } from './shared';

type StudentSearchField = 'name' | 'uid';
const studentSearchOptions = [
  { label: '姓名', value: 'name' },
  { label: 'UID', value: 'uid' }
] satisfies Array<{ label: string; value: StudentSearchField }>;
const defaultStudentSearch: ListSearchState<StudentSearchField> = { field: 'name', query: '' };

export function AdminStudentsPage() {
  return <AdminStudentListPage />;
}


function AdminStudentListPage() {
  const { signOut } = useSession();
  const runtimeConfig = useRuntimeConfig();
  const { captureShiftKey, resetSelectionAnchor, updateSelection } = useShiftMultiSelect();
  const [students, setStudents] = useState<StudentWithClassSummary[]>([]);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [sortBy, setSortBy] = useState<'duration-desc' | 'duration-asc' | 'uid-asc' | 'uid-desc' | 'name-asc' | 'name-desc' | 'class-asc' | 'class-desc'>('duration-desc');
  const [searchDraft, setSearchDraft] = useState<ListSearchState<StudentSearchField>>(defaultStudentSearch);
  const [search, setSearch] = useState<ListSearchState<StudentSearchField>>(defaultStudentSearch);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<StudentWithClassSummary | null>(null);
  const [form, setForm] = useState({ name: '', password: '', class_id: null as number | null });
  const [batchClassId, setBatchClassId] = useState<number | null>(null);
  const [batchResetOpen, setBatchResetOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<CredentialsResult | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentWithClassSummary | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function reload() {
    try {
      const api = createApiClient();
      const [studentsData, statisticsData, classesData] = await Promise.all([
        unwrapResponse<{ students: StudentWithClassSummary[] }>(api.teacher.students.get()),
        unwrapResponse<{ statistics: TeacherStatistics }>(api.teacher.statistics.get()),
        unwrapResponse<{ classes: ClassSummary[] }>(api.admin.classes.get())
      ]);

      setStudents(studentsData.students);
      setClasses(classesData.classes);
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
    void reload();
  }, []);

  const searchedStudents = useMemo(() => {
    const query = search.query.trim();
    if (!query) return students;

    return students.filter((student) => includesSearch(search.field === 'uid' ? student.uid : student.name, query));
  }, [search, students]);

  const sortedStudents = useMemo(() => {
    return [...searchedStudents].sort((left, right) => {
      const leftDuration = durations[left.id] ?? 0;
      const rightDuration = durations[right.id] ?? 0;
      if (sortBy === 'duration-desc') return rightDuration - leftDuration || left.name.localeCompare(right.name);
      if (sortBy === 'duration-asc') return leftDuration - rightDuration || left.name.localeCompare(right.name);
      if (sortBy === 'uid-desc') return right.uid.localeCompare(left.uid);
      if (sortBy === 'uid-asc') return left.uid.localeCompare(right.uid);
      if (sortBy === 'class-asc') return compareStudentClass(left, right, 'asc');
      if (sortBy === 'class-desc') return compareStudentClass(left, right, 'desc');
      if (sortBy === 'name-desc') return right.name.localeCompare(left.name);
      return left.name.localeCompare(right.name);
    });
  }, [durations, searchedStudents, sortBy]);

  const studentIds = useMemo(() => sortedStudents.map((student) => student.id), [sortedStudents]);
  const selectedStudentIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = sortedStudents.length > 0 && selectedIds.length === sortedStudents.length;

  const columns = useMemo<Array<ColumnDef<StudentWithClassSummary>>>(() => [
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
          checked={selectedStudentIdSet.has(row.original.id)}
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
      id: 'class',
      header: () => (
        <SortButton
          active={sortBy === 'class-asc' || sortBy === 'class-desc'}
          descending={sortBy === 'class-desc'}
          label="班级"
          onClick={() => setSortBy((current) => current === 'class-asc' ? 'class-desc' : 'class-asc')}
        />
      ),
      cell: ({ row }) => formatStudentClass(row.original)
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
              setForm({ name: row.original.name, password: '', class_id: row.original.class_id });
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
  ], [allSelected, captureShiftKey, durations, selectedStudentIdSet, sortBy, studentIds, updateSelection]);

  return (
    <AdminPageFrame title="学生列表" description="管理员可以维护学生姓名和密码，支持批量重置密码、批量删除，并按总时长查看排序。">
      <Card>
        <CardHeader>
          <CardTitle>学生列表</CardTitle>
          <CardDescription>总时长仅统计已通过记录。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {selectedIds.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-100 p-3">
                  <p className="mr-2 text-sm text-muted-foreground">已选 {selectedIds.length} 人</p>
                  <Button size="sm" onClick={() => setBatchResetOpen(true)}>重置密码</Button>
                  <Select value={batchClassId ? String(batchClassId) : '__none__'} onValueChange={(value) => setBatchClassId(value === '__none__' ? null : Number(value))}>
                    <SelectTrigger className="h-8 w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">未分配班级</SelectItem>
                      {classes.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name} ({item.cid})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => void updateSelectedClass()}>批量改班级</Button>
                  <Button size="sm" variant="destructive" onClick={() => setBatchDeleteOpen(true)}>删除</Button>
                </div>
              ) : null}
              <ListSearchBar
                value={searchDraft}
                options={studentSearchOptions}
                placeholder={searchDraft.field === 'uid' ? '搜索 UID' : '搜索姓名'}
                onChange={setSearchDraft}
                onSearch={() => {
                  setSearch({ field: searchDraft.field, query: searchDraft.query.trim() });
                  setSelectedIds([]);
                  resetSelectionAnchor();
                }}
              />
            </div>

            <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="duration-desc">总时长从高到低</SelectItem>
                <SelectItem value="duration-asc">总时长从低到高</SelectItem>
                <SelectItem value="uid-asc">UID 从小到大</SelectItem>
                <SelectItem value="uid-desc">UID 从大到小</SelectItem>
                <SelectItem value="class-asc">班级 CID 从小到大</SelectItem>
                <SelectItem value="class-desc">班级 CID 从大到小</SelectItem>
                <SelectItem value="name-asc">姓名 A-Z</SelectItem>
                <SelectItem value="name-desc">姓名 Z-A</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DataTable columns={columns} data={sortedStudents} pagination={{ pageSize: 60 }} />
          {resetResult ? (
            <UserCredentialsResult
              autoDownload
              users={resetResult.users}
              credentialsCsv={resetResult.credentialsCsv}
              filename="reset_students.csv"
              summary={`成功重置 ${resetResult.users.length} 个学生的密码。`}
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
            <SelectClass classes={classes} value={form.class_id} onChange={(class_id) => setForm((current) => ({ ...current, class_id }))} />
            <Button
              onClick={async () => {
                if (!editing) return;

                try {
                  const passwordError = form.password ? validatePlainPassword(form.password, runtimeConfig) : null;

                  if (passwordError) {
                    toastError(new Error(passwordError));
                    return;
                  }

                  await unwrapResponse(createApiClient().admin.users({ id: editing.id }).put({
                    name: form.name.trim(),
                    password: form.password,
                    class_id: form.class_id
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
          try {
            setResetLoading(true);
            const data = await unwrapResponse<CreatedUsersPayload>(
              createApiClient().admin.users.password.patch({ ids: selectedIds })
            );
            setBatchResetOpen(false);
            setResetResult({ users: data.users, credentialsCsv: data.credentialsCsv });
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
          if (!deleteTarget) return;

          try {
            setDeleteLoading(true);
            await unwrapResponse(createApiClient().admin.users({ id: deleteTarget.id }).delete());
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
          try {
            setDeleteLoading(true);
            await unwrapResponse(createApiClient().admin.users.delete({ ids: selectedIds }));
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

  async function updateSelectedClass() {
    if (selectedIds.length === 0) return;

    try {
      await unwrapResponse(createApiClient().admin.students.class.patch({ ids: selectedIds, class_id: batchClassId }));
      toastSuccess('班级已更新。');
      await reload();
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) {
        signOut();
        return;
      }

      toastError(error, '更新失败。');
    }
  }
}
