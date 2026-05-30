import { BarChart3, CheckCircle2, Clock3, FilePenLine, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ECharts, EChartsCoreOption } from 'echarts/core';

import { DataTable } from '@/components/data-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard } from '@/shared/stat-card';
import { ApiResponseError, createApiClient, unwrapResponse } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { formatDuration } from '@/lib/format';
import type { ClassSummary, OverviewData } from '@/lib/types';
import { ErrorCard, LoadingCard, PageFrame } from './shared';
import type { ColumnDef } from '@tanstack/react-table';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function TeacherDashboardPage() {
  const { signOut, user } = useSession();
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [classId, setClassId] = useState<string>('all');
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    try {
      const api = createApiClient();
      const [classesData, overviewData] = await Promise.all([
        unwrapResponse<{ classes: ClassSummary[] }>(api.teacher.classes.get()),
        unwrapResponse<{ overview: OverviewData }>(api.teacher.overview.get({ query: { class_id: classId === 'all' ? undefined : classId } }))
      ]);
      setClasses(classesData.classes);
      setOverview(overviewData.overview);
    } catch (nextError) {
      if (nextError instanceof ApiResponseError && nextError.status === 401) {
        signOut();
        return;
      }
      setError(nextError instanceof Error ? nextError.message : '加载概览失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [classId]);

  const totals = overview?.classes.reduce((acc, item) => ({
    student_count: acc.student_count + item.student_count,
    task_count: acc.task_count + item.task_count,
    total_records: acc.total_records + item.total_records,
    pending_count: acc.pending_count + item.pending_count,
    approved_count: acc.approved_count + item.approved_count,
    rejected_count: acc.rejected_count + item.rejected_count,
    total_duration: acc.total_duration + item.total_duration
  }), {
    student_count: 0,
    task_count: 0,
    total_records: 0,
    pending_count: 0,
    approved_count: 0,
    rejected_count: 0,
    total_duration: 0
  });

  const columns = useMemo<Array<ColumnDef<OverviewData['classes'][number]>>>(() => [
    {
      id: 'class',
      header: '班级',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.class_name}</p>
          <p className="text-xs text-muted-foreground">{row.original.class_cid}</p>
        </div>
      )
    },
    { accessorKey: 'student_count', header: '学生数' },
    { accessorKey: 'task_count', header: '任务数' },
    { accessorKey: 'total_records', header: '记录总数' },
    { accessorKey: 'pending_count', header: '待审核' },
    { accessorKey: 'approved_count', header: '已通过' },
    { accessorKey: 'rejected_count', header: '已驳回' },
    {
      accessorKey: 'total_duration',
      header: '累计时长',
      cell: ({ row }) => `${formatDuration(row.original.total_duration)} 小时`
    }
  ], []);
  const studentColumns = useMemo<Array<ColumnDef<OverviewData['students'][number]>>>(() => [
    {
      id: 'student',
      header: '学生',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.student_name}</p>
          <p className="text-xs text-muted-foreground">{row.original.student_uid}</p>
        </div>
      )
    },
    {
      id: 'class',
      header: '班级',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.class_name}</p>
          <p className="text-xs text-muted-foreground">{row.original.class_cid}</p>
        </div>
      )
    },
    { accessorKey: 'total_records', header: '记录总数' },
    { accessorKey: 'pending_count', header: '待审核' },
    { accessorKey: 'approved_count', header: '已通过' },
    { accessorKey: 'rejected_count', header: '已驳回' },
    {
      accessorKey: 'total_duration',
      header: '累计时长',
      cell: ({ row }) => `${formatDuration(row.original.total_duration)} 小时`
    }
  ], []);

  return (
    <PageFrame
      title="数据概览"
      description={user?.role === 'admin' ? '查看全部班级的任务和记录数据。' : '查看自己管理班级的任务和记录数据。'}
      action={
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">总览</SelectItem>
            {classes.map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.name} ({item.cid})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {loading ? (
        <LoadingCard label="正在加载数据概览..." />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : overview && totals ? (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="任务数" value={String(totals.task_count)} hint="当前范围内任务" icon={FilePenLine} />
            <StatCard title="记录总数" value={String(totals.total_records)} hint="当前范围内记录" icon={BarChart3} />
            <StatCard title="待审核" value={String(totals.pending_count)} hint="需要处理" icon={Clock3} />
            <StatCard title="学生人数" value={String(totals.student_count)} hint="当前范围内学生" icon={Users} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>月度趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <OverviewChart overview={overview} />
            </CardContent>
          </Card>

          {overview.classes.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>班级排名</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable columns={columns} data={overview.classes} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>学生排名</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable batchSize={50} columns={studentColumns} data={overview.students} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageFrame>
  );
}

function OverviewChart({ overview }: { overview: OverviewData }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const data = useMemo(() => {
    return overview.trend.map((item) => ({
      month: item.month,
      activeTaskCount: item.active_task_count,
      submittedRecordCount: item.submitted_record_count
    }));
  }, [overview]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    chartRef.current?.dispose();
    const chart = echarts.init(container, null, { renderer: 'canvas' });
    chartRef.current = chart;

    const option: EChartsCoreOption = {
      color: ['#60a5fa', '#16a34a'],
      animationDuration: 300,
      grid: {
        top: 36,
        right: 16,
        bottom: 28,
        left: 36,
        containLabel: true
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: {
            color: '#94a3b8'
          }
        },
        valueFormatter: (value: unknown) => String(value ?? 0)
      },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: {
          color: '#64748b',
          fontSize: 12
        }
      },
      xAxis: {
        type: 'category',
        data: data.map((item) => item.month.slice(5)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#64748b' }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#e5e7eb' } }
      },
      series: [
        {
          name: '进行中的实践数',
          type: 'bar',
          barMaxWidth: 30,
          data: data.map((item) => item.activeTaskCount),
          itemStyle: {
            borderRadius: [4, 4, 0, 0]
          }
        },
        {
          name: '提交记录数',
          type: 'line',
          smooth: false,
          symbol: 'circle',
          symbolSize: 7,
          data: data.map((item) => item.submittedRecordCount),
          lineStyle: {
            width: 2
          }
        }
      ]
    };

    chart.setOption(option);

    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [data]);

  return <div ref={containerRef} className="h-[320px] w-full overflow-hidden rounded-md" />;
}
