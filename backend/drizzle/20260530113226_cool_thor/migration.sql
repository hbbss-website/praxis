CREATE TABLE `class_students` (
	`class_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `class_students_pk` PRIMARY KEY(`class_id`, `student_id`),
	CONSTRAINT `fk_class_students_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_class_students_student_id_users_id_fk` FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `class_teachers` (
	`class_id` integer NOT NULL,
	`teacher_id` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `class_teachers_pk` PRIMARY KEY(`class_id`, `teacher_id`),
	CONSTRAINT `fk_class_teachers_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_class_teachers_teacher_id_users_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`cid` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_notifications_student_id_users_id_fk` FOREIGN KEY (`student_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `practice_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`task_id` integer,
	`student_id` integer NOT NULL,
	`student_uid_snapshot` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`practice_date` text NOT NULL,
	`location` text,
	`duration` real NOT NULL,
	`image_paths` text DEFAULT '[]' NOT NULL,
	`cover_image_path` text,
	`status` text NOT NULL,
	`teacher_comment` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_practice_records_task_id_practice_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `practice_tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_practice_records_student_id_users_id_fk` FOREIGN KEY (`student_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `practice_task_classes` (
	`task_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `practice_task_classes_pk` PRIMARY KEY(`task_id`, `class_id`),
	CONSTRAINT `fk_practice_task_classes_task_id_practice_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `practice_tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_practice_task_classes_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `practice_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`description` text,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`min_words` integer DEFAULT 0 NOT NULL,
	`min_images` integer DEFAULT 0 NOT NULL,
	`max_records_per_student` integer DEFAULT 1 NOT NULL,
	`created_by_id` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_practice_tasks_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `teacher_students` (
	`teacher_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `teacher_students_pk` PRIMARY KEY(`teacher_id`, `student_id`),
	CONSTRAINT `fk_teacher_students_teacher_id_users_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_teacher_students_student_id_users_id_fk` FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `temp_upload_deletions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`file_path` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`uid` text NOT NULL,
	`password` text NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`name_initials` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_students_student_unique` ON `class_students` (`student_id`);--> statement-breakpoint
CREATE INDEX `class_students_class_idx` ON `class_students` (`class_id`);--> statement-breakpoint
CREATE INDEX `class_teachers_class_idx` ON `class_teachers` (`class_id`);--> statement-breakpoint
CREATE INDEX `class_teachers_teacher_idx` ON `class_teachers` (`teacher_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `classes_cid_unique` ON `classes` (`cid`);--> statement-breakpoint
CREATE INDEX `classes_created_at_idx` ON `classes` (`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_student_idx` ON `notifications` (`student_id`);--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `practice_records_task_idx` ON `practice_records` (`task_id`);--> statement-breakpoint
CREATE INDEX `practice_records_student_idx` ON `practice_records` (`student_id`);--> statement-breakpoint
CREATE INDEX `practice_records_task_student_idx` ON `practice_records` (`task_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `practice_records_cover_image_path_idx` ON `practice_records` (`cover_image_path`);--> statement-breakpoint
CREATE INDEX `practice_records_status_idx` ON `practice_records` (`status`);--> statement-breakpoint
CREATE INDEX `practice_records_practice_date_idx` ON `practice_records` (`practice_date`);--> statement-breakpoint
CREATE INDEX `practice_records_created_at_idx` ON `practice_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `practice_task_classes_task_idx` ON `practice_task_classes` (`task_id`);--> statement-breakpoint
CREATE INDEX `practice_task_classes_class_idx` ON `practice_task_classes` (`class_id`);--> statement-breakpoint
CREATE INDEX `practice_tasks_start_at_idx` ON `practice_tasks` (`start_at`);--> statement-breakpoint
CREATE INDEX `practice_tasks_end_at_idx` ON `practice_tasks` (`end_at`);--> statement-breakpoint
CREATE INDEX `practice_tasks_created_by_idx` ON `practice_tasks` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `practice_tasks_created_at_idx` ON `practice_tasks` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_students_student_unique` ON `teacher_students` (`student_id`);--> statement-breakpoint
CREATE INDEX `teacher_students_teacher_idx` ON `teacher_students` (`teacher_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `temp_upload_deletions_file_path_unique` ON `temp_upload_deletions` (`file_path`);--> statement-breakpoint
CREATE INDEX `temp_upload_deletions_expires_at_idx` ON `temp_upload_deletions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_uid_unique` ON `users` (`uid`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_name_initials_idx` ON `users` (`name_initials`);--> statement-breakpoint
CREATE INDEX `users_deleted_at_idx` ON `users` (`deleted_at`);