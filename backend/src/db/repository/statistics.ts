import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { ClassOverview, OverviewData, RecordStatistics, StudentOverview, TeacherStatistics } from '../../models';
import { db } from '../client';
import { buildRecordWhere, toFiniteNumber, nowIso } from '../helpers';
import { classes, classStudents, classTeachers, practiceRecords, practiceTaskClasses, practiceTasks, users } from '../schema';
import { getClasses } from './classes';
import { getTeacherStudentIds } from './classes';
import { recentZonedMonths, zonedMonthRangeIso } from '../../time';

export function calculateRecordStatistics(where?: ReturnType<typeof buildRecordWhere> | ReturnType<typeof eq>) {
  const row = db
    .select({
      total_records: sql<number>`count(*)`,
      pending_count: sql<number>`sum(case when ${practiceRecords.status} = 'pending' then 1 else 0 end)`,
      approved_count: sql<number>`sum(case when ${practiceRecords.status} = 'approved' then 1 else 0 end)`,
      rejected_count: sql<number>`sum(case when ${practiceRecords.status} = 'rejected' then 1 else 0 end)`,
      total_duration: sql<number>`coalesce(sum(case when ${practiceRecords.status} = 'approved' then ${practiceRecords.duration} else 0 end), 0)`
    })
    .from(practiceRecords)
    .where(where)
    .get();
  return {
    total_records: toFiniteNumber(row?.total_records),
    pending_count: toFiniteNumber(row?.pending_count),
    approved_count: toFiniteNumber(row?.approved_count),
    rejected_count: toFiniteNumber(row?.rejected_count),
    total_duration: toFiniteNumber(row?.total_duration)
  } satisfies RecordStatistics;
}

export function getStudentStatistics(studentId: number) {
  return calculateRecordStatistics(eq(practiceRecords.studentId, studentId));
}

export function getStatistics(visibleStudentIds?: Set<number>): TeacherStatistics {
  const studentConditions = [eq(users.role, 'student'), isNull(users.deletedAt)];
  if (visibleStudentIds) {
    const ids = [...visibleStudentIds];
    studentConditions.push(ids.length > 0 ? inArray(users.id, ids) : sql`1 = 0`);
  }
  const studentsList = db
    .select({ id: users.id, uid: users.uid, name: users.name })
    .from(users)
    .where(and(...studentConditions))
    .all();
  const recordStats = calculateRecordStatistics(buildRecordWhere({}, visibleStudentIds));
  const studentDurations = studentsList
    .map((student) => {
      const row = db
        .select({ total: sql<number>`coalesce(sum(case when ${practiceRecords.status} = 'approved' then ${practiceRecords.duration} else 0 end), 0)` })
        .from(practiceRecords)
        .where(eq(practiceRecords.studentId, student.id))
        .get();
      return { student_id: student.id, student_name: student.name, student_uid: student.uid, total_duration: toFiniteNumber(row?.total) };
    })
    .sort((left, right) => {
      if (right.total_duration !== left.total_duration) return right.total_duration - left.total_duration;
      return left.student_name.localeCompare(right.student_name);
    });
  return { ...recordStats, student_count: studentsList.length, student_durations: studentDurations };
}

