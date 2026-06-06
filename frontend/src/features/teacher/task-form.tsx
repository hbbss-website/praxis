import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { DateTimePickerField } from '@/shared/date-picker-field';
import type { ClassSummary, PracticeTaskDetail } from '@/lib/types';
import { Field, UserMultiCombobox } from './shared';

export type TaskFormState = {
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  min_words: string;
  min_images: string;
  max_records_per_student: string;
  score_enabled: boolean;
  class_ids: number[];
};

export const emptyTaskForm: TaskFormState = {
  title: '',
  description: '',
  start_at: '',
  end_at: '',
  min_words: '0',
  min_images: '0',
  max_records_per_student: '1',
  score_enabled: false,
  class_ids: []
};

export function toLocalMinute(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16) : '';
}

export function fromLocalMinute(value: string) {
  return value ? new Date(value).toISOString() : '';
}

export function taskToForm(task: PracticeTaskDetail): TaskFormState {
  return {
    title: task.title,
    description: task.description ?? '',
    start_at: toLocalMinute(task.start_at),
    end_at: toLocalMinute(task.end_at),
    min_words: String(task.min_words),
    min_images: String(task.min_images),
    max_records_per_student: String(task.max_records_per_student),
    score_enabled: task.score_enabled,
    class_ids: task.classes.map((item) => item.id)
  };
}

export function formToPayload(form: TaskFormState) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    start_at: fromLocalMinute(form.start_at),
    end_at: fromLocalMinute(form.end_at),
    min_words: Number(form.min_words),
    min_images: Number(form.min_images),
    max_records_per_student: Number(form.max_records_per_student),
    score_enabled: form.score_enabled,
    class_ids: form.class_ids
  };
}

export function TaskFormDialog({
  open,
  title,
  classes,
  form,
  onOpenChange,
  onFormChange,
  lockedClassIds = [],
  showScoreEnabled = false,
  onRemoveClassRequest,
  onSubmit
}: {
  open: boolean;
  title: string;
  classes: ClassSummary[];
  form: TaskFormState;
  onOpenChange: (open: boolean) => void;
  onFormChange: (form: TaskFormState) => void;
  lockedClassIds?: number[];
  showScoreEnabled?: boolean;
  onRemoveClassRequest?: (targetClasses: ClassSummary[]) => void;
  onSubmit: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const loadClassOptions = useCallback(async (query: string) => {
    const normalized = query.trim().toLowerCase();
    return classes
      .filter((item) => !normalized || item.name.toLowerCase().includes(normalized))
      .map((item) => ({ label: item.name, value: String(item.id) }));
  }, [classes]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          try {
            await onSubmit();
          } finally {
            setSubmitting(false);
          }
        }}>
          <Field label="任务名称"><Input value={form.title} onChange={(event) => onFormChange({ ...form, title: event.target.value })} required /></Field>
          <Field label="任务说明"><Textarea value={form.description} onChange={(event) => onFormChange({ ...form, description: event.target.value })} /></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="开始时间"><DateTimePickerField value={form.start_at} onChange={(value) => onFormChange({ ...form, start_at: value })} required /></Field>
            <Field label="截止时间"><DateTimePickerField value={form.end_at} onChange={(value) => onFormChange({ ...form, end_at: value })} required /></Field>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="最少字数"><Input type="number" min="0" value={form.min_words} onChange={(event) => onFormChange({ ...form, min_words: event.target.value })} /></Field>
            <Field label="最少图片数量"><Input type="number" min="0" max="9" value={form.min_images} onChange={(event) => onFormChange({ ...form, min_images: event.target.value })} /></Field>
            <Field label="每人最多记录数"><Input type="number" min="1" value={form.max_records_per_student} onChange={(event) => onFormChange({ ...form, max_records_per_student: event.target.value })} /></Field>
          </div>
          {showScoreEnabled ? (
            <Field label="打分">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.score_enabled} onCheckedChange={(checked) => onFormChange({ ...form, score_enabled: checked })} />
                启用打分
              </label>
            </Field>
          ) : null}
          <UserMultiCombobox
            label="班级"
            value={form.class_ids}
            loadOptions={loadClassOptions}
            onChange={(value) => {
              const removedClassIds = lockedClassIds.filter((classId) => !value.includes(classId));

              if (removedClassIds.length > 0) {
                const targetClasses = removedClassIds
                  .map((classId) => classes.find((item) => item.id === classId))
                  .filter((item): item is ClassSummary => Boolean(item));
                if (targetClasses.length > 0 && onRemoveClassRequest) {
                  onRemoveClassRequest(targetClasses);
                }
                return;
              }

              onFormChange({ ...form, class_ids: value });
            }}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting}>保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
