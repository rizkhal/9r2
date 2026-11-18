ALTER TABLE `buckets` ADD `kind` text DEFAULT 'binding' NOT NULL;--> statement-breakpoint
ALTER TABLE `buckets` ADD `bucket_name` text;--> statement-breakpoint
ALTER TABLE `buckets` ADD `endpoint` text;--> statement-breakpoint
ALTER TABLE `buckets` ADD `region` text;--> statement-breakpoint
ALTER TABLE `buckets` ADD `access_key_id_encrypted` text;--> statement-breakpoint
ALTER TABLE `buckets` ADD `secret_access_key_encrypted` text;