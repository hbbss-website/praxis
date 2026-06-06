import { useState } from 'react';
import { CalendarIcon, XIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { normalizeDateInputValue } from '@/lib/format';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function toDate(value: string) {
  const normalizedValue = normalizeDateInputValue(value);
  return normalizedValue ? new Date(`${normalizedValue}T00:00:00`) : undefined;
}

function toDateText(date: Date | undefined) {
  return date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : '';
}

function parseDateTimeValue(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  return {
    date: match?.[1] ?? '',
    time: match?.[2] ?? ''
  };
}

function toDateTimeValue(date: string, time: string) {
  return date && time ? `${date}T${time.slice(0, 5)}` : '';
}

export function DatePickerField({
  value,
  onChange,
  placeholder = '选择日期',
  className
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const normalizedValue = normalizeDateInputValue(value);
  const selectedDate = toDate(normalizedValue);
  const hasValue = Boolean(normalizedValue);

  return (
    <div className={cn('relative w-full', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className={cn('relative w-full justify-start px-3 text-left font-normal', hasValue ? 'pr-16' : 'pr-10')}>
            <span className={cn('min-w-0 flex-1 truncate', normalizedValue ? 'text-foreground' : 'text-muted-foreground')}>
              {normalizedValue || placeholder}
            </span>
            <CalendarIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        {open ? (
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                onChange(toDateText(date));
                setOpen(false);
              }}
            />
          </PopoverContent>
        ) : null}
      </Popover>
      {hasValue ? (
        <Button
          size="icon-sm"
          type="button"
          variant="ghost"
          className="absolute right-8 top-1/2 z-10 -translate-y-1/2"
          onClick={() => onChange('')}
        >
          <XIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

export function DateTimePickerField({
  value,
  onChange,
  placeholder = '选择日期',
  required = false,
  defaultDate,
  className
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  defaultDate?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { date, time } = parseDateTimeValue(value);
  const selectedDate = toDate(date);

  return (
    <div className={cn('flex w-full flex-col gap-2 sm:flex-row', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start gap-2 px-3 text-left font-normal">
            <span className={cn('min-w-0 flex-1 truncate', date ? 'text-foreground' : 'text-muted-foreground')}>
              {date || placeholder}
            </span>
            <CalendarIcon className="size-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        {open ? (
          <PopoverContent align="start" className="w-auto overflow-hidden p-0">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              selected={selectedDate}
              defaultMonth={selectedDate}
              onSelect={(nextDate) => {
                onChange(toDateTimeValue(toDateText(nextDate), time || '00:00'));
                setOpen(false);
              }}
            />
          </PopoverContent>
        ) : null}
      </Popover>
      <Input
        type="time"
        step="60"
        value={time}
        required={required}
        onChange={(event) => {
          const nextTime = event.target.value;
          onChange(toDateTimeValue(date || defaultDate || normalizeDateInputValue(new Date()), nextTime));
        }}
        className="w-full border-input bg-background sm:w-32"
      />
    </div>
  );
}

export function DateRangePickerField({
  value,
  onChange,
  placeholder = '选择日期范围',
  className
}: {
  value: {
    from: string;
    to: string;
  };
  onChange: (value: { from: string; to: string }) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const normalizedFrom = normalizeDateInputValue(value.from);
  const normalizedTo = normalizeDateInputValue(value.to);
  const hasValue = Boolean(normalizedFrom || normalizedTo);
  const selectedRange: DateRange | undefined = normalizedFrom || normalizedTo ? {
    from: toDate(normalizedFrom),
    to: toDate(normalizedTo)
  } : undefined;
  const label = normalizedFrom && normalizedTo
    ? `${normalizedFrom} 至 ${normalizedTo}`
    : normalizedFrom
      ? `${normalizedFrom} 起`
      : normalizedTo
        ? `截至 ${normalizedTo}`
        : placeholder;

  return (
    <div className={cn('relative w-full', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className={cn('relative w-full justify-start px-3 text-left font-normal', hasValue ? 'pr-16' : 'pr-10')}>
            <span className={cn('min-w-0 flex-1 truncate', hasValue ? 'text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
            <CalendarIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        {open ? (
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={selectedRange}
              onSelect={(range) => {
                onChange({
                  from: toDateText(range?.from),
                  to: toDateText(range?.to)
                });
              }}
            />
          </PopoverContent>
        ) : null}
      </Popover>
      {hasValue ? (
        <Button
          size="icon-sm"
          type="button"
          variant="ghost"
          className="absolute right-8 top-1/2 z-10 -translate-y-1/2"
          onClick={() => onChange({ from: '', to: '' })}
        >
          <XIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
