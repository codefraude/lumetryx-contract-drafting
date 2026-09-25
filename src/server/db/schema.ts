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

const bytea = customType<{
  data: Buffer;
  driverData: Buffer;
}>({
  dataType: () => "bytea",
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  secretHash: text("secret_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
    title: text("title").notNull().default(""),
    templateHash: text("template_hash").notNull(),
    originalDocx: bytea("original_docx").notNull(),
    workingDocx: bytea("working_docx"),
    workingRevision: integer("working_revision").notNull().default(0),
    fieldState: jsonb("field_state").$type<FieldState>().notNull(),
    fieldsVersion: integer("fields_version").notNull().default(1),
    draftStatus: text("draft_status")
      .$type<DraftStatus>()
      .notNull()
      .default("none"),
    draftFieldsVersion: integer("draft_fields_version"),
    analysis: text("analysis").$type<"ai" | "markers_only">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
