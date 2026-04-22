CREATE TYPE "public"."emotional_state" AS ENUM('calm', 'fomo', 'revenge', 'bored', 'anxious', 'confident');--> statement-breakpoint
CREATE TYPE "public"."tag_kind" AS ENUM('setup', 'mistake');--> statement-breakpoint
CREATE TABLE "mistake_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"color" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mistake_tag_unique_label" UNIQUE("user_id","label")
);
--> statement-breakpoint
CREATE TABLE "position_reflection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"position_id" text NOT NULL,
	"confidence" integer,
	"emotional_state" "emotional_state",
	"reflection_markdown" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_reflection_unique" UNIQUE("user_id","position_id")
);
--> statement-breakpoint
CREATE TABLE "position_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"position_id" text NOT NULL,
	"kind" "tag_kind" NOT NULL,
	"setup_tag_id" text,
	"mistake_tag_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_tag_unique" UNIQUE("position_id","kind","setup_tag_id","mistake_tag_id")
);
--> statement-breakpoint
CREATE TABLE "setup_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"color" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_tag_unique_label" UNIQUE("user_id","label")
);
--> statement-breakpoint
CREATE TABLE "trade_note" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"position_id" text NOT NULL,
	"body_markdown" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_note_unique_position" UNIQUE("user_id","position_id")
);
--> statement-breakpoint
ALTER TABLE "mistake_tag" ADD CONSTRAINT "mistake_tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_reflection" ADD CONSTRAINT "position_reflection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_reflection" ADD CONSTRAINT "position_reflection_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_tag" ADD CONSTRAINT "position_tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_tag" ADD CONSTRAINT "position_tag_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_tag" ADD CONSTRAINT "position_tag_setup_tag_id_setup_tag_id_fk" FOREIGN KEY ("setup_tag_id") REFERENCES "public"."setup_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_tag" ADD CONSTRAINT "position_tag_mistake_tag_id_mistake_tag_id_fk" FOREIGN KEY ("mistake_tag_id") REFERENCES "public"."mistake_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_tag" ADD CONSTRAINT "setup_tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_note" ADD CONSTRAINT "trade_note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_note" ADD CONSTRAINT "trade_note_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mistake_tag_user_idx" ON "mistake_tag" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "position_tag_position_idx" ON "position_tag" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "setup_tag_user_idx" ON "setup_tag" USING btree ("user_id");