export function getOverview(visibleClassIds?: Set<number>, selectedClassId: number | null = null): OverviewData {
  const classIds = visibleClassIds ? [...visibleClassIds] : getClasses().map((item) => item.id);
  const scopedClassIds = selectedClassId ? classIds.filter((classId) => classId === selectedClassId) : classIds;
  const visibleCondition = scopedClassIds.length > 0 ? inArray(classes.id, scopedClassIds) : sql`1 = 0`;
  const totalDurationExpression = sql<number>`coalesce(sum(case when ${practiceRecords.status} = 'approved' then ${practiceRecords.duration} else 0 end), 0)`;
  const totalRecordsExpression = sql<number>`count(distinct ${practiceRecords.id})`;
  const classRows = db
    .select({
      class_id: classes.id, class_cid: classes.cid, class_name: classes.name,
      student_count: sql<number>`count(distinct ${classStudents.studentId})`,
      task_count: sql<number>`count(distinct ${practiceTaskClasses.taskId})`,
      total_records: sql<number>`count(distinct ${practiceRecords.id})`,
      pending_count: sql<number>`count(distinct case when ${practiceRecords.status} = 'pending' then ${practiceRecords.id} end)`,
      approved_count: sql<number>`count(distinct case when ${practiceRecords.status} = 'approved' then ${practiceRecords.id} end)`,
      rejected_count: sql<number>`count(distinct case when ${practiceRecords.status} = 'rejected' then ${practiceRecords.id} end)`,
      total_duration: sql<number>`coalesce(sum(case when ${practiceRecords.status} = 'approved' then ${practiceRecords.duration} else 0 end), 0)`
    })
    .from(classes)
    .leftJoin(classStudents, eq(classStudents.classId, classes.id))
    .leftJoin(practiceTaskClasses, eq(practiceTaskClasses.classId, classes.id))
    .leftJoin(practiceRecords, and(eq(practiceRecords.taskId, practiceTaskClasses.taskId), eq(practiceRecords.studentId, classStudents.studentId)))
    .where(visibleCondition)
    .groupBy(classes.id)
    .orderBy(classes.cid)
    .all()
    .map((row): ClassOverview => ({
      class_id: row.class_id, class_cid: row.class_cid, class_name: row.class_name,
      student_count: toFiniteNumber(row.student_count), task_count: toFiniteNumber(row.task_count),
      total_records: toFiniteNumber(row.total_records), pending_count: toFiniteNumber(row.pending_count),
      approved_count: toFiniteNumber(row.approved_count), rejected_count: toFiniteNumber(row.rejected_count),
      total_duration: toFiniteNumber(row.total_duration)
    }));
  const studentRows = db
    .select({
      student_id: users.id, student_uid: users.uid, student_name: users.name,
      class_id: classes.id, class_cid: classes.cid, class_name: classes.name,
      total_records: totalRecordsExpression,
      pending_count: sql<number>`count(distinct case when ${practiceRecords.status} = 'pending' then ${practiceRecords.id} end)`,
      approved_count: sql<number>`count(distinct case when ${practiceRecords.status} = 'approved' then ${practiceRecords.id} end)`,
      rejected_count: sql<number>`count(distinct case when ${practiceRecords.status} = 'rejected' then ${practiceRecords.id} end)`,
      total_duration: totalDurationExpression
    })
    .from(classStudents)
    .innerJoin(classes, eq(classes.id, classStudents.classId))
    .innerJoin(users, eq(users.id, classStudents.studentId))
    .leftJoin(practiceTaskClasses, eq(practiceTaskClasses.classId, classStudents.classId))
    .leftJoin(practiceRecords, and(eq(practiceRecords.studentId, users.id), eq(practiceRecords.taskId, practiceTaskClasses.taskId)))
    .where(and(visibleCondition, eq(users.role, 'student'), isNull(users.deletedAt)))
    .groupBy(users.id, classes.id)
    .orderBy(desc(totalDurationExpression), desc(totalRecordsExpression), asc(users.name), asc(users.uid))
    .all()
    .map((row): StudentOverview => ({
      student_id: row.student_id, student_uid: row.student_uid, student_name: row.student_name,
      class_id: row.class_id, class_cid: row.class_cid, class_name: row.class_name,
      total_records: toFiniteNumber(row.total_records), pending_count: toFiniteNumber(row.pending_count),
      approved_count: toFiniteNumber(row.approved_count), rejected_count: toFiniteNumber(row.rejected_count),
      total_duration: toFiniteNumber(row.total_duration)
    }));
  return {
    classes: classRows,
    students: studentRows,
    trend: getOverviewTrend(scopedClassIds),
    selected_class_id: selectedClassId
  };
}

function getOverviewTrend(classIds: number[]) {
  const months = recentZonedMonths(12);
  return months.map((month) => {
    const range = zonedMonthRangeIso(month);
    const classWhere = classIds.length > 0 ? inArray(practiceTaskClasses.classId, classIds) : sql`1 = 0`;
    const activeTaskRow = db
      .select({ count: sql<number>`count(distinct ${practiceTasks.id})` })
      .from(practiceTasks)
      .innerJoin(practiceTaskClasses, eq(practiceTaskClasses.taskId, practiceTasks.id))
      .where(and(classWhere, lte(practiceTasks.startAt, range.end), gte(practiceTasks.endAt, range.start)))
      .get();
    const recordRow = db
      .select({ count: sql<number>`count(distinct ${practiceRecords.id})` })
      .from(practiceRecords)
      .innerJoin(classStudents, eq(practiceRecords.studentId, classStudents.studentId))
      .where(and(
        classIds.length > 0 ? inArray(classStudents.classId, classIds) : sql`1 = 0`,
        gte(practiceRecords.createdAt, range.start),
        lte(practiceRecords.createdAt, range.end)
      ))
      .get();
    return {
      month,
      active_task_count: toFiniteNumber(activeTaskRow?.count),
      submitted_record_count: toFiniteNumber(recordRow?.count)
    };
  });
}
