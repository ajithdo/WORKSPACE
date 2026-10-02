CREATE TABLE `ai_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`input` text NOT NULL,
	`output` text NOT NULL,
	`model` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_reports_project` ON `ai_reports` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `site_urls` text DEFAULT '{}' NOT NULL;