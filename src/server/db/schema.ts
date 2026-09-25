import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { FieldState } from "@/server/fields/state";

/**
 * Raw DOCX bytes. Bounded by upload limits
 * (see DOCX_LIMITS); never cached in Redis.
 */
const bytea = customType<{
  data: Buffer;
  driverData: Buffer;
}>({
  dataType: () => "bytea",
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** SHA-256 of the cookie secret. The secret itself is never stored. */
  secretHash: text("secret_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /**
   * Sliding expiry, refreshed together with the
   * cookie's max-age on authorised activity.
   */
  expiresAt: timestamp("expires_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '30 days'`),
  aiRequests: integer("ai_requests").notNull().default(0),
  aiInputTokens: integer("ai_input_tokens").notNull().default(0),
  aiOutputTokens: integer("ai_output_tokens").notNull().default(0),
});

export type DraftStatus = "none" | "generating" | "ready";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    /** User-facing draft name (defaults to the template's file name). */
    title: text("title").notNull().default(""),
    templateHash: text("template_hash").notNull(),
    originalDocx: bytea("original_docx").notNull(),
    /** Latest editable draft; null until the first draft is generated. */
    workingDocx: bytea("working_docx"),
    workingRevision: integer("working_revision").notNull().default(0),
    fieldState: jsonb("field_state").$type<FieldState>().notNull(),
    fieldsVersion: integer("fields_version").notNull().default(1),
    draftStatus: text("draft_status")
      .$type<DraftStatus>()
      .notNull()
      .default("none"),
    /**
     * fieldsVersion used for the current draft; a draft is stale if it differs.
     */
    draftFieldsVersion: integer("draft_fields_version"),
    analysis: text("analysis").$type<"ai" | "markers_only">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Last successful save of anything in this
     * draft (answers, conversation, document).
     */
    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Retention: the draft is not served after
     * this and is removed by `npm run db:cleanup`.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (t) => [
    index("documents_session_updated_idx").on(t.sessionId, t.updatedAt),
    index("documents_expires_idx").on(t.expiresAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("messages_document_created_idx").on(t.documentId, t.createdAt)],
);
