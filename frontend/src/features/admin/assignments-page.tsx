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
import { ApiResponseError, createApiClient, importUserCsv, unwrapResponse } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDateTime, formatDuration } from '@/lib/format';
import { useShiftMultiSelect } from '@/lib/shift-selection';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { ClassAssignments, ClassSummary, CreatedUser, CreatedUserPayload, CreatedUsersPayload, CsvImportEntry, CsvImportPreview, StudentSummary, StudentWithClassSummary, TeacherStatistics, UserRole, UserSummary } from '@/lib/types';
import { EmptyState } from '@/shared/empty-state';
import { includesSearch, ListSearchBar, type ListSearchState } from '@/shared/list-search-bar';
import { UserCredentialsResult } from '@/shared/user-credentials-result';
import { AdminPageFrame, comboboxPageSize, Field } from './shared';

type ClassSearchField = 'name' | 'cid';
const classSearchOptions = [
  { label: '名称', value: 'name' },
  { label: 'CID', value: 'cid' }
] satisfies Array<{ label: string; value: ClassSearchField }>;
const defaultClassSearch: ListSearchState<ClassSearchField> = { field: 'name', query: '' };

export function AdminAssignmentsPage() {
  const { token, signOut } = useSession();
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
  const [students, setStudents] = useState<StudentWithClassSummary[]>([]);
  const [assignments, setAssignments] = useState<ClassAssignments>({ teachers: [], students: [] });
  const [visibleCount, setVisibleCount] = useState(comboboxPageSize);
  const [searchDraft, setSearchDraft] = useState<ListSearchState<ClassSearchField>>(defaultClassSearch);
  const [search, setSearch] = useState<ListSearchState<ClassSearchField>>(defaultClassSearch);
  const [creating, setCreating] = useState(false);
  const [editingClassId, setEditingClassId] = useState<number | null>(null);

  async function loadData() {
    if (!token) return;

    try {
      const api = createApiClient(token);
      const [assignmentData, studentData] = await Promise.all([
        unwrapResponse<{ classes: ClassSummary[]; assignments: ClassAssignments; teachers: UserSummary[] }>(api.admin.classes.get()),
        unwrapResponse<{ students: StudentWithClassSummary[] }>(api.admin.classes.students.get({ query: { scope: 'all' } }))
      ]);
      setClasses(assignmentData.classes);
      setAssignments(assignmentData.assignments);
      setTeachers(assignmentData.teachers);
      setStudents(studentData.students);
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
  const classTeacherMap = useMemo(() => {
    const next = new Map<number, number[]>();

    for (const assignment of assignments.teachers) {
      next.set(assignment.class_id, [...(next.get(assignment.class_id) ?? []), assignment.teacher_id]);
    }

    return next;
  }, [assignments.teachers]);
  const classStudentMap = useMemo(() => {
    const next = new Map<number, StudentWithClassSummary[]>();

    for (const student of students) {
      if (!student.class_id) continue;
      next.set(student.class_id, [...(next.get(student.class_id) ?? []), student]);
    }

    return next;
  }, [students]);
  const searchedClasses = useMemo(() => {
    const query = search.query.trim();
    if (!query) return classes;

    return classes.filter((item) => includesSearch(search.field === 'cid' ? item.cid : item.name, query));
  }, [classes, search]);
  const visibleClasses = useMemo(() => searchedClasses.slice(0, visibleCount), [searchedClasses, visibleCount]);

  function loadMoreClasses(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;

    if (element.scrollTop + element.clientHeight < element.scrollHeight - 48) {
      return;
    }

    setVisibleCount((current) => Math.min(current + comboboxPageSize, searchedClasses.length));
  }

  return (
    <AdminPageFrame title="班级管理" description="管理员可以创建班级，并维护每个班级的教师和学生。">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListSearchBar
          value={searchDraft}
          options={classSearchOptions}
          placeholder={searchDraft.field === 'cid' ? '搜索 CID' : '搜索名称'}
          onChange={setSearchDraft}
          onSearch={() => {
            setSearch({ field: searchDraft.field, query: searchDraft.query.trim() });
            setVisibleCount(comboboxPageSize);
          }}
        />
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          添加班级
        </Button>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-4xl">
          <ClassEditorCard
            mode="create"
            teachers={teachers}
            token={token}
            signOut={signOut}
            onCancel={() => setCreating(false)}
            onSave={async (name, teacherIds, studentIds) => {
              if (!token) return;

              const data = await unwrapResponse<{ class: ClassSummary }>(createApiClient(token).admin.classes.post({ name }));
              if (teacherIds.length > 0) {
                await unwrapResponse(createApiClient(token).admin.classes.assignTeachers({ class_id: data.class.id, teacher_ids: teacherIds }));
              }
              if (studentIds.length > 0) {
                await unwrapResponse(createApiClient(token).admin.classes.assignStudents({ class_id: data.class.id, student_ids: studentIds }));
              }
              setCreating(false);
              toastSuccess('班级已创建。');
              await loadData();
            }}
          />
        </DialogContent>
      </Dialog>

      <div className="max-h-[calc(100vh-220px)] space-y-4 overflow-y-auto pr-1" onScroll={loadMoreClasses}>
        {visibleClasses.length === 0 && !creating ? (
          <EmptyState title={classes.length === 0 ? '暂无班级' : '没有匹配的班级'} description={classes.length === 0 ? '点击添加班级创建第一个班级。' : '调整搜索条件后再试。'} />
        ) : null}

        {visibleClasses.map((item) => {
          const teacherIds = classTeacherMap.get(item.id) ?? [];
          const classTeachers = teacherIds.map((id) => teacherMap.get(id)).filter((teacher): teacher is UserSummary => Boolean(teacher));
          const classStudents = classStudentMap.get(item.id) ?? [];

          return (
            <div key={item.id}>
              <ClassSummaryCard
                classItem={item}
                teachers={classTeachers}
                students={classStudents}
                onEdit={() => setEditingClassId(item.id)}
              />
              <Dialog open={editingClassId === item.id} onOpenChange={(open) => setEditingClassId(open ? item.id : null)}>
                <DialogContent className="sm:max-w-4xl">
                  <ClassEditorCard
                    mode="edit"
                    classItem={item}
                    teachers={teachers}
                    teacherIds={teacherIds}
                    students={classStudents}
                    token={token}
                    signOut={signOut}
                    onCancel={() => setEditingClassId(null)}
                    onSave={async (name, nextTeacherIds, nextStudentIds) => {
                      if (!token) return;

                      const api = createApiClient(token);
                      const currentTeacherSet = new Set(teacherIds);
                      const nextTeacherSet = new Set(nextTeacherIds);
                      const addTeacherIds = nextTeacherIds.filter((id) => !currentTeacherSet.has(id));
                      const removeTeacherIds = teacherIds.filter((id) => !nextTeacherSet.has(id));
                      const currentStudentIds = classStudents.map((student) => student.id);
                      const currentStudentSet = new Set(currentStudentIds);
                      const nextStudentSet = new Set(nextStudentIds);
                      const addStudentIds = nextStudentIds.filter((id) => !currentStudentSet.has(id));
                      const removeStudentIds = currentStudentIds.filter((id) => !nextStudentSet.has(id));

                      await unwrapResponse(api.admin.classes(item.id).put({ name }));
                      if (addTeacherIds.length > 0) {
                        await unwrapResponse(api.admin.classes.assignTeachers({ class_id: item.id, teacher_ids: addTeacherIds }));
                      }
                      if (removeTeacherIds.length > 0) {
                        await unwrapResponse(api.admin.classes.removeTeachers({ class_id: item.id, teacher_ids: removeTeacherIds }));
                      }
                      if (addStudentIds.length > 0) {
                        await unwrapResponse(api.admin.classes.assignStudents({ class_id: item.id, student_ids: addStudentIds }));
                      }
                      if (removeStudentIds.length > 0) {
                        await unwrapResponse(api.admin.classes.removeStudents({ class_id: item.id, student_ids: removeStudentIds }));
                      }
                      setEditingClassId(null);
                      toastSuccess('班级信息已保存。');
                      await loadData();
                    }}
                  />
                </DialogContent>
              </Dialog>
            </div>
          );
        })}
      </div>
    </AdminPageFrame>
  );
}


function ClassSummaryCard({
  classItem,
  teachers,
  students,
  onEdit
}: {
  classItem: ClassSummary;
  teachers: UserSummary[];
  students: StudentWithClassSummary[];
  onEdit: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{classItem.name}</CardTitle>
            <CardDescription>{classItem.cid}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-4" />
            编辑
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium">教师</p>
          <CompactNameList emptyText="未分配教师" items={teachers.map((teacher) => `${teacher.name} (${teacher.uid})`)} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">学生</p>
          <CompactNameList emptyText="未分配学生" items={students.map((student) => `${student.name} (${student.uid})`)} />
        </div>
      </CardContent>
    </Card>
  );
}

function CompactNameList({ items, emptyText }: { items: string[]; emptyText: string }) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const visibleItems = expanded ? items : items.slice(0, 12);

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleItems.map((item) => (
        <span key={item} className="rounded-md bg-muted px-2 py-1 text-xs">
          {item}
        </span>
      ))}
      {!expanded && items.length > 12 ? (
        <button
          type="button"
          className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => setExpanded(true)}
          aria-label="展开全部"
        >
          <ChevronDown className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ClassEditorCard({
  mode,
  classItem,
  teachers,
  teacherIds = [],
  students = [],
  token,
  signOut,
  onCancel,
  onSave
}: {
  mode: 'create' | 'edit';
  classItem?: ClassSummary;
  teachers: UserSummary[];
  teacherIds?: number[];
  students?: StudentWithClassSummary[];
  token: string | null;
  signOut: () => void;
  onCancel: () => void;
  onSave: (name: string, teacherIds: number[], studentIds: number[]) => Promise<void>;
}) {
  const [name, setName] = useState(classItem?.name ?? '');
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<number[]>(teacherIds);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>(students.map((student) => student.id));
  const [saving, setSaving] = useState(false);

  async function save() {
    const normalizedName = name.trim();

    if (!normalizedName) {
      toastError(new Error('请输入班级名称。'));
      return;
    }

    try {
      setSaving(true);
      await onSave(normalizedName, selectedTeacherIds, selectedStudentIds);
    } catch (error) {
      toastError(error, mode === 'create' ? '创建失败。' : '保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle>{mode === 'create' ? '添加班级' : `编辑 ${classItem?.cid ?? ''}`}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(180px,260px)_minmax(240px,1fr)_minmax(240px,1fr)]">
        <Field label="班级名称">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <TeacherMultiSelect teachers={teachers} value={selectedTeacherIds} onChange={setSelectedTeacherIds} />
        <ClassStudentMultiSelect classId={classItem?.id ?? null} token={token} signOut={signOut} initialStudents={students} value={selectedStudentIds} onChange={setSelectedStudentIds} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner className="size-4 text-current" /> : null}
          保存
        </Button>
        <Button disabled={saving} variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

function TeacherMultiSelect({
  teachers,
  value,
  onChange
}: {
  teachers: UserSummary[];
  value: number[];
  onChange: (value: number[]) => void;
}) {
  const anchorRef = useComboboxAnchor();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const [selectedTeacherMap, setSelectedTeacherMap] = useState(() => new Map(teachers.map((teacher) => [teacher.id, teacher])));
  const [visibleCount, setVisibleCount] = useState(comboboxPageSize);
  const matchedTeachers = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return teachers;
    }

    return teachers.filter((teacher) =>
      teacher.name.toLowerCase().includes(normalizedQuery) ||
      teacher.uid.toLowerCase().includes(normalizedQuery)
    );
  }, [debouncedQuery, teachers]);
  const selectedTeachers = useMemo(
    () => value.map((id) => selectedTeacherMap.get(id)).filter((teacher): teacher is UserSummary => Boolean(teacher)),
    [selectedTeacherMap, value]
  );
  const visibleTeachers = useMemo(() => matchedTeachers.slice(0, visibleCount), [matchedTeachers, visibleCount]);

  useEffect(() => {
    setSelectedTeacherMap((current) => {
      const next = new Map(current);
      for (const teacher of teachers) {
        next.set(teacher.id, teacher);
      }
      return next;
    });
  }, [teachers]);

  useEffect(() => {
    setVisibleCount(comboboxPageSize);
  }, [debouncedQuery, matchedTeachers]);

  function loadMoreTeachers(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;

    if (element.scrollTop + element.clientHeight < element.scrollHeight - 24) {
      return;
    }

    setVisibleCount((current) => Math.min(current + comboboxPageSize, matchedTeachers.length));
  }

  return (
    <Field label="教师">
      <Combobox
        multiple
        items={matchedTeachers}
        inputValue={query}
        value={selectedTeachers}
        onInputValueChange={setQuery}
        filter={null}
        onValueChange={(nextValue) => {
          setSelectedTeacherMap((current) => {
            const next = new Map(current);
            for (const teacher of nextValue) {
              next.set(teacher.id, teacher);
            }
            return next;
          });
          onChange(nextValue.map((teacher) => teacher.id));
        }}
        itemToStringLabel={(teacher) => `${teacher.name} ${teacher.uid}`}
        itemToStringValue={(teacher) => String(teacher.id)}
        isItemEqualToValue={(item, selected) => item.id === selected.id}
      >
        <ComboboxChips ref={anchorRef} className="min-h-9 w-full">
          {selectedTeachers.map((teacher) => (
            <ComboboxChip key={teacher.id}>{teacher.name} ({teacher.uid})</ComboboxChip>
          ))}
          <ComboboxChipsInput placeholder={selectedTeachers.length > 0 ? '' : '筛选教师'} />
          {selectedTeachers.length > 0 ? (
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange([])}>
              <X className="size-3" />
            </Button>
          ) : null}
        </ComboboxChips>
        <ComboboxContent anchor={anchorRef} className="max-h-80">
          <ComboboxEmpty>暂无教师</ComboboxEmpty>
          <ComboboxList onScroll={loadMoreTeachers}>
            <ComboboxGroup items={visibleTeachers}>
              <ComboboxCollection>
                {(teacher: UserSummary) => (
                  <ComboboxItem key={teacher.id} value={teacher}>
                    {teacher.name} ({teacher.uid})
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}

function ClassStudentMultiSelect({
  classId,
  token,
  signOut,
  initialStudents,
  value,
  onChange
}: {
  classId: number | null;
  token: string | null;
  signOut: () => void;
  initialStudents: StudentWithClassSummary[];
  value: number[];
  onChange: (value: number[]) => void;
}) {
  const anchorRef = useComboboxAnchor();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const [students, setStudents] = useState<StudentWithClassSummary[]>(initialStudents);
  const [selectedStudentMap, setSelectedStudentMap] = useState(() => new Map(initialStudents.map((student) => [student.id, student])));
  const [visibleCount, setVisibleCount] = useState(comboboxPageSize);
  const [loading, setLoading] = useState(false);
  const selectedStudents = useMemo(
    () => value.map((id) => selectedStudentMap.get(id)).filter((student): student is StudentWithClassSummary => Boolean(student)),
    [selectedStudentMap, value]
  );
  const visibleStudents = useMemo(() => students.slice(0, visibleCount), [students, visibleCount]);

  useEffect(() => {
    let cancelled = false;

    async function loadMatchedStudents() {
      if (!token) return;
      setLoading(true);
      try {
        const data = await unwrapResponse<{ students: StudentWithClassSummary[] }>(
          createApiClient(token).admin.classes.students.get({
            query: {
              q: debouncedQuery.trim() || undefined,
              class_id: classId ? String(classId) : undefined
            }
          })
        );

        if (cancelled) return;

        setStudents(data.students);
        setSelectedStudentMap((current) => {
          const next = new Map(current);
          for (const student of data.students) {
            next.set(student.id, student);
          }
          return next;
        });
      } catch (error) {
        if (error instanceof ApiResponseError && error.status === 401) signOut();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMatchedStudents();

    return () => {
      cancelled = true;
    };
  }, [classId, debouncedQuery, signOut, token]);

  useEffect(() => {
    setVisibleCount(comboboxPageSize);
  }, [debouncedQuery, students]);

  function loadMoreStudents(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;

    if (element.scrollTop + element.clientHeight < element.scrollHeight - 24) {
      return;
    }

    setVisibleCount((current) => Math.min(current + comboboxPageSize, students.length));
  }

  return (
    <Field label="学生">
      <Combobox
        multiple
        items={students}
        inputValue={query}
        value={selectedStudents}
        onInputValueChange={setQuery}
        filter={null}
        onValueChange={(nextValue) => {
          setSelectedStudentMap((current) => {
            const next = new Map(current);
            for (const student of nextValue) {
              next.set(student.id, student);
            }
            return next;
          });
          onChange(nextValue.map((student) => student.id));
        }}
        itemToStringLabel={(student) => `${student.name} ${student.uid}`}
        itemToStringValue={(student) => String(student.id)}
        isItemEqualToValue={(item, selected) => item.id === selected.id}
      >
        <ComboboxChips ref={anchorRef} className="min-h-9 w-full">
          {selectedStudents.map((student) => (
            <ComboboxChip key={student.id}>{student.name} ({student.uid})</ComboboxChip>
          ))}
          <ComboboxChipsInput placeholder={selectedStudents.length > 0 ? '' : 'UID / 姓名'} />
          {selectedStudents.length > 0 ? (
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange([])}>
              <X className="size-3" />
            </Button>
          ) : null}
        </ComboboxChips>
        <ComboboxContent anchor={anchorRef} className="max-h-80">
          <ComboboxEmpty>暂无学生</ComboboxEmpty>
          {loading && students.length === 0 ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">加载中...</div>
          ) : (
            <ComboboxList onScroll={loadMoreStudents}>
              <ComboboxGroup items={visibleStudents}>
                <ComboboxCollection>
                  {(student: StudentWithClassSummary) => (
                    <ComboboxItem key={student.id} value={student}>
                      {student.name} ({student.uid})
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            </ComboboxList>
          )}
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}

function AssignmentStudentFilter({
  token,
  signOut,
  value,
  onChange
}: {
  token: string | null;
  signOut: () => void;
  value: number[];
  onChange: (value: number[], selectedStudents: StudentWithClassSummary[]) => void;
}) {
  const anchorRef = useComboboxAnchor();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const [students, setStudents] = useState<StudentWithClassSummary[]>([]);
  const [selectedStudentMap, setSelectedStudentMap] = useState(() => new Map<number, StudentWithClassSummary>());
  const [visibleCount, setVisibleCount] = useState(comboboxPageSize);
  const [loading, setLoading] = useState(false);
  const visibleStudents = useMemo(() => students.slice(0, visibleCount), [students, visibleCount]);
  const studentGroups = useMemo(() => {
    const groupMap = new Map<string, { value: string; items: StudentWithClassSummary[] }>();

    for (const student of visibleStudents) {
      const groupKey = student.class_id ? String(student.class_id) : '__unassigned__';
      const groupLabel = student.class_id && student.class_name && student.class_cid
        ? `${student.class_name} (${student.class_cid})`
        : '未分配';
      const group = groupMap.get(groupKey) ?? { value: groupLabel, items: [] };
      group.items.push(student);
      groupMap.set(groupKey, group);
    }

    return [...groupMap.values()];
  }, [visibleStudents]);
  const selectedStudents = useMemo(
    () => value.map((id) => selectedStudentMap.get(id)).filter((student): student is StudentWithClassSummary => Boolean(student)),
    [selectedStudentMap, value]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadMatchedStudents() {
      if (!token) return;
      setLoading(true);
      try {
        const data = await unwrapResponse<{ students: StudentWithClassSummary[] }>(
          createApiClient(token).admin.classes.students.get({ query: { q: debouncedQuery.trim() || undefined } })
        );

        if (cancelled) return;

        setStudents(data.students);
        setSelectedStudentMap((current) => {
          const next = new Map(current);
          for (const student of data.students) {
            next.set(student.id, student);
          }
          return next;
        });
      } catch (error) {
        if (error instanceof ApiResponseError && error.status === 401) signOut();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMatchedStudents();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, signOut, token]);

  useEffect(() => {
    setVisibleCount(comboboxPageSize);
  }, [debouncedQuery]);

  function loadMoreStudents(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;

    if (element.scrollTop + element.clientHeight < element.scrollHeight - 24) {
      return;
    }

    setVisibleCount((current) => Math.min(current + comboboxPageSize, students.length));
  }

  return (
    <Field label="筛选学生">
      <Combobox
        multiple
        items={studentGroups}
        inputValue={query}
        value={selectedStudents}
        onInputValueChange={setQuery}
        filter={null}
        onValueChange={(nextValue) => {
          setSelectedStudentMap((current) => {
            const next = new Map(current);
            for (const student of nextValue) {
              next.set(student.id, student);
            }
            return next;
          });
          onChange(nextValue.map((student) => student.id), nextValue);
        }}
        itemToStringLabel={(item: { value?: string; name?: string; uid?: string }) => item.name && item.uid ? `${item.name} ${item.uid}` : item.value ?? ''}
        itemToStringValue={(item: { id?: number; value?: string }) => item.id ? String(item.id) : item.value ?? ''}
        isItemEqualToValue={(item: { id?: number }, selected: StudentWithClassSummary) => item.id === selected.id}
      >
        <ComboboxChips ref={anchorRef} className="min-h-9 w-full">
          {selectedStudents.map((student) => (
            <ComboboxChip key={student.id}>{student.name} ({student.uid})</ComboboxChip>
          ))}
          <ComboboxChipsInput placeholder={selectedStudents.length > 0 ? '' : 'UID / 姓名'} />
          {selectedStudents.length > 0 ? (
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange([], [])}>
              <X className="size-3" />
            </Button>
          ) : null}
        </ComboboxChips>
        <ComboboxContent anchor={anchorRef} className="max-h-80">
          <ComboboxEmpty>暂无学生</ComboboxEmpty>
          {loading && students.length === 0 ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">加载中...</div>
          ) : (
            <ComboboxList onScroll={loadMoreStudents}>
              {(group, index) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(student: StudentWithClassSummary) => (
                      <ComboboxItem key={student.id} value={student}>
                        {student.name} ({student.uid})
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                  {index < studentGroups.length - 1 && <ComboboxSeparator />}
                </ComboboxGroup>
              )}
            </ComboboxList>
          )}
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}
