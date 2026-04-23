CREATE TYPE "public"."detector_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TABLE "user_detector" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"severity" "detector_severity" NOT NULL,
	"predicate" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_detector" ADD CONSTRAINT "user_detector_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_detector_user_idx" ON "user_detector" USING btree ("user_id");