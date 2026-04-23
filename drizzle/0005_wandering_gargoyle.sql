CREATE TABLE "day_of_week_metric" (
	"user_id" text NOT NULL,
	"day_of_week_utc" integer NOT NULL,
	"hour_of_day_utc" integer NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"realized_pnl" numeric(36, 18) DEFAULT '0' NOT NULL,
	"win_rate" numeric(8, 6) DEFAULT '0' NOT NULL,
	"expectancy" numeric(36, 18) DEFAULT '0' NOT NULL,
	"derivation_version" integer NOT NULL,
	CONSTRAINT "day_of_week_metric_user_id_day_of_week_utc_hour_of_day_utc_derivation_version_pk" PRIMARY KEY("user_id","day_of_week_utc","hour_of_day_utc","derivation_version")
);
--> statement-breakpoint
ALTER TABLE "day_of_week_metric" ADD CONSTRAINT "day_of_week_metric_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;