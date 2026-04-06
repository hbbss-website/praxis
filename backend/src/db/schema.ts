import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull(),
  password: text('password').notNull(),
  role: text('role').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at')
}, (table) => [
  uniqueIndex('users_uid_unique').on(table.uid),
  index('users_role_idx').on(table.role),
  index('users_deleted_at_idx').on(table.deletedAt)
]);

export const teacherStudents = sqliteTable('teacher_students', {
  teacherId: integer('teacher_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.teacherId, table.studentId] }),
  uniqueIndex('teacher_students_student_unique').on(table.studentId),
  index('teacher_students_teacher_idx').on(table.teacherId)
]);

export const practiceRecords = sqliteTable('practice_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => users.id),
  studentUidSnapshot: text('student_uid_snapshot'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  practiceDate: text('practice_date').notNull(),
  location: text('location'),
  duration: real('duration').notNull(),
  imagePath: text('image_path'),
  status: text('status').notNull(),
  teacherComment: text('teacher_comment'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedByUid: text('updated_by_uid')
}, (table) => [
  index('practice_records_student_idx').on(table.studentId),
  index('practice_records_status_idx').on(table.status),
  index('practice_records_practice_date_idx').on(table.practiceDate),
  index('practice_records_created_at_idx').on(table.createdAt)
]);

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  message: text('message').notNull(),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('notifications_student_idx').on(table.studentId),
  index('notifications_created_at_idx').on(table.createdAt)
]);
