import "server-only";
import { PARSER_VERSION } from "@/server/ai/analyze";
import { cacheGet, cacheSet } from "@/server/cache/redis";
import * as repo from "@/server/db/repo";
import type { Block } from "@/server/docx/blocks";
import { loadDocxPackage } from "@/server/docx/package";
import { indexBlocks } from "@/server/docx/render";
import { NotFound } from "@/server/http/responses";

/** Loads a draft for the session that owns it; any other session gets "not found". */

export async function mustGet(sessionId: string, documentId: string) {
  const doc = await repo.getDocument(sessionId, documentId);
  if (!doc) throw new NotFound();
  return doc;
}

export async function mustGetBytes(sessionId: string, documentId: string) {
  const bytes = await repo.getDocumentBytes(sessionId, documentId);
  if (!bytes) throw new NotFound();
  return bytes;
}

/** Cache key of a template's parsed blocks (per session, template and parser version). */
export const blocksCacheKey = (sessionId: string, templateHash: string) => `lx:blocks:${sessionId}:${templateHash}:${PARSER_VERSION}`;

/** Parsed template blocks are cached per session + template hash + parser version. */
export async function templateBlocks(sessionId: string, templateHash: string, original: Uint8Array): Promise<Block[]> {
  const key = blocksCacheKey(sessionId, templateHash);
  const hit = await cacheGet<Block[]>(key, (raw) => raw as Block[]);
  if (hit) return hit;
  const rendered = await indexBlocks(await loadDocxPackage(original));
  const blocks: Block[] = rendered.map(({ runs: _runs, numberLabel: _n, headingLevel: _h, ...b }) => b);
  await cacheSet(key, blocks, 60 * 60 * 6);
  return blocks;
}
