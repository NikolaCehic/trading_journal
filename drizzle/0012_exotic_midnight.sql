CREATE TYPE "public"."candle_interval" AS ENUM('5m', '15m', '1h', '4h', '1d');--> statement-breakpoint
CREATE TABLE "market_candle" (
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"interval" "candle_interval" NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"open" numeric(20, 8) NOT NULL,
	"high" numeric(20, 8) NOT NULL,
	"low" numeric(20, 8) NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"volume" numeric(28, 8) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_candle_exchange_symbol_interval_open_time_pk" PRIMARY KEY("exchange","symbol","interval","open_time")
);
--> statement-breakpoint
CREATE INDEX "market_candle_symbol_interval_idx" ON "market_candle" USING btree ("symbol","interval","open_time");