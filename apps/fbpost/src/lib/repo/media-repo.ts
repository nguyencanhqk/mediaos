import fs from "node:fs";
import { asRow, asRows, getDb, nowSeconds, toNumber } from "../db";
import { resolveUploadPath } from "../paths";
import type { MediaFile, MediaKind } from "../types";

interface MediaRow {
  id: number;
  filename: string;
  original_name: string;
  mime: string;
  size: number;
  kind: string;
  created_at: number;
}

function mapRow(row: MediaRow): MediaFile {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.original_name,
    mime: row.mime,
    size: row.size,
    kind: row.kind as MediaKind,
    createdAt: row.created_at,
  };
}

export function createMedia(input: {
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  kind: MediaKind;
}): MediaFile {
  const db = getDb();
  const createdAt = nowSeconds();
  const result = db
    .prepare(
      `INSERT INTO media (filename, original_name, mime, size, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.filename, input.originalName, input.mime, input.size, input.kind, createdAt);

  return { id: toNumber(result.lastInsertRowid), createdAt, ...input };
}

export function getMedia(id: number): MediaFile | null {
  const row = asRow<MediaRow>(getDb().prepare("SELECT * FROM media WHERE id = ?").get(id));
  return row ? mapRow(row) : null;
}

export function getManyMedia(ids: number[]): MediaFile[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = asRows<MediaRow>(
    getDb()
      .prepare(`SELECT * FROM media WHERE id IN (${placeholders})`)
      .all(...ids),
  );

  // Giu dung thu tu nguoi dung da chon (SQL IN khong bao dam thu tu).
  const byId = new Map(rows.map((r) => [r.id, mapRow(r)]));
  return ids.map((id) => byId.get(id)).filter((m): m is MediaFile => Boolean(m));
}

/** Xoa ban ghi va file vat ly. Bo qua loi xoa file de khong chan luong chinh. */
export function deleteMedia(id: number): void {
  const media = getMedia(id);
  if (!media) return;
  getDb().prepare("DELETE FROM media WHERE id = ?").run(id);
  try {
    fs.unlinkSync(resolveUploadPath(media.filename));
  } catch {
    // File co the da bi xoa thu cong - khong coi la loi.
  }
}
