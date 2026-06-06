import { ArrowDown, ArrowUp, CheckCircle2, Clock3, FilePenLine, RefreshCw, UserRoundCog, Users, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  useComboboxPagedSearch
} from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ApiResponseError, createApiClient, unwrapResponse } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDate, formatDateTime, formatDuration, normalizeDateInputValue, statusLabel } from '@/lib/format';
import { useShiftMultiSelect } from '@/lib/shift-selection';
import type { ClassSummary, CreatedUser, CreatedUsersPayload, StudentSummary, StudentWithClassSummary, TeacherRecord, TeacherRecordSummary, TeacherStatistics, UserSummary } from '@/lib/types';
import { UserCredentialsResult } from '@/shared/user-credentials-result';

export function PageFrame({
  title,
  description,
  children,
  action
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export const defaultFilters = {
  student_ids: [] as number[],
  class_ids: [] as number[],
  status: '',
  practice_after: '',
  practice_before: '',
  created_after: '',
  created_before: ''
};

export type CredentialsResult = {
  users: CreatedUser[];
  credentialsCsv: string;
};

export interface UserOption {
  label: string;
  value: string;
}

export interface StudentOption extends UserOption {
  class_id: number | null;
  class_name: string | null;
}

const emptyUserOptions: UserOption[] = [];

export function toUserOption(user: Pick<UserSummary, 'id' | 'name' | 'uid'>): UserOption {
  return {
    label: `${user.name} (${user.uid})`,
    value: String(user.id)
  };
}

export function toStudentOption(user: StudentWithClassSummary): StudentOption {
  return {
    label: `${user.name} (${user.uid})`,
    value: String(user.id),
    class_id: user.class_id,
    class_name: user.class_name
  };
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function formatStudentClass(student: Pick<StudentWithClassSummary, 'class_name'>) {
  return student.class_name ? student.class_name : <span className="text-muted-foreground">未分配</span>;
}

export function getStudentClassSortValue(student: Pick<StudentWithClassSummary, 'class_name'>) {
  return student.class_name ?? null;
}

export function compareStudentClass(left: Pick<StudentWithClassSummary, 'class_name' | 'uid'>, right: Pick<StudentWithClassSummary, 'class_name' | 'uid'>, direction: 'asc' | 'desc') {
  const leftClass = getStudentClassSortValue(left);
  const rightClass = getStudentClassSortValue(right);

  if (!leftClass && !rightClass) return left.uid - right.uid;
  if (!leftClass) return 1;
  if (!rightClass) return -1;

  const result = leftClass.localeCompare(rightClass) || left.uid - right.uid;
  return direction === 'asc' ? result : -result;
}

export function SelectClass({
  classes,
  value,
  onChange
}: {
  classes: ClassSummary[];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label="班级">
      <Select value={value ? String(value) : '__none__'} onValueChange={(nextValue) => onChange(nextValue === '__none__' ? null : Number(nextValue))}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">未分配班级</SelectItem>
          {classes.map((item) => (
            <SelectItem key={item.id} value={String(item.id)}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-52 items-center justify-center gap-3 text-sm text-muted-foreground">
        <Spinner />
        {label}
      </CardContent>
    </Card>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card>
      <CardContent className="flex min-h-52 flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-destructive">{message}</p>
        {onRetry ? <Button variant="secondary" onClick={onRetry}>重新加载</Button> : null}
      </CardContent>
    </Card>
  );
}

export const FilterSelect = memo(function FilterSelect({
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

export const UserMultiCombobox = memo(function UserMultiCombobox({
  label,
  value,
  selectedOptions: initialSelectedOptions = emptyUserOptions,
  loadOptions,
  onChange
}: {
  label: string;
  value: number[];
  selectedOptions?: UserOption[];
  loadOptions: (query: string) => Promise<UserOption[]>;
  onChange: (value: number[]) => void;
}) {
  const [options, setOptions] = useState<UserOption[]>([]);
  const {
    anchorRef,
    query,
    setQuery,
    debouncedQuery,
    visibleItems: visibleOptions,
    loadMoreItems: loadMoreOptions,
    resetCombobox
  } = useComboboxPagedSearch({ items: options });
  const [selectedOptionMap, setSelectedOptionMap] = useState(() => new Map<string, UserOption>());
  const [loading, setLoading] = useState(false);
  const selectedOptions = useMemo(() => value.map((id) => selectedOptionMap.get(String(id))).filter((option): option is UserOption => Boolean(option)), [selectedOptionMap, value]);

  useEffect(() => {
    setSelectedOptionMap((current) => {
      const next = new Map(current);
      for (const option of initialSelectedOptions) {
        next.set(option.value, option);
      }
      return next;
    });
  }, [initialSelectedOptions]);

  useEffect(() => {
    let cancelled = false;

    async function loadMatchedOptions() {
      setLoading(true);
      try {
        const nextOptions = await loadOptions(debouncedQuery);

        if (cancelled) return;

        setOptions(nextOptions);
        setSelectedOptionMap((current) => {
          const next = new Map(current);
          for (const option of nextOptions) {
            next.set(option.value, option);
          }
          return next;
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMatchedOptions();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, loadOptions]);

  return (
    <Field label={label}>
      <Combobox
        multiple
        items={visibleOptions}
        inputValue={query}
        value={selectedOptions}
        onInputValueChange={setQuery}
        filter={null}
        onValueChange={(nextValue) => {
          setSelectedOptionMap((current) => {
            const next = new Map(current);
            for (const option of nextValue) {
              next.set(option.value, option);
            }
            return next;
          });
          onChange(nextValue.map((item) => Number(item.value)).filter((id) => Number.isInteger(id) && id > 0));
        }}
        itemToStringLabel={(item) => item.label}
        itemToStringValue={(item) => item.value}
        isItemEqualToValue={(item, selected) => item.value === selected.value}
      >
        <ComboboxChips ref={anchorRef} className="min-h-9 w-full">
          {selectedOptions.map((option) => (
            <ComboboxChip key={option.value}>{option.label}</ComboboxChip>
          ))}
          <ComboboxChipsInput placeholder={selectedOptions.length > 0 ? '' : `筛选${label}`} />
          {selectedOptions.length > 0 ? (
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => {
              resetCombobox();
              onChange([]);
            }}>
              <X className="size-3" />
            </Button>
          ) : null}
        </ComboboxChips>
        <ComboboxContent anchor={anchorRef} className="max-h-80">
          <ComboboxEmpty>暂无可选项</ComboboxEmpty>
          <ComboboxList onScroll={loadMoreOptions}>
            {loading ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">加载中...</div>
            ) : (
              <ComboboxGroup items={visibleOptions}>
                <ComboboxCollection>
                  {(option: UserOption) => (
                    <ComboboxItem key={option.value} value={option}>
                      {option.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
});

export const StudentMultiCombobox = memo(function StudentMultiCombobox({
  label,
  value,
  loadOptions,
  onChange
}: {
  label: string;
  value: number[];
  loadOptions: (query: string) => Promise<StudentOption[]>;
  onChange: (value: number[]) => void;
}) {
  const [options, setOptions] = useState<StudentOption[]>([]);
  const {
    anchorRef,
    query,
    setQuery,
    debouncedQuery,
    visibleItems: visibleOptions,
    loadMoreItems: loadMoreOptions,
    resetCombobox
  } = useComboboxPagedSearch({ items: options });
  const [selectedOptionMap, setSelectedOptionMap] = useState(() => new Map<string, StudentOption>());
  const [loading, setLoading] = useState(false);
  const selectedOptions = useMemo(() => value.map((id) => selectedOptionMap.get(String(id))).filter((option): option is StudentOption => Boolean(option)), [selectedOptionMap, value]);
  const visibleGroups = useMemo(() => {
    const groupMap = new Map<string, { value: string; items: StudentOption[] }>();

    for (const option of visibleOptions) {
      const groupKey = option.class_id ? String(option.class_id) : '__unassigned__';
      const groupLabel = option.class_id && option.class_name
        ? option.class_name
        : '未分配';
      const group = groupMap.get(groupKey) ?? { value: groupLabel, items: [] };
      group.items.push(option);
      groupMap.set(groupKey, group);
    }

    return [...groupMap.values()];
  }, [visibleOptions]);

  useEffect(() => {
    let cancelled = false;

    async function loadMatchedOptions() {
      setLoading(true);
      const nextOptions = await loadOptions(debouncedQuery);

      if (cancelled) return;

      setOptions(nextOptions);
      setLoading(false);
      setSelectedOptionMap((current) => {
        const next = new Map(current);
        for (const option of nextOptions) {
          next.set(option.value, option);
        }
        return next;
      });
    }

    void loadMatchedOptions();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, loadOptions]);

  return (
    <Field label={label}>
      <Combobox
        multiple
        items={visibleGroups}
        inputValue={query}
        value={selectedOptions}
        onInputValueChange={setQuery}
        filter={null}
        onValueChange={(nextValue) => {
          setSelectedOptionMap((current) => {
            const next = new Map(current);
            for (const option of nextValue) {
              next.set(option.value, option);
            }
            return next;
          });
          onChange(nextValue.map((item) => Number(item.value)).filter((id) => Number.isInteger(id) && id > 0));
        }}
        itemToStringLabel={(item: { value: string; items?: StudentOption[]; label?: string }) => item.label ?? item.value}
        itemToStringValue={(item: { value: string }) => item.value}
        isItemEqualToValue={(item: { value: string; items?: StudentOption[] }, selected: StudentOption) => !item.items && item.value === selected.value}
      >
        <ComboboxChips ref={anchorRef} className="min-h-9 w-full">
          {selectedOptions.map((option) => (
            <ComboboxChip key={option.value}>{option.label}</ComboboxChip>
          ))}
          <ComboboxChipsInput placeholder={selectedOptions.length > 0 ? '' : `筛选${label}`} />
          {selectedOptions.length > 0 ? (
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => {
              resetCombobox();
              onChange([]);
            }}>
              <X className="size-3" />
            </Button>
          ) : null}
        </ComboboxChips>
        <ComboboxContent anchor={anchorRef} className="max-h-80">
          <ComboboxEmpty>暂无可选项</ComboboxEmpty>
          <ComboboxList onScroll={loadMoreOptions}>
            {loading ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">加载中...</div>
            ) : (
              (group, index) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(option: StudentOption) => (
                      <ComboboxItem key={option.value} value={option}>
                        {option.label}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                  {index < visibleGroups.length - 1 && <ComboboxSeparator />}
                </ComboboxGroup>
              )
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
});

export function RecordPreview({ record }: { record: TeacherRecord }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={record.status} />
        <Badge variant="secondary">{formatDate(record.practice_date)}</Badge>
        <Badge variant="secondary">{formatDuration(record.duration)} h</Badge>
        {record.location ? <Badge variant="outline">{record.location}</Badge> : null}
      </div>
      <div className="rounded-2xl bg-muted/40 p-3 text-sm leading-7 text-muted-foreground sm:p-4">
        {record.content}
      </div>
      {record.image_paths.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {record.image_paths.map((imagePath) => (
            <AuthenticatedImage
              key={imagePath}
              className="max-h-72 w-full rounded-2xl object-cover"
              placeholderClassName="flex min-h-52 w-full items-center justify-center rounded-2xl bg-muted/40"
              src={imagePath}
              alt={record.title}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'approved' ? 'default' : status === 'rejected' ? 'destructive' : 'outline'}>{statusLabel(status)}</Badge>;
}

export function SortButton({
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
    <button className="inline-flex items-center gap-1 [font-weight:inherit]" type="button" onClick={onClick}>
      {label}
      {active ? descending ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" /> : null}
    </button>
  );
}
