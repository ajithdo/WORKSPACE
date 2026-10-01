CREATE TABLE `action_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`communication_id` integer NOT NULL,
	`text` text NOT NULL,
	`owner_member_id` integer,
	`due_date` text,
	`task_instance_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`communication_id`) REFERENCES `communications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_instance_id`) REFERENCES `task_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `adjustment_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`task_instance_id` integer,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`reason` text NOT NULL,
	`requested_by` integer NOT NULL,
	`requested_at` text NOT NULL,
	`status` text NOT NULL,
	`decided_by` integer,
	`decided_at` text,
	`decision_note` text,
	`dispute_id` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_instance_id`) REFERENCES `task_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `adjustments_project` ON `adjustment_requests` (`project_id`);--> statement-breakpoint
CREATE TABLE `approval_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` integer NOT NULL,
	`round` integer NOT NULL,
	`member_id` integer NOT NULL,
	`decision` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_votes_unique` ON `approval_votes` (`subject_type`,`subject_id`,`round`,`member_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor_member_id` integer,
	`actor_label` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`project_id` integer,
	`before` text,
	`after` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_project` ON `audit_log` (`project_id`);--> statement-breakpoint
CREATE INDEX `audit_entity` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `category_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_version_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`phase` text NOT NULL,
	`is_communication` integer NOT NULL,
	`is_sales` integer NOT NULL,
	`is_business_level` integer NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`library_version_id`) REFERENCES `library_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_templates_version_code` ON `category_templates` (`library_version_id`,`code`);--> statement-breakpoint
CREATE TABLE `change_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`number` text NOT NULL,
	`description` text NOT NULL,
	`requested_by_client_name` text DEFAULT '' NOT NULL,
	`requested_at` text NOT NULL,
	`classification` text DEFAULT 'change' NOT NULL,
	`estimate_hours` real,
	`price_ex_gst` integer DEFAULT 0 NOT NULL,
	`timeline_impact_days` integer DEFAULT 0 NOT NULL,
	`no_charge` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`assessed_by` integer,
	`approval_evidence_id` integer,
	`invoice_id` integer,
	`decline_reason` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assessed_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_requests_project_number` ON `change_requests` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `client_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_instance_id` integer NOT NULL,
	`status` text NOT NULL,
	`requested_at` text,
	`approved_by_name` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`channel` text,
	`evidence_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`updated_by` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_instance_id`) REFERENCES `task_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_approvals_task_instance_id_unique` ON `client_approvals` (`task_instance_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_name` text NOT NULL,
	`gstin` text DEFAULT '' NOT NULL,
	`state_code` text DEFAULT '' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`contact_phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `closure_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`item_index` integer NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`done_by` integer,
	`done_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`done_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `closure_items_project_index` ON `closure_items` (`project_id`,`item_index`);--> statement-breakpoint
CREATE TABLE `communications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_for` text,
	`occurred_at` text,
	`channel` text,
	`duration_minutes` integer,
	`lead_member_id` integer NOT NULL,
	`second_member_id` integer,
	`second_required` integer DEFAULT false NOT NULL,
	`attendee_member_ids` text NOT NULL,
	`client_attendees` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`decisions` text NOT NULL,
	`notes_sent_to_client` integer DEFAULT false NOT NULL,
	`multiplier` real DEFAULT 1 NOT NULL,
	`split_parties` text,
	`logged_by` integer,
	`logged_at` text,
	`verified_by` integer,
	`verified_at` text,
	`rejection_reason` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`second_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`logged_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `communications_project` ON `communications` (`project_id`);--> statement-breakpoint
CREATE TABLE `config_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`data` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	`activated_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_versions_version_unique` ON `config_versions` (`version`);--> statement-breakpoint
CREATE TABLE `contribution_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`seq` integer NOT NULL,
	`period` text NOT NULL,
	`status` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`inputs` text NOT NULL,
	`params` text NOT NULL,
	`outputs` text NOT NULL,
	`hash` text NOT NULL,
	`calc_version` integer NOT NULL,
	`config_version_id` integer NOT NULL,
	`previous_snapshot_id` integer,
	`post_lock_adjustment_id` integer,
	`created_by` integer,
	`created_at` text NOT NULL,
	`locked_at` text,
	`rejected_reason` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`config_version_id`) REFERENCES `config_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_project_seq` ON `contribution_snapshots` (`project_id`,`seq`);--> statement-breakpoint
CREATE TABLE `dispute_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dispute_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`raised_by` integer NOT NULL,
	`raised_at` text NOT NULL,
	`reason_code` text NOT NULL,
	`description` text NOT NULL,
	`proposed_resolution` text,
	`proposed_payload` text,
	`proposed_by` integer,
	`proposed_at` text,
	`status` text NOT NULL,
	`resolution` text,
	`resolution_payload` text,
	`resolution_note` text,
	`resolved_at` text,
	`resolved_by_both` integer DEFAULT false NOT NULL,
	`default_due_at` text NOT NULL,
	`escalated_at` text,
	`escalated_by` integer,
	`escalation_note` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raised_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`escalated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `disputes_project_status` ON `disputes` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `disputes_target` ON `disputes` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `distributions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`reimbursement` integer NOT NULL,
	`base_share` integer NOT NULL,
	`pool_share` integer NOT NULL,
	`total` integer NOT NULL,
	`shortfall` integer DEFAULT 0 NOT NULL,
	`paid_on` text,
	`bank_reference` text,
	`recorded_by` integer,
	`recorded_at` text,
	FOREIGN KEY (`snapshot_id`) REFERENCES `contribution_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` integer NOT NULL,
	`submission_round` integer DEFAULT 1 NOT NULL,
	`submitted_by` integer NOT NULL,
	`submitted_at` text NOT NULL,
	`type` text NOT NULL,
	`strength` text NOT NULL,
	`url` text,
	`file_id` integer,
	`external_ref` text,
	`description` text NOT NULL,
	`captured_at` text,
	`sha256` text,
	`contains_personal_data` integer DEFAULT false NOT NULL,
	`redacted` integer DEFAULT false NOT NULL,
	`no_secrets_confirmed` integer NOT NULL,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`verified_by` integer,
	`verified_at` text,
	`rejection_reason` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_subject` ON `evidence` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`expense_date` text NOT NULL,
	`vendor` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`gst_paid` integer DEFAULT 0 NOT NULL,
	`paid_by_member_id` integer,
	`reimbursable` integer DEFAULT true NOT NULL,
	`billable_to_client` integer DEFAULT false NOT NULL,
	`receipt_file_id` integer,
	`status` text NOT NULL,
	`approved_by` integer,
	`approved_at` text,
	`rejection_reason` text,
	`accepted_amount` integer,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expenses_project` ON `expenses` (`project_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`uploaded_by` integer NOT NULL,
	`uploaded_at` text NOT NULL,
	`visibility` text DEFAULT 'internal' NOT NULL,
	`retention_until` text,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `files_project` ON `files` (`project_id`);--> statement-breakpoint
CREATE TABLE `handover_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`code` text NOT NULL,
	`status` text NOT NULL,
	`owner_confirmed` text DEFAULT '' NOT NULL,
	`credentials_exist` integer DEFAULT false NOT NULL,
	`credentials_rotated` integer DEFAULT false NOT NULL,
	`rotated_on` text,
	`developer_access` text,
	`retained_reason` text,
	`notes` text DEFAULT '' NOT NULL,
	`updated_by` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handover_project_code` ON `handover_items` (`project_id`,`code`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`number` text NOT NULL,
	`fy_label` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`acceptance_date` text NOT NULL,
	`amount_ex_gst` integer NOT NULL,
	`gst_rate_bp` integer NOT NULL,
	`cgst` integer NOT NULL,
	`sgst` integer NOT NULL,
	`igst` integer NOT NULL,
	`total` integer NOT NULL,
	`tds_expected_rate_bp` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`msme_due_date` text,
	`file_id` integer,
	`change_request_id` integer,
	`milestone_code` text,
	`notes` text DEFAULT '' NOT NULL,
	`written_off_reason` text,
	`cancelled_reason` text,
	`sent_at` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_unique` ON `invoices` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_fy_seq` ON `invoices` (`fy_label`,`seq`);--> statement-breakpoint
CREATE INDEX `invoices_project` ON `invoices` (`project_id`);--> statement-breakpoint
CREATE TABLE `library_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	`activated_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_versions_version_unique` ON `library_versions` (`version`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`roles` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`received_date` text NOT NULL,
	`amount_received` integer NOT NULL,
	`tds_deducted` integer DEFAULT 0 NOT NULL,
	`gst_component` integer NOT NULL,
	`revenue_ex_gst` integer NOT NULL,
	`bank_reference` text NOT NULL,
	`mode` text NOT NULL,
	`recorded_by` integer NOT NULL,
	`recorded_at` text NOT NULL,
	`verified_by` integer,
	`verified_at` text,
	`tds_certificate_status` text NOT NULL,
	`tds_certificate_file_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tds_certificate_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_invoice` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `payments_project` ON `payments` (`project_id`);--> statement-breakpoint
CREATE TABLE `post_lock_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`period` text NOT NULL,
	`reason` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`requested_by` integer NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`snapshot_id` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`project_id`, `member_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`project_type` text NOT NULL,
	`multilingual` integer DEFAULT false NOT NULL,
	`client_id` integer,
	`originated_by` integer,
	`library_version_id` integer NOT NULL,
	`config_version_id` integer NOT NULL,
	`plan_status` text NOT NULL,
	`plan_round` integer DEFAULT 1 NOT NULL,
	`plan_submitted_by` integer,
	`plan_locked_at` text,
	`close_status` text NOT NULL,
	`closed_at` text,
	`start_date` text,
	`target_launch_date` text,
	`quoted_amount_ex_gst` integer DEFAULT 0 NOT NULL,
	`gst_registered` integer DEFAULT false NOT NULL,
	`gst_rate_bp` integer DEFAULT 1800 NOT NULL,
	`sac_code` text DEFAULT '998314' NOT NULL,
	`place_of_supply_state` text DEFAULT '' NOT NULL,
	`msme_applicable` integer DEFAULT false NOT NULL,
	`deemed_acceptance_clause` integer DEFAULT false NOT NULL,
	`deemed_acceptance_days` integer,
	`payment_schedule` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`originated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`library_version_id`) REFERENCES `library_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`config_version_id`) REFERENCES `config_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_submitted_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code_unique` ON `projects` (`code`);--> statement-breakpoint
CREATE TABLE `reserve_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_date` text NOT NULL,
	`project_id` integer,
	`amount` integer NOT NULL,
	`direction` text NOT NULL,
	`purpose` text NOT NULL,
	`snapshot_id` integer,
	`status` text NOT NULL,
	`created_by` integer,
	`approved_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `contribution_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `retro_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	`addressed` integer DEFAULT false NOT NULL,
	`addressed_note` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_member_idx` ON `sessions` (`member_id`);--> statement-breakpoint
CREATE TABLE `studio` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`legal_name` text DEFAULT '' NOT NULL,
	`gstin` text DEFAULT '' NOT NULL,
	`state_code` text DEFAULT '' NOT NULL,
	`gst_registered` integer DEFAULT false NOT NULL,
	`msme_registered` integer DEFAULT false NOT NULL,
	`udyam_number` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`invoice_prefix` text DEFAULT 'INV' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_contributions` (
	`task_instance_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`share_bp` integer NOT NULL,
	PRIMARY KEY(`task_instance_id`, `member_id`),
	FOREIGN KEY (`task_instance_id`) REFERENCES `task_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`template_id` integer,
	`code` text NOT NULL,
	`category_code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`phase` text NOT NULL,
	`depends_on` text NOT NULL,
	`classification` text DEFAULT 'REC' NOT NULL,
	`complexity` text DEFAULT 'Low' NOT NULL,
	`client_approval` text DEFAULT 'No' NOT NULL,
	`deliverable` text DEFAULT '' NOT NULL,
	`evidence_expected` text DEFAULT '' NOT NULL,
	`default_points` real NOT NULL,
	`unit` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`adjustment_factor` real DEFAULT 1 NOT NULL,
	`multiplier` real DEFAULT 1 NOT NULL,
	`effort_mid_hours` real,
	`is_communication` integer DEFAULT false NOT NULL,
	`is_sales` integer DEFAULT false NOT NULL,
	`is_business_level` integer DEFAULT false NOT NULL,
	`own_defect` integer DEFAULT false NOT NULL,
	`defect_of_task_id` integer,
	`status` text NOT NULL,
	`origin` text DEFAULT 'plan' NOT NULL,
	`proposed_by` integer,
	`proposed_at` text,
	`auto_approve_at` text,
	`owner_member_id` integer,
	`started_at` text,
	`submitted_at` text,
	`submitted_by` integer,
	`submission_round` integer DEFAULT 0 NOT NULL,
	`verified_by` integer,
	`verified_at` text,
	`rejection_reason` text,
	`blocked_reason` text,
	`cancel_reason` text,
	`cancelled_at` text,
	`change_request_id` integer,
	`communication_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`locked_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `task_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_instances_project_code` ON `task_instances` (`project_id`,`code`);--> statement-breakpoint
CREATE INDEX `task_instances_project_status` ON `task_instances` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `task_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_version_id` integer NOT NULL,
	`code` text NOT NULL,
	`category_code` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`why` text NOT NULL,
	`phase_text` text NOT NULL,
	`phase` text NOT NULL,
	`depends_on` text NOT NULL,
	`prerequisites_text` text NOT NULL,
	`default_owner_role` text NOT NULL,
	`deliverable` text NOT NULL,
	`evidence_expected` text NOT NULL,
	`client_approval` text NOT NULL,
	`classification` text NOT NULL,
	`complexity` text NOT NULL,
	`effort_range` text NOT NULL,
	`effort_mid_hours` real,
	`unit` text,
	`default_points` integer NOT NULL,
	`risks` text NOT NULL,
	`common_mistakes` text NOT NULL,
	`if_skipped` text NOT NULL,
	`in_standard_project` text NOT NULL,
	`billable` text NOT NULL,
	`post_launch_maintenance` integer NOT NULL,
	`is_business_level` integer NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`library_version_id`) REFERENCES `library_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_templates_version_code` ON `task_templates` (`library_version_id`,`code`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_instance_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`work_date` text NOT NULL,
	`minutes` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_instance_id`) REFERENCES `task_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entries_task` ON `time_entries` (`task_instance_id`);