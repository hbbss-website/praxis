import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { RecordFilters } from '../../models';
import { classes, classStudents, practiceRecords, users } from '../../db/schema';

export function buildRecordWhere(filters: RecordFilters = {}, visibleStudentIds?: Set<number>) {
  const conditions = [];
  if (filters.task_id !== undefined) {
    if (filters.task_id === null) conditions.push(isNull(practiceRecords.taskId));
    else conditions.push(eq(practiceRecords.taskId, filters.task_id));
  }
  if (visibleStudentIds) {
    const ids = [...visibleStudentIds];
    conditions.push(ids.length > 0 ? inArray(practiceRecords.studentId, ids) : sql`1 = 0`);
  }
  if (filters.student_id) conditions.push(eq(practiceRecords.studentId, filters.student_id));
  if (filters.student_ids) {
    conditions.push(filters.student_ids.length > 0 ? inArray(practiceRecords.studentId, filters.student_ids) : sql`1 = 0`);
  }
  if (filters.class_id) {
    conditions.push(sql`${practiceRecords.studentId} in (select ${classStudents.studentId} from ${classStudents} where ${classStudents.classId} = ${filters.class_id})`);
  }
  if (filters.class_ids) {
    conditions.push(filters.class_ids.length > 0
      ? sql`${practiceRecords.studentId} in (select ${classStudents.studentId} from ${classStudents} where ${inArray(classStudents.classId, filters.class_ids)})`
      : sql`1 = 0`);
  }
  if (filters.status) conditions.push(eq(practiceRecords.status, filters.status));
  if (filters.practice_after) conditions.push(gte(practiceRecords.practiceDate, filters.practice_after));
  if (filters.practice_before) conditions.push(lte(practiceRecords.practiceDate, filters.practice_before));
  if (filters.created_after) conditions.push(gte(practiceRecords.createdAt, filters.created_after));
  if (filters.created_before) conditions.push(lte(practiceRecords.createdAt, filters.created_before));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export const deletedUserName = '已删除用户';

export function recordHasImagePathCondition(imagePath: string) {
  return sql`(${practiceRecords.coverImagePath} = ${imagePath} or ${practiceRecords.imagePaths} like ${`%"${imagePath}"%`})`;
}

export function recordIdentitySelect() {
  return {
    student_name: sql<string>`case when ${users.id} is null or ${users.deletedAt} is not null then ${deletedUserName} else ${users.name} end`,
    student_uid: sql<number>`case when ${users.id} is null then coalesce(${practiceRecords.studentUidSnapshot}, 0) else ${users.id} end`
  };
}
