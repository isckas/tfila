CREATE TYPE "public"."day_rule" AS ENUM('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'shabbos', 'weekday', 'rosh_chodesh', 'yom_tov', 'specific_date');--> statement-breakpoint
CREATE TYPE "public"."edit_status" AS ENUM('pending', 'approved', 'rejected', 'auto_applied');--> statement-breakpoint
CREATE TYPE "public"."scrape_status" AS ENUM('success', 'no_change', 'needs_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."service" AS ENUM('shacharis', 'mincha', 'maariv', 'candles', 'havdalah', 'selichos', 'other');--> statement-breakpoint
CREATE TYPE "public"."source_platform" AS ENUM('shulcloud', 'shulspace', 'shulhub', 'wix', 'manual', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."time_kind" AS ENUM('fixed', 'relative_sunrise', 'relative_sunset', 'relative_plag', 'relative_chatzos');--> statement-breakpoint
CREATE TABLE "edit_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"shul_id" integer NOT NULL,
	"minyan_id" integer,
	"proposed_by" integer,
	"proposed_by_name" text,
	"proposed_by_email" text,
	"payload" jsonb NOT NULL,
	"rationale" text,
	"status" "edit_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minyanim" (
	"id" serial PRIMARY KEY NOT NULL,
	"shul_id" integer NOT NULL,
	"service" "service" NOT NULL,
	"day_rule" "day_rule" NOT NULL,
	"specific_date" timestamp with time zone,
	"time_kind" time_kind NOT NULL,
	"time_fixed" varchar(5),
	"time_offset_minutes" integer,
	"nusach" varchar(32),
	"notes" text,
	"source_run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"shul_id" integer NOT NULL,
	"platform" "source_platform" NOT NULL,
	"status" "scrape_status" NOT NULL,
	"raw_payload" jsonb,
	"parsed" jsonb,
	"diff" jsonb,
	"error" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shuls" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"region" text,
	"country" varchar(2),
	"postal_code" varchar(16),
	"lat" double precision,
	"lon" double precision,
	"timezone" varchar(64),
	"nusach" varchar(32),
	"denomination" varchar(32),
	"website" text,
	"phone" text,
	"email" text,
	"source_platform" "source_platform" DEFAULT 'unknown',
	"scrape_url" text,
	"scrape_enabled" boolean DEFAULT true NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" text,
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"trust_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_shul_id_shuls_id_fk" FOREIGN KEY ("shul_id") REFERENCES "public"."shuls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_minyan_id_minyanim_id_fk" FOREIGN KEY ("minyan_id") REFERENCES "public"."minyanim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minyanim" ADD CONSTRAINT "minyanim_shul_id_shuls_id_fk" FOREIGN KEY ("shul_id") REFERENCES "public"."shuls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_shul_id_shuls_id_fk" FOREIGN KEY ("shul_id") REFERENCES "public"."shuls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edit_proposals_shul_idx" ON "edit_proposals" USING btree ("shul_id","status");--> statement-breakpoint
CREATE INDEX "minyanim_shul_idx" ON "minyanim" USING btree ("shul_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_shul_idx" ON "scrape_runs" USING btree ("shul_id","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shuls_slug_idx" ON "shuls" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "shuls_country_city_idx" ON "shuls" USING btree ("country","city");--> statement-breakpoint
CREATE INDEX "shuls_geo_idx" ON "shuls" USING btree ("lat","lon");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");