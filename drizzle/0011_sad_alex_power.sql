CREATE TYPE "public"."plan_side" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TABLE "trade_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"intended_side" "plan_side" NOT NULL,
	"entry_price" numeric(20, 8),
	"stop_price" numeric(20, 8),
	"target_price" numeric(20, 8),
	"planned_size" numeric(20, 8),
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "position" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "trade_plan" ADD CONSTRAINT "trade_plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trade_plan_user_symbol_idx" ON "trade_plan" USING btree ("user_id","symbol");--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_plan_id_trade_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."trade_plan"("id") ON DELETE set null ON UPDATE no action;