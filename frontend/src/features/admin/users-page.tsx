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
import { UserCredentialsResult } from '@/shared/user-credentials-result';
import { AdminPageFrame, Field, SelectClass, type CredentialsResult } from './shared';

export function AdminUsersPage() {
  const { signOut } = useSession();
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [singleForm, setSingleForm] = useState({ name: '', role: 'student' as UserRole, class_id: null as number | null });
  const [singleResult, setSingleResult] = useState<CredentialsResult | null>(null);
  const [csvFileName, setCsvFileName] = useState('');
  const [csvEncoding, setCsvEncoding] = useState<CsvImportPreview['encoding'] | null>(null);
  const [csvResult, setCsvResult] = useState<CredentialsResult | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [batchEntries, setBatchEntries] = useState([{ name: '', role: 'student' as UserRole, class_id: null as number | null }]);
  const [batchResult, setBatchResult] = useState<CredentialsResult | null>(null);

  useEffect(() => {
    unwrapResponse<{ classes: ClassSummary[] }>(createApiClient().admin.classes.get())
      .then((data) => setClasses(data.classes))
      .catch((error) => {
        if (error instanceof ApiResponseError && error.status === 401) {
          signOut();
          return;
        }

        toastError(error, '加载班级列表失败。');
      });
  }, [signOut]);

  return (
    <AdminPageFrame title="用户创建" description="管理员可以单个创建、批量填写或导入 CSV 创建账号，并下载生成结果。">
      <Tabs defaultValue="single">
        <TabsList>
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
                <SelectClass
                  classes={classes}
                  value={singleForm.class_id}
                  disabled={singleForm.role === 'admin'}
                  onChange={(class_id) => setSingleForm((current) => ({ ...current, class_id }))}
                />
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={async () => {
                    try {
                      const data = await unwrapResponse<CreatedUserPayload>(createApiClient().admin.users.post(singleForm));
                      setSingleResult({ users: [data.user], credentialsCsv: data.credentialsCsv });
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
              {singleResult ? <UserCredentialsResult users={singleResult.users} credentialsCsv={singleResult.credentialsCsv} filename="created_user.csv" summary="成功生成 1 个账号。" /> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="csv" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle>CSV 导入</CardTitle>
                  <CardDescription>不包含表头，点击<CsvFormatDialog><Button className="h-auto p-0 text-sm" variant="link">此处</Button></CsvFormatDialog>查看格式。支持 UTF-8、UTF-16 和 GBK 编码。</CardDescription>
                </div>
                <CsvFormatDialog><Button className="h-auto p-0 text-sm" variant="link">格式</Button></CsvFormatDialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={csvInputRef}
                className="hidden"
                type="file"
                accept=".csv,text/csv"
                  onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;

                  setCsvResult(null);
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
                    const data = await importUserCsv(file);
                    setCsvResult({ users: data.users, credentialsCsv: data.credentialsCsv });
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
              </div>
              {csvResult ? <UserCredentialsResult users={csvResult.users} credentialsCsv={csvResult.credentialsCsv} filename="imported_users.csv" summary={`成功生成 ${csvResult.users.length} 个账号。`} /> : null}
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
                              ? { ...item, role: value as UserRole, class_id: value === 'admin' ? null : item.class_id }
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
                    <Select
                      value={entry.class_id ? String(entry.class_id) : '__none__'}
                      disabled={entry.role === 'admin'}
                      onValueChange={(value) =>
                        setBatchEntries((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, class_id: value === '__none__' ? null : Number(value) } : item)
                        )
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="班级" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">不分配班级</SelectItem>
                        {classes.map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {item.name} ({item.cid})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                <Button variant="outline" onClick={() => setBatchEntries((current) => [...current, { name: '', role: 'student', class_id: null }])}>
                  <Plus className="size-4" />
                  新增一行
                </Button>
                <Button
                  onClick={async () => {
                    const entries = batchEntries.filter((entry) => entry.name.trim());
                    if (entries.length === 0) {
                      toastError(new Error('请至少填写一条有效记录。'));
                      return;
                    }

                    try {
                      const data = await unwrapResponse<CreatedUsersPayload>(createApiClient().admin.users.batch.post({ entries }));
                      setBatchResult({ users: data.users, credentialsCsv: data.credentialsCsv });
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
              {batchResult ? <UserCredentialsResult users={batchResult.users} credentialsCsv={batchResult.credentialsCsv} filename="batch_created_users.csv" summary={`成功生成 ${batchResult.users.length} 个账号。`} /> : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminPageFrame>
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

function CsvFormatDialog({ children }: { children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>CSV 格式</DialogTitle>
          <DialogDescription>
            导入文件不包含表头，格式为 <code>姓名,用户类型,班级 ID</code>。用户类型可以为 <code>student</code>、<code>teacher</code> 或 <code>admin</code>。学生和教师可选填班级 ID，注意不要给 <code>admin</code> 填写班级 ID。以下是一个示例：
          </DialogDescription>
        </DialogHeader>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-4 text-sm leading-6">
          {`小奶龙,student,C0001\n大奶龙,teacher,C0001\n超级奶龙,admin,`}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
