import { createHash } from "node:crypto";
import JSZip from "jszip";

export const DOCX_LIMITS = {
  maxCompressedBytes: 5 * 1024 * 1024,
  maxUncompressedBytes: 40 * 1024 * 1024,
  maxEntries: 400,
  maxIndexedChars: 120_000,
  maxBlocks: 2_500,
} as const;

export type DocxRejection =
  | "too_large"
  | "not_zip"
  | "encrypted"
  | "macro_enabled"
  | "not_docx"
  | "zip_bomb"
  | "too_many_entries"
  | "corrupt"
  | "too_complex";

export class DocxValidationError extends Error {
  constructor(
    readonly code: DocxRejection,
    message: string,
  ) {
    super(message);
    this.name = "DocxValidationError";
  }
}

interface CentralEntry {
  name: string;
  uncompressedSize: number;
  encrypted: boolean;
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = 22;
  let eocd = -1;

  for (
    let i = bytes.length - minEocd;
    i >= Math.max(0, bytes.length - minEocd - 0xffff);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }

  if (eocd < 0) {
    throw new DocxValidationError(
      "corrupt",
      "The file is not a valid Word package (no ZIP directory found).",
    );
  }

  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new DocxValidationError(
      "too_complex",
      "ZIP64 packages are not supported.",
    );
  }

  if (count > DOCX_LIMITS.maxEntries) {
    throw new DocxValidationError(
      "too_many_entries",
      `The package has ${count} entries; the limit is ${DOCX_LIMITS.maxEntries}.`,
    );
  }

  const entries: CentralEntry[] = [];
  let p = cdOffset;
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) {
      throw new DocxValidationError(
        "corrupt",
        "The Word package directory is damaged.",
      );
    }

    const flags = view.getUint16(p + 8, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    entries.push({
      name,
      uncompressedSize,
      encrypted: (flags & 0x1) === 1,
    });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

export interface DocxPackage {
  zip: JSZip;
  partNames: string[];
}

export async function loadDocxPackage(bytes: Uint8Array): Promise<DocxPackage> {
  if (bytes.byteLength > DOCX_LIMITS.maxCompressedBytes) {
    throw new DocxValidationError(
      "too_large",
      `Files up to ${DOCX_LIMITS.maxCompressedBytes / 1024 / 1024} MB are supported.`,
    );
  }

  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    throw new DocxValidationError(
      "encrypted",
      "This looks like a password-protected or legacy .doc file. Save it in Word as an unencrypted .docx, then upload that copy.",
    );
  }

  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new DocxValidationError(
      "not_zip",
      "This file is not a Word .docx document.",
    );
  }

  const entries = readCentralDirectory(bytes);

  if (entries.some((e) => e.encrypted)) {
    throw new DocxValidationError(
      "encrypted",
      "Encrypted packages are not supported.",
    );
  }

  const total = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);

  if (total > DOCX_LIMITS.maxUncompressedBytes) {
    throw new DocxValidationError(
      "zip_bomb",
      "The document expands to more than the supported size.",
    );
  }

  const names = entries.map((e) => e.name);

  if (names.some((n) => /vbaProject\.bin$/i.test(n))) {
    throw new DocxValidationError(
      "macro_enabled",
      "Macro-enabled documents (.docm) are not supported.",
    );
  }

  if (
    !names.includes("[Content_Types].xml") ||
    !names.includes("word/document.xml")
  ) {
    throw new DocxValidationError(
      "not_docx",
      "This package is not a Word document (word/document.xml is missing).",
    );
  }

  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new DocxValidationError(
      "corrupt",
      "The Word package could not be opened.",
    );
  }

  const contentTypes = await zip.file("[Content_Types].xml")?.async("string");

  if (contentTypes === undefined) {
    throw new DocxValidationError(
      "corrupt",
      "The Word package could not be opened.",
    );
  }

  if (/macroEnabled/i.test(contentTypes)) {
    throw new DocxValidationError(
      "macro_enabled",
      "Macro-enabled documents are not supported.",
    );
  }

  if (!/wordprocessingml\.document\.main\+xml/.test(contentTypes)) {
    throw new DocxValidationError(
      "not_docx",
      "Only standard .docx documents are supported (not templates or macro files).",
    );
  }

  return {
    zip,
    partNames: names,
  };
}

export async function serializePackage(pkg: DocxPackage): Promise<Uint8Array> {
  return pkg.zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}
