ALTER TABLE "position" ADD COLUMN "plan_snapshot_entry_price" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "position" ADD COLUMN "plan_snapshot_stop_price" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "position" ADD COLUMN "plan_snapshot_target_price" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "position" ADD COLUMN "plan_snapshot_size" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "position" ADD COLUMN "plan_snapshot_rationale" text;