CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"template_hash" text NOT NULL,
	"original_docx" "bytea" NOT NULL,
	"working_docx" "bytea",
	"working_revision" integer DEFAULT 0 NOT NULL,
	"field_state" jsonb NOT NULL,
	"fields_version" integer DEFAULT 1 NOT NULL,
	"draft_status" text DEFAULT 'none' NOT NULL,
	"draft_fields_version" integer,
	"analysis" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_requests" integer DEFAULT 0 NOT NULL,
	"ai_input_tokens" integer DEFAULT 0 NOT NULL,
	"ai_output_tokens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sessions_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_session_updated_idx" ON "documents" USING btree ("session_id","updated_at");--> statement-breakpoint
CREATE INDEX "messages_document_created_idx" ON "messages" USING btree ("document_id","created_at");