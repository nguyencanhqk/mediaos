import { asRow, asRows, getDb, nowSeconds, toNumber } from "../db";
import type { Content, ContentInput, PostType } from "../types";

/**
 * Thu vien noi dung.
 *
 * Noi dung tach roi khoi luot dang: mot noi dung co the duoc rai len
 * nhieu Page vao nhieu thoi diem khac nhau, moi luot la mot dong trong
 * bang `posts` va deu tro nguoc ve `contents.id`.
 */

interface ContentRow {
  id: number;
  label: string | null;
  type: string;
  message: string;
  link: string | null;
  title: string | null;
  media_ids: string;
  created_at: number;
  updated_at: number;
}

function parseMediaIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => typeof v === "number");
  } catch {
    return [];
  }
}

function mapRow(row: ContentRow): Content {
  return {
    id: row.id,
    label: row.label,
    type: row.type as PostType,
    message: row.message,
    link: row.link,
    title: row.title,
    mediaIds: parseMediaIds(row.media_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createContent(input: ContentInput): Content {
  const ts = nowSeconds();
  const result = getDb()
    .prepare(
      `INSERT INTO contents (label, type, message, link, title, media_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.label ?? null,
      input.type,
      input.message,
      input.link ?? null,
      input.title ?? null,
      JSON.stringify(input.mediaIds ?? []),
      ts,
      ts,
    );

  const content = getContent(toNumber(result.lastInsertRowid));
  if (!content) throw new Error("Khong tao duoc noi dung");
  return content;
}

export function getContent(id: number): Content | null {
  const row = asRow<ContentRow>(getDb().prepare("SELECT * FROM contents WHERE id = ?").get(id));
  return row ? mapRow(row) : null;
}

export function getManyContents(ids: number[]): Content[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = asRows<ContentRow>(
    getDb()
      .prepare(`SELECT * FROM contents WHERE id IN (${placeholders})`)
      .all(...ids),
  );

  // Giu dung thu tu nguoi dung da chon (SQL IN khong bao dam thu tu).
  const byId = new Map(rows.map((r) => [r.id, mapRow(r)]));
  return ids.map((id) => byId.get(id)).filter((c): c is Content => Boolean(c));
}

export function listContents(): Content[] {
  const rows = asRows<ContentRow>(getDb().prepare("SELECT * FROM contents ORDER BY id DESC").all());
  return rows.map(mapRow);
}

export function updateContent(id: number, patch: Partial<ContentInput>): Content | null {
  const columns: Record<string, string> = {
    label: "label",
    type: "type",
    message: "message",
    link: "link",
    title: "title",
  };

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value as string | null);
  }

  if (patch.mediaIds !== undefined) {
    sets.push("media_ids = ?");
    values.push(JSON.stringify(patch.mediaIds));
  }

  if (sets.length === 0) return getContent(id);

  sets.push("updated_at = ?");
  values.push(nowSeconds(), id);

  getDb()
    .prepare(`UPDATE contents SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);

  return getContent(id);
}

export function deleteContent(id: number): void {
  getDb().prepare("DELETE FROM contents WHERE id = ?").run(id);
}

/** So luot da xep lich cho tung noi dung, de hien trong thu vien. */
export function countScheduledByContent(): Record<number, number> {
  const rows = asRows<{ content_id: number; total: number }>(
    getDb()
      .prepare(
        `SELECT content_id, COUNT(*) AS total FROM posts
         WHERE content_id IS NOT NULL GROUP BY content_id`,
      )
      .all(),
  );
  return Object.fromEntries(rows.map((r) => [r.content_id, r.total]));
}

/** Nhan ngan gon de nhan dien noi dung trong bang lich. */
export function contentLabel(content: Content): string {
  if (content.label) return content.label;
  const text = content.message.trim() || content.link || content.title || "";
  if (!text) return `Nội dung #${content.id}`;
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}
