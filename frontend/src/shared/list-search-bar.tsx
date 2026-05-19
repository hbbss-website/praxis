import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type ListSearchState<T extends string> = {
  field: T;
  query: string;
};

export type ListSearchOption<T extends string> = {
  label: string;
  value: T;
};

export function includesSearch(value: string | null | undefined, query: string) {
  return value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ?? false;
}

export function ListSearchBar<T extends string>({
  value,
  options,
  placeholder = '搜索',
  className,
  onChange,
  onSearch
}: {
  value: ListSearchState<T>;
  options: Array<ListSearchOption<T>>;
  placeholder?: string;
  className?: string;
  onChange: (value: ListSearchState<T>) => void;
  onSearch: () => void;
}) {
  return (
    <form
      className={cn('flex flex-wrap items-center gap-2', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <Select value={value.field} onValueChange={(field) => onChange({ ...value, field: field as T })}>
        <SelectTrigger className="h-9 w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="h-9 w-56"
        value={value.query}
        placeholder={placeholder}
        onChange={(event) => onChange({ ...value, query: event.target.value })}
      />
      <Button type="submit" size="sm">搜索</Button>
    </form>
  );
}
