import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { D1DB } from '../db';
import type { ClassOverview, OverviewData, RecordStatistics, StudentOverview, TeacherStatistics } from '../../models';
import { classes, classStudents, classTeachers, practiceRecords, practiceTaskClasses, practiceTasks, users } from '../../db/schema';
import { toFiniteNumber } from './helpers';
import { getClasses } from './classes';
import { buildRecordWhere } from './records-helpers';
import { recentUtcMonths, utcMonthRangeIso } from '../../time';

export async function calculateRecordStatistics(db: D1DB, where?: any) {
  const row = await db.select({
    total_records: sql<number>`count(*)`,
    pending_count: sql<number>`sum(case when ${practiceRecords.status} = 'pending' then 1 else 0 end)`,
    approved_count: sql<number>`sum(case when ${practiceRecords.status} = 'approved' then 1 else 0 end)`,
    rejected_count: sql<number>`sum(case when ${practiceRecords.status} = 'rejected' then 1 else 0 end)`,
    total_duration: sql<number>`coalesce(sum(case when ${practiceRecords.status} = 'approved' then ${practiceRecords.duration} else 0 end),0)`
  }).from(practiceRecords).where(where).get();
  return {
    total_records: toFiniteNumber(row?.total_records),
    pending_count: toFiniteNumber(row?.pending_count),
    approved_count: toFiniteNumber(row?.approved_count),
    rejected_count: toFiniteNumber(row?.rejected_count),
    total_duration: toFiniteNumber(row?.total_duration)
  } satisfies RecordStatistics;
}

export async function getStudentStatistics(db: D1DB, studentId: number) {
  return calculateRecordStatistics(db, eq(practiceRecords.studentId, studentId));
}

export async function getStatistics(db: D1DB, visibleStudentIds?: Set<number>): Promise<TeacherStatistics> {
  const conds = [eq(users.role, 'student'), isNull(users.deletedAt)];
  if (visibleStudentIds) {
    const ids = [...visibleStudentIds];
    conds.push(ids.length > 0 ? inArray(users.id, ids) : sql`1 = 0`);
  }
  const studentsList = await db.select({ id: users.id, name: users.name }).from(users).where(and(...conds)).all();
  const recordStats = await calculateRecordStatistics(db, buildRecordWhere({}, visibleStudentIds));
  const studentDurations = await Promise.all(studentsList.map(async (s) => {
    const row = await db.select({ total: sql<number>`coalesce(sum(case when ${practiceRecords.status}='approved' then ${practiceRecords.duration} else 0 end),0)` })
      .from(practiceRecords).where(eq(practiceRecords.studentId, s.id)).get();
    return { student_id: s.id, student_name: s.name, student_uid: s.id, total_duration: toFiniteNumber(row?.total) };
  }));
  studentDurations.sort((a, b) => b.total_duration - a.total_duration || a.student_name.localeCompare(b.student_name));
  return { ...recordStats, student_count: studentsList.length, student_durations: studentDurations };
}

