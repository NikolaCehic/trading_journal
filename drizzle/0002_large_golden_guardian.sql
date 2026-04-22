DROP INDEX "position_user_id_idx";--> statement-breakpoint
CREATE INDEX "position_fill_position_id_idx" ON "position_fill" USING btree ("position_id");