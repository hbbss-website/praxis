import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  password: text('password').notNull(),
  role: text('role').notNull(),
  name: text('name').notNull(),
  englishName: text('english_name'),
  nameInitials: text('name_initials').notNull().default(''),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at')
}, (table) => [
  index('users_role_idx').on(table.role),
  index('users_name_initials_idx').on(table.nameInitials),
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

export const classes = sqliteTable('classes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('classes_name_unique').on(table.name),
  index('classes_created_at_idx').on(table.createdAt)
]);

export const classTeachers = sqliteTable('class_teachers', {
  classId: integer('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
  teacherId: integer('teacher_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.classId, table.teacherId] }),
  index('class_teachers_class_idx').on(table.classId),
  index('class_teachers_teacher_idx').on(table.teacherId)
]);

export const classStudents = sqliteTable('class_students', {
  classId: integer('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.classId, table.studentId] }),
  uniqueIndex('class_students_student_unique').on(table.studentId),
  index('class_students_class_idx').on(table.classId)
]);

export const practiceTasks = sqliteTable('practice_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
  minWords: integer('min_words').notNull().default(0),
  minImages: integer('min_images').notNull().default(0),
  maxRecordsPerStudent: integer('max_records_per_student').notNull().default(1),
  scoreEnabled: integer('score_enabled', { mode: 'boolean' }).notNull().default(false),
  createdById: integer('created_by_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('practice_tasks_start_at_idx').on(table.startAt),
  index('practice_tasks_end_at_idx').on(table.endAt),
  index('practice_tasks_created_by_idx').on(table.createdById),
  index('practice_tasks_created_at_idx').on(table.createdAt)
]);

export const practiceTaskClasses = sqliteTable('practice_task_classes', {
  taskId: integer('task_id').notNull().references(() => practiceTasks.id, { onDelete: 'cascade' }),
  classId: integer('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.taskId, table.classId] }),
  index('practice_task_classes_task_idx').on(table.taskId),
  index('practice_task_classes_class_idx').on(table.classId)
]);

export const practiceRecords = sqliteTable('practice_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').references(() => practiceTasks.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => users.id),
  studentUidSnapshot: integer('student_uid_snapshot'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  practiceDate: text('practice_date').notNull(),
  location: text('location'),
  duration: real('duration').notNull(),
  imagePaths: text('image_paths').notNull().default('[]'),
  coverImagePath: text('cover_image_path'),
  status: text('status').notNull(),
  teacherComment: text('teacher_comment'),
  score: integer('score'),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('practice_records_task_idx').on(table.taskId),
  index('practice_records_student_idx').on(table.studentId),
  index('practice_records_task_student_idx').on(table.taskId, table.studentId),
  index('practice_records_task_score_idx').on(table.taskId, table.score),
  index('practice_records_cover_image_path_idx').on(table.coverImagePath),
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

export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  lastAttemptAt: integer('last_attempt_at').notNull(),
  lockedUntil: integer('locked_until')
});

export const tempUploadDeletions = sqliteTable('temp_upload_deletions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filePath: text('file_path').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('temp_upload_deletions_file_path_unique').on(table.filePath),
  index('temp_upload_deletions_expires_at_idx').on(table.expiresAt)
]);
