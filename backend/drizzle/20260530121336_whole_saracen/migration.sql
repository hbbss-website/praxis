CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY,
	`count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer NOT NULL,
	`locked_until` integer
);
