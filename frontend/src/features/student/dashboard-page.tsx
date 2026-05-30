import { CalendarDays } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState } from '@/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiResponseError, createApiClient, unwrapResponse } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { PracticeTaskSummary } from '@/lib/types';
import { ErrorCard, LoadingCard, StudentPageFrame } from './shared';

type TaskTab = 'active' | 'upcoming' | 'ended';

function getTaskTab(task: PracticeTaskSummary) {
  const now = new Date().toISOString();

  if (now < task.start_at) return 'upcoming';
  if (now > task.end_at) return 'ended';
  return 'active';
}

function sortTasks(tab: TaskTab, tasks: PracticeTaskSummary[]) {
  return [...tasks].sort((left, right) => {
    if (tab === 'active') return left.end_at.localeCompare(right.end_at);
    if (tab === 'upcoming') return left.start_at.localeCompare(right.start_at);
    return right.end_at.localeCompare(left.end_at);
  });
}

export function StudentDashboardPage() {
  const { signOut } = useSession();
  const [tasks, setTasks] = useState<PracticeTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    try {
      const data = await unwrapResponse<{ tasks: PracticeTaskSummary[] }>(createApiClient().student.tasks.get());
      setTasks(data.tasks);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      setError(nextError instanceof Error ? nextError.message : '加载任务失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => ({
    active: sortTasks('active', tasks.filter((task) => getTaskTab(task) === 'active')),
    upcoming: sortTasks('upcoming', tasks.filter((task) => getTaskTab(task) === 'upcoming')),
    ended: sortTasks('ended', tasks.filter((task) => getTaskTab(task) === 'ended'))
  }), [tasks]);

  return (
    <StudentPageFrame title="任务列表" description="查看自己的实践任务和提交记录。">
      {loading ? (
        <LoadingCard label="正在加载任务..." />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : (
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">进行中</TabsTrigger>
            <TabsTrigger value="upcoming">未开始</TabsTrigger>
            <TabsTrigger value="ended">已结束</TabsTrigger>
          </TabsList>
          <TaskList value="active" tasks={grouped.active} />
          <TaskList value="upcoming" tasks={grouped.upcoming} />
          <TaskList value="ended" tasks={grouped.ended} />
        </Tabs>
      )}
    </StudentPageFrame>
  );
}

function TaskList({ value, tasks }: { value: TaskTab; tasks: PracticeTaskSummary[] }) {
  return (
    <TabsContent value={value} className="mt-4">
      {tasks.length === 0 ? (
        <EmptyState title="暂无任务" description="" />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <Card key={task.id} className="overflow-hidden">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <h2 className="truncate text-base font-semibold">{task.title}</h2>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" />开始：{formatDateTime(task.start_at)}</span>
                    <span>截止：{formatDateTime(task.end_at)}</span>
                  </div>
                </div>
                <Button asChild>
                  <Link to={`/student/tasks/${task.id}`}>进入任务</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </TabsContent>
  );
}
