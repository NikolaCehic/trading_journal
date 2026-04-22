CREATE TYPE "public"."finding_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."position_fill_role" AS ENUM('open', 'add', 'reduce', 'close');--> statement-breakpoint
CREATE TYPE "public"."position_side" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TABLE "asset_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"realized_pnl" numeric(36, 18) DEFAULT '0' NOT NULL,
	"win_rate" numeric(8, 6) DEFAULT '0' NOT NULL,
	"avg_win" numeric(36, 18) DEFAULT '0' NOT NULL,
	"avg_loss" numeric(36, 18) DEFAULT '0' NOT NULL,
	"expectancy" numeric(36, 18) DEFAULT '0' NOT NULL,
	"derivation_version" integer NOT NULL,
	CONSTRAINT "asset_metric_unique" UNIQUE("user_id","symbol","derivation_version")
);
--> statement-breakpoint
CREATE TABLE "daily_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"realized_pnl" numeric(36, 18) DEFAULT '0' NOT NULL,
	"volume_usd" numeric(36, 18) DEFAULT '0' NOT NULL,
	"win_count" integer DEFAULT 0 NOT NULL,
	"loss_count" integer DEFAULT 0 NOT NULL,
	"total_fees" numeric(36, 18) DEFAULT '0' NOT NULL,
	"derivation_version" integer NOT NULL,
	CONSTRAINT "daily_metric_unique" UNIQUE("user_id","date","derivation_version")
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"detector_id" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"title" text NOT NULL,
	"body_markdown" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"referenced_position_ids" text[] DEFAULT '{}' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"derivation_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"instrument_type" "instrument_type" NOT NULL,
	"side" "position_side" NOT NULL,
	"entry_avg_price" numeric(36, 18) NOT NULL,
	"exit_avg_price" numeric(36, 18),
	"size" numeric(36, 18) NOT NULL,
	"notional_usd" numeric(36, 18) NOT NULL,
	"max_notional_usd" numeric(36, 18) NOT NULL,
	"realized_pnl" numeric(36, 18) DEFAULT '0' NOT NULL,
	"total_fees" numeric(36, 18) DEFAULT '0' NOT NULL,
	"funding_pnl" numeric(36, 18) DEFAULT '0' NOT NULL,
	"was_liquidated" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"derivation_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_fill" (
	"id" text PRIMARY KEY NOT NULL,
	"position_id" text NOT NULL,
	"fill_id" text NOT NULL,
	"role" "position_fill_role" NOT NULL,
	"derivation_version" integer NOT NULL,
	CONSTRAINT "position_fill_unique" UNIQUE("position_id","fill_id")
);
--> statement-breakpoint
CREATE TABLE "session_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"hour_of_day_utc" integer NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"realized_pnl" numeric(36, 18) DEFAULT '0' NOT NULL,
	"win_rate" numeric(8, 6) DEFAULT '0' NOT NULL,
	"expectancy" numeric(36, 18) DEFAULT '0' NOT NULL,
	"derivation_version" integer NOT NULL,
	CONSTRAINT "session_metric_unique" UNIQUE("user_id","hour_of_day_utc","derivation_version")
);
--> statement-breakpoint
CREATE TABLE "summary_rollup" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"total_pnl" numeric(36, 18) DEFAULT '0' NOT NULL,
	"gross_profit" numeric(36, 18) DEFAULT '0' NOT NULL,
	"gross_loss" numeric(36, 18) DEFAULT '0' NOT NULL,
	"total_fees" numeric(36, 18) DEFAULT '0' NOT NULL,
	"win_rate" numeric(8, 6) DEFAULT '0' NOT NULL,
	"expectancy" numeric(36, 18) DEFAULT '0' NOT NULL,
	"avg_win" numeric(36, 18) DEFAULT '0' NOT NULL,
	"avg_loss" numeric(36, 18) DEFAULT '0' NOT NULL,
	"profit_factor" numeric(18, 6),
	"max_drawdown" numeric(36, 18) DEFAULT '0' NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"median_position_size_usd" numeric(36, 18) DEFAULT '0' NOT NULL,
	"derivation_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_rollup_unique" UNIQUE("user_id","derivation_version")
);
--> statement-breakpoint
ALTER TABLE "asset_metric" ADD CONSTRAINT "asset_metric_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metric" ADD CONSTRAINT "daily_metric_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_fill" ADD CONSTRAINT "position_fill_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_fill" ADD CONSTRAINT "position_fill_fill_id_fill_id_fk" FOREIGN KEY ("fill_id") REFERENCES "public"."fill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_metric" ADD CONSTRAINT "session_metric_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_rollup" ADD CONSTRAINT "summary_rollup_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_user_detector_idx" ON "finding" USING btree ("user_id","detector_id");--> statement-breakpoint
CREATE INDEX "finding_user_version_idx" ON "finding" USING btree ("user_id","derivation_version");--> statement-breakpoint
CREATE INDEX "position_user_id_idx" ON "position" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "position_user_symbol_idx" ON "position" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "position_derivation_version_idx" ON "position" USING btree ("user_id","derivation_version");--> statement-breakpoint
CREATE INDEX "position_opened_at_idx" ON "position" USING btree ("user_id","opened_at");--> statement-breakpoint
CREATE INDEX "position_fill_fill_id_idx" ON "position_fill" USING btree ("fill_id");