export async function getOverview(db: D1DB, cfg: { overview_class_ranking_limit: number; overview_student_ranking_limit: number }, visibleClassIds?: Set<number>, selectedClassId: number | null = null): Promise<OverviewData> {
  const allClasses = await getClasses(db);
  const classIds = visibleClassIds ? [...visibleClassIds] : allClasses.map((c) => c.id);
  const scopedClassIds = selectedClassId ? classIds.filter((id) => id === selectedClassId) : classIds;
  const visibleCond = scopedClassIds.length > 0 ? inArray(classes.id, scopedClassIds) : sql`1 = 0`;
  const totalDurExpr = sql<number>`coalesce(sum(case when ${practiceRecords.status}='approved' then ${practiceRecords.duration} else 0 end),0)`;
  const totalRecExpr = sql<number>`count(distinct ${practiceRecords.id})`;

  const classOverviewSel = {
    class_id: classes.id, class_name: classes.name,
    student_count: sql<number>`count(distinct ${classStudents.studentId})`,
    task_count: sql<number>`count(distinct ${practiceTaskClasses.taskId})`,
    total_records: sql<number>`count(distinct ${practiceRecords.id})`,
    pending_count: sql<number>`count(distinct case when ${practiceRecords.status}='pending' then ${practiceRecords.id} end)`,
    approved_count: sql<number>`count(distinct case when ${practiceRecords.status}='approved' then ${practiceRecords.id} end)`,
    rejected_count: sql<number>`count(distinct case when ${practiceRecords.status}='rejected' then ${practiceRecords.id} end)`,
    total_duration: sql<number>`coalesce(sum(case when ${practiceRecords.status}='approved' then ${practiceRecords.duration} else 0 end),0)`
  };

  const toClassOverview = (row: any): ClassOverview => ({
    class_id: row.class_id, class_name: row.class_name,
    student_count: toFiniteNumber(row.student_count), task_count: toFiniteNumber(row.task_count),
    total_records: toFiniteNumber(row.total_records), pending_count: toFiniteNumber(row.pending_count),
    approved_count: toFiniteNumber(row.approved_count), rejected_count: toFiniteNumber(row.rejected_count),
    total_duration: toFiniteNumber(row.total_duration)
  });

  const studentOverviewSel = {
    student_id: users.id, student_uid: users.id, student_name: users.name,
    class_id: classes.id, class_name: classes.name,
    total_records: totalRecExpr,
    pending_count: sql<number>`count(distinct case when ${practiceRecords.status}='pending' then ${practiceRecords.id} end)`,
    approved_count: sql<number>`count(distinct case when ${practiceRecords.status}='approved' then ${practiceRecords.id} end)`,
    rejected_count: sql<number>`count(distinct case when ${practiceRecords.status}='rejected' then ${practiceRecords.id} end)`,
    total_duration: totalDurExpr
  };

  const toStudentOverview = (row: any): StudentOverview => ({
    student_id: row.student_id, student_uid: row.student_uid, student_name: row.student_name,
    class_id: row.class_id, class_name: row.class_name,
    total_records: toFiniteNumber(row.total_records), pending_count: toFiniteNumber(row.pending_count),
    approved_count: toFiniteNumber(row.approved_count), rejected_count: toFiniteNumber(row.rejected_count),
    total_duration: toFiniteNumber(row.total_duration)
  });

  const classJoin = db.select(classOverviewSel).from(classes)
    .leftJoin(classStudents, eq(classStudents.classId, classes.id))
    .leftJoin(practiceTaskClasses, eq(practiceTaskClasses.classId, classes.id))
    .leftJoin(practiceRecords, and(eq(practiceRecords.taskId, practiceTaskClasses.taskId), eq(practiceRecords.studentId, classStudents.studentId)))
    .where(visibleCond).groupBy(classes.id);

  const [classRows, classRankings, studentRows, trend] = await Promise.all([
    classJoin.orderBy(classes.name).all(),
    classJoin.orderBy(desc(classOverviewSel.total_duration), desc(classOverviewSel.total_records), asc(classes.name))
      .limit(cfg.overview_class_ranking_limit).all(),
    db.select(studentOverviewSel).from(classStudents)
      .innerJoin(classes, eq(classes.id, classStudents.classId))
      .innerJoin(users, eq(users.id, classStudents.studentId))
      .leftJoin(practiceTaskClasses, eq(practiceTaskClasses.classId, classStudents.classId))
      .leftJoin(practiceRecords, and(eq(practiceRecords.studentId, users.id), eq(practiceRecords.taskId, practiceTaskClasses.taskId)))
      .where(and(visibleCond, eq(users.role, 'student'), isNull(users.deletedAt)))
      .groupBy(users.id, classes.id)
      .orderBy(desc(totalDurExpr), desc(totalRecExpr), asc(users.name), asc(users.id))
      .limit(cfg.overview_student_ranking_limit).all(),
    getOverviewTrend(db, scopedClassIds)
  ]);

  return {
    classes: classRows.map(toClassOverview),
    students: studentRows.map(toStudentOverview),
    class_rankings: classRankings.map(toClassOverview),
    student_rankings: studentRows.map(toStudentOverview),
    trend,
    selected_class_id: selectedClassId
  };
}

async function getOverviewTrend(db: D1DB, classIds: number[]) {
  const months = recentUtcMonths(12);
  return Promise.all(months.map(async (month) => {
    const range = utcMonthRangeIso(month);
    const classWhere = classIds.length > 0 ? inArray(practiceTaskClasses.classId, classIds) : sql`1 = 0`;
    const [activeTaskRow, recordRow] = await Promise.all([
      db.select({ count: sql<number>`count(distinct ${practiceTasks.id})` })
        .from(practiceTasks).innerJoin(practiceTaskClasses, eq(practiceTaskClasses.taskId, practiceTasks.id))
        .where(and(classWhere, lt(practiceTasks.startAt, range.end), gte(practiceTasks.endAt, range.start))).get(),
      db.select({ count: sql<number>`count(distinct ${practiceRecords.id})` })
        .from(practiceRecords).innerJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
        .where(and(classIds.length > 0 ? inArray(classStudents.classId, classIds) : sql`1 = 0`, gte(practiceRecords.createdAt, range.start), lt(practiceRecords.createdAt, range.end))).get()
    ]);
    return { month, active_task_count: toFiniteNumber(activeTaskRow?.count), submitted_record_count: toFiniteNumber(recordRow?.count) };
  }));
}
