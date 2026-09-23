ALTER TABLE "documents" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "saved_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_expires_idx" ON "documents" USING btree ("expires_at");--> statement-breakpoint
-- Backfill existing rows from their own history rather than the migration time.
UPDATE "documents" SET "title" = regexp_replace("filename", '\.docx$', '', 'i'), "saved_at" = "updated_at", "expires_at" = "updated_at" + interval '30 days';--> statement-breakpoint
UPDATE "sessions" SET "expires_at" = "last_seen_at" + interval '30 days';
