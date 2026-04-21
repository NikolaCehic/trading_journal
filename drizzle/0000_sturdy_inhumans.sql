CREATE TYPE "public"."exchange_kind" AS ENUM('binance', 'hyperliquid');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'parsing', 'normalizing', 'deriving', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."normalize_status" AS ENUM('normalized', 'skipped', 'errored');--> statement-breakpoint
CREATE TYPE "public"."instrument_type" AS ENUM('spot', 'perp');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exchange" "exchange_kind" NOT NULL,
	"wallet_address" text,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exchange_account_id" text,
	"exchange" "exchange_kind" NOT NULL,
	"source" text NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"file_name" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"fill_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"error_detail" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_import_row" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"user_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"normalize_status" "normalize_status" DEFAULT 'normalized' NOT NULL,
	"normalize_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fill" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"instrument_type" "instrument_type" NOT NULL,
	"side" "side" NOT NULL,
	"price" numeric(36, 18) NOT NULL,
	"size" numeric(36, 18) NOT NULL,
	"fee" numeric(36, 18) DEFAULT '0' NOT NULL,
	"fee_currency" text NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"external_id" text NOT NULL,
	"raw_import_row_id" text,
	"normalizer_hint" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fill_user_exchange_external_id" UNIQUE("user_id","exchange","external_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_account" ADD CONSTRAINT "exchange_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_exchange_account_id_exchange_account_id_fk" FOREIGN KEY ("exchange_account_id") REFERENCES "public"."exchange_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_import_row" ADD CONSTRAINT "raw_import_row_import_id_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_import_row" ADD CONSTRAINT "raw_import_row_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fill" ADD CONSTRAINT "fill_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fill" ADD CONSTRAINT "fill_raw_import_row_id_raw_import_row_id_fk" FOREIGN KEY ("raw_import_row_id") REFERENCES "public"."raw_import_row"("id") ON DELETE no action ON UPDATE no action;