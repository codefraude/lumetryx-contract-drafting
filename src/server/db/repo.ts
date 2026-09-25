import "server-only";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { FieldState } from "@/server/fields/state";
import { env } from "@/server/env";
import { getDb } from "@/server/db/client";
import {
  documents,
  messages,
  sessions,
  type DraftStatus,
} from "@/server/db/schema";

export class StaleRevisionError extends Error {
  constructor(what: string) {
    super(
      `${what} changed since you loaded it. Reload to get the latest version.`,
    );

    this.name = "StaleRevisionError";
  }
}

export const retention = () => {
  return sql`now() + make_interval(days => ${env().DRAFT_RETENTION_DAYS})`;
};

const saved = () => {
  return {
    savedAt: sql`now()`,
    expiresAt: retention(),
    updatedAt: new Date(),
  };
};

const live = () => {
  return gt(documents.expiresAt, sql`now()`);
};

const owned = (sessionId: string, documentId: string) => {
  return and(
    eq(documents.id, documentId),
    eq(documents.sessionId, sessionId),
    live(),
  );
};

const docSummary = {
  id: documents.id,
  filename: documents.filename,
  title: documents.title,
  templateHash: documents.templateHash,
  workingRevision: documents.workingRevision,
  fieldState: documents.fieldState,
  fieldsVersion: documents.fieldsVersion,
  draftStatus: documents.draftStatus,
  draftFieldsVersion: documents.draftFieldsVersion,
  analysis: documents.analysis,
  updatedAt: documents.updatedAt,
  savedAt: documents.savedAt,
  expiresAt: documents.expiresAt,
};

type RawSummary = { fieldState: unknown } & Record<string, unknown>;

const withState = <T extends RawSummary>(row: T) => {
  return {
    ...row,
    fieldState: FieldState.parse(row.fieldState),
  };
};

export type DocumentSummary = NonNullable<
  Awaited<ReturnType<typeof getDocument>>
>;

export async function createDocument(input: {
  sessionId: string;
  filename: string;
  title: string;
  templateHash: string;
  originalDocx: Buffer;
  fieldState: FieldState;
  analysis: "ai" | "markers_only";
  workingDocx?: Buffer | null;
  workingRevision?: number;
  draftStatus?: DraftStatus;
  draftFieldsVersion?: number | null;
  fieldsVersion?: number;
}) {
  const [row] = await getDb()
    .insert(documents)
    .values({
      ...input,
      expiresAt: retention(),
    })
    .returning(docSummary);

  if (!row) {
    throw new Error("The draft was not saved.");
  }

  return withState(row);
}

export async function getDocument(sessionId: string, documentId: string) {
  const [row] = await getDb()
    .select(docSummary)
    .from(documents)
    .where(owned(sessionId, documentId))
    .limit(1);

  return row ? withState(row) : null;
}

export async function getLatestDocument(sessionId: string) {
  const [row] = await getDb()
    .select(docSummary)
    .from(documents)
    .where(and(eq(documents.sessionId, sessionId), live()))
    .orderBy(desc(documents.savedAt))
    .limit(1);

  return row ? withState(row) : null;
}

export async function listDocuments(sessionId: string) {
  const rows = await getDb()
    .select({
      id: documents.id,
      title: documents.title,
      filename: documents.filename,
      templateHash: documents.templateHash,
      savedAt: documents.savedAt,
      expiresAt: documents.expiresAt,
      draftStatus: documents.draftStatus,
      draftFieldsVersion: documents.draftFieldsVersion,
      fieldsVersion: documents.fieldsVersion,
      updatedAt: documents.updatedAt,
      fieldState: documents.fieldState,
    })
    .from(documents)
    .where(and(eq(documents.sessionId, sessionId), live()))
    .orderBy(desc(documents.savedAt))
    .limit(100);

  return rows.map(withState);
}

export async function getDocumentBytes(sessionId: string, documentId: string) {
  const [row] = await getDb()
    .select({
      originalDocx: documents.originalDocx,
      workingDocx: documents.workingDocx,
      workingRevision: documents.workingRevision,
      filename: documents.filename,
      title: documents.title,
      templateHash: documents.templateHash,
    })
    .from(documents)
    .where(owned(sessionId, documentId))
    .limit(1);

  return row ?? null;
}

export async function updateFieldState(
  sessionId: string,
  documentId: string,
  expectedVersion: number,
  state: FieldState,
) {
  const [row] = await getDb()
    .update(documents)
    .set({
      fieldState: state,
      fieldsVersion: expectedVersion + 1,
      ...saved(),
    })
    .where(
      and(
        owned(sessionId, documentId),
        eq(documents.fieldsVersion, expectedVersion),
      ),
    )
    .returning(docSummary);

  if (!row) {
    throw new StaleRevisionError("The answers");
  }

  return withState(row);
}

export async function beginDraft(
  sessionId: string,
  documentId: string,
  fieldsVersion: number,
) {
  const [row] = await getDb()
    .update(documents)
    .set({
      draftStatus: "generating" satisfies DraftStatus,
      updatedAt: new Date(),
    })
    .where(
      and(
        owned(sessionId, documentId),
        eq(documents.fieldsVersion, fieldsVersion),
      ),
    )
    .returning({ workingRevision: documents.workingRevision });

  if (!row) {
    throw new StaleRevisionError("The answers");
  }

  return row;
}

