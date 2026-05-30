import { ArrowDown, ArrowUp, CheckCircle2, Clock3, FilePenLine, RefreshCw, UserRoundCog, Users, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { useSession } from '@/lib/auth';
import { DatePickerField } from '@/shared/date-picker-field';
import { AuthenticatedImage } from '@/shared/authenticated-image';
import { StatCard } from '@/shared/stat-card';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
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
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { ClassSummary, CreatedUser, CreatedUsersPayload, StudentSummary, StudentWithClassSummary, TeacherRecord, TeacherRecordSummary, TeacherStatistics, UserSummary } from '@/lib/types';
import { UserCredentialsResult } from '@/shared/user-credentials-result';
import { includesSearch, ListSearchBar, type ListSearchState } from '@/shared/list-search-bar';
import { compareStudentClass, Field, FilterSelect, formatStudentClass, PageFrame, SelectClass, SortButton, type CredentialsResult } from './shared';

type StudentSearchField = 'name' | 'uid';
const studentSearchOptions = [
  { label: '姓名', value: 'name' },
  { label: 'UID', value: 'uid' }
] satisfies Array<{ label: string; value: StudentSearchField }>;
const defaultStudentSearch: ListSearchState<StudentSearchField> = { field: 'name', query: '' };

export function TeacherStudentsPage() {
  const { signOut } = useSession();
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

  async function loadData() {
    try {
      const api = createApiClient();
      const [studentsData, statisticsData, classesData] = await Promise.all([
        unwrapResponse<{ students: StudentWithClassSummary[] }>(api.teacher.students.get()),
        unwrapResponse<{ statistics: TeacherStatistics }>(api.teacher.statistics.get()),
        unwrapResponse<{ classes: ClassSummary[] }>(api.admin.classes.get())
          .catch(() => ({ classes: [] }))
      ]);

      const managedClassIds = new Set(studentsData.students.map((student) => student.class_id).filter((id): id is number => Boolean(id)));
      setClasses(classesData.classes.filter((item) => managedClassIds.has(item.id)));

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
    void loadData();
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
  const sortedStudentIds = useMemo(() => sortedStudents.map((student) => student.id), [sortedStudents]);
  const selectedStudentIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const columns = useMemo<Array<ColumnDef<StudentWithClassSummary>>>(() => [
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(row.original);
            setForm({ name: row.original.name, password: '', class_id: row.original.class_id });
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
            <FilterSelect
              label="排序"
              value={sortBy}
              options={[
                { label: '总时长从高到低', value: 'duration-desc' },
                { label: '总时长从低到高', value: 'duration-asc' },
                { label: 'UID 从小到大', value: 'uid-asc' },
                { label: 'UID 从大到小', value: 'uid-desc' },
                { label: '班级 CID 从小到大', value: 'class-asc' },
                { label: '班级 CID 从大到小', value: 'class-desc' },
                { label: '姓名 A-Z', value: 'name-asc' },
                { label: '姓名 Z-A', value: 'name-desc' }
              ]}
              onChange={(value) => setSortBy(value as typeof sortBy)}
            />
          </div>
          <DataTable batchSize={60} columns={columns} data={sortedStudents} />
          {resetResult ? (
            <UserCredentialsResult
              autoDownload
              users={resetResult.users}
              credentialsCsv={resetResult.credentialsCsv}
              filename="reset_teacher_students.csv"
              summary={`成功重置 ${resetResult.users.length} 个学生的密码。`}
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
            <SelectClass classes={classes} value={form.class_id} onChange={(class_id) => setForm((current) => ({ ...current, class_id }))} />
            <Button
              onClick={async () => {
                if (!editing) return;
                try {
                  await unwrapResponse(
                    createApiClient().teacher.students({ id: editing.id }).put({
                      name: form.name.trim(),
                      password: form.password,
                      class_id: form.class_id
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
          try {
            setResetLoading(true);
            const data = await unwrapResponse<CreatedUsersPayload>(
              createApiClient().teacher.students.password.patch({ ids: selectedIds })
            );
            setBatchResetOpen(false);
            setResetResult({ users: data.users, credentialsCsv: data.credentialsCsv });
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

  async function updateSelectedClass() {
    if (selectedIds.length === 0) return;

    try {
      await unwrapResponse(createApiClient().teacher.students.class.patch({ ids: selectedIds, class_id: batchClassId }));
      toastSuccess('班级已更新。');
      await loadData();
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      toastError(nextError, '更新失败。');
    }
  }
}