export async function finishDraft(
  sessionId: string,
  documentId: string,
  input: {
    fieldsVersion: number;
    bytes: Buffer;
    state: FieldState;
  },
) {
  const [row] = await getDb()
    .update(documents)
    .set({
      workingDocx: input.bytes,
      workingRevision: sql`${documents.workingRevision} + 1`,
      draftStatus: "ready" satisfies DraftStatus,
      draftFieldsVersion: input.fieldsVersion + 1,
      fieldState: input.state,
      fieldsVersion: input.fieldsVersion + 1,
      ...saved(),
    })
    .where(
      and(
        owned(sessionId, documentId),
        eq(documents.fieldsVersion, input.fieldsVersion),
        eq(documents.draftStatus, "generating"),
      ),
    )
    .returning(docSummary);

  if (!row) {
    throw new StaleRevisionError("The draft");
  }

  return withState(row);
}

export async function abandonDraft(sessionId: string, documentId: string) {
  await getDb()
    .update(documents)
    .set({
      draftStatus: sql`CASE WHEN ${documents.workingDocx} IS NULL THEN 'none' ELSE 'ready' END`,
    })
    .where(
      and(
        owned(sessionId, documentId),
        eq(documents.draftStatus, "generating"),
      ),
    );
}

export async function saveWorkingDocx(
  sessionId: string,
  documentId: string,
  expectedRevision: number,
  bytes: Buffer,
  opts: {
    state?: FieldState;
    draftCurrent?: boolean;
    expectedFieldsVersion?: number;
  } = {},
) {
  const { state, draftCurrent = false, expectedFieldsVersion } = opts;
  const [row] = await getDb()
    .update(documents)
    .set({
      workingDocx: bytes,
      workingRevision: expectedRevision + 1,
      ...saved(),
      ...(state
        ? {
            fieldState: state,
            fieldsVersion: sql`${documents.fieldsVersion} + 1`,
          }
        : {}),
      ...(state && draftCurrent
        ? { draftFieldsVersion: sql`${documents.fieldsVersion} + 1` }
        : {}),
    })
    .where(
      and(
        owned(sessionId, documentId),
        eq(documents.workingRevision, expectedRevision),
        eq(documents.draftStatus, "ready"),
        ...(expectedFieldsVersion !== undefined
          ? [eq(documents.fieldsVersion, expectedFieldsVersion)]
          : []),
      ),
    )
    .returning(docSummary);

  if (!row) {
    throw new StaleRevisionError("The draft");
  }

  return withState(row);
}

export async function renameDocument(
  sessionId: string,
  documentId: string,
  title: string,
) {
  const [row] = await getDb()
    .update(documents)
    .set({
      title,
      ...saved(),
    })
    .where(owned(sessionId, documentId))
    .returning({ id: documents.id });

  return Boolean(row);
}

export async function deleteDocument(sessionId: string, documentId: string) {
  const [row] = await getDb()
    .delete(documents)
    .where(
      and(eq(documents.id, documentId), eq(documents.sessionId, sessionId)),
    )
    .returning({
      id: documents.id,
      templateHash: documents.templateHash,
    });

  return row ?? null;
}

export async function addMessage(
  documentId: string,
  role: "user" | "assistant",
  content: string,
) {
  const db = getDb();

  await db.insert(messages).values({
    documentId,
    role,
    content,
  });

  await db
    .update(documents)
    .set({
      savedAt: sql`now()`,
      expiresAt: retention(),
    })
    .where(eq(documents.id, documentId));
}

export async function listMessages(
  sessionId: string,
  documentId: string,
  limit = 200,
) {
  const rows = await getDb()
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(documents, eq(messages.documentId, documents.id))
    .where(
      and(
        eq(messages.documentId, documentId),
        eq(documents.sessionId, sessionId),
        live(),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.reverse();
}

export async function recentMessages(documentId: string, limit: number) {
  const rows = await getDb()
    .select({
      role: messages.role,
      content: messages.content,
    })
    .from(messages)
    .where(eq(messages.documentId, documentId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.reverse();
}

export async function copyMessages(
  fromDocumentId: string,
  toDocumentId: string,
) {
  const rows = await getDb()
    .select({
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.documentId, fromDocumentId))
    .orderBy(messages.createdAt);

  if (rows.length) {
    await getDb()
      .insert(messages)
      .values(
        rows.map((r) => ({
          ...r,
          documentId: toDocumentId,
        })),
      );
  }
}

export async function deleteExpired(batch = 500) {
  const db = getDb();
  const expired = await db
    .select({
      id: documents.id,
      sessionId: documents.sessionId,
      templateHash: documents.templateHash,
    })
    .from(documents)
    .where(lt(documents.expiresAt, sql`now()`))
    .limit(batch);

  if (expired.length) {
    await db.delete(documents).where(
      inArray(
        documents.id,
        expired.map((d) => d.id),
      ),
    );
  }

  const gone = await db
    .delete(sessions)
    .where(
      and(
        lt(sessions.expiresAt, sql`now()`),
        sql`NOT EXISTS (SELECT 1 FROM ${documents} WHERE ${documents.sessionId} = ${sessions.id})`,
      ),
    )
    .returning({ id: sessions.id });

  return {
    documents: expired,
    sessions: gone.length,
  };
}
