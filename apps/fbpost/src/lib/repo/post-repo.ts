import { asRow, asRows, getDb, nowSeconds, toNumber } from "../db";
import type { Post, PostInput, PostStatus, PostType, ScheduleMode } from "../types";

interface PostRow {
  id: number;
  page_ref: number;
  page_name: string;
  content_id: number | null;
  plan_id: number | null;
  batch_id: string | null;
  type: string;
  message: string;
  link: string | null;
  title: string | null;
  media_ids: string;
  scheduled_at: number | null;
  schedule_mode: string;
  status: string;
  fb_post_id: string | null;
  fb_permalink: string | null;
  error: string | null;
  attempts: number;
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

function mapRow(row: PostRow): Post {
  return {
    id: row.id,
    pageRef: row.page_ref,
    pageName: row.page_name,
    contentId: row.content_id,
    planId: row.plan_id,
    batchId: row.batch_id,
    type: row.type as PostType,
    message: row.message,
    link: row.link,
    title: row.title,
    mediaIds: parseMediaIds(row.media_ids),
    scheduledAt: row.scheduled_at,
    scheduleMode: row.schedule_mode as ScheduleMode,
    status: row.status as PostStatus,
    fbPostId: row.fb_post_id,
    fbPermalink: row.fb_permalink,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPost(input: PostInput, status: PostStatus = "draft"): Post {
  const db = getDb();
  const ts = nowSeconds();
  const result = db
    .prepare(
      `INSERT INTO posts (page_ref, page_name, content_id, plan_id, batch_id, type, message, link, title,
                          media_ids, scheduled_at, schedule_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.pageRef,
      input.pageName,
      input.contentId ?? null,
      input.planId ?? null,
      input.batchId ?? null,
      input.type,
      input.message,
      input.link ?? null,
      input.title ?? null,
      JSON.stringify(input.mediaIds ?? []),
      input.scheduledAt ?? null,
      input.scheduleMode,
      status,
      ts,
      ts,
    );

  const post = getPost(toNumber(result.lastInsertRowid));
  if (!post) throw new Error("Khong tao duoc bai dang");
  return post;
}

export function getPost(id: number): Post | null {
  const row = asRow<PostRow>(getDb().prepare("SELECT * FROM posts WHERE id = ?").get(id));
  return row ? mapRow(row) : null;
}

export interface PostFilter {
  status?: PostStatus;
  /** Id noi bo cua Page. */
  pageRef?: number;
  planId?: number;
  batchId?: string;
  contentId?: number;
}

export function listPosts(filter?: PostFilter): Post[] {
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (filter?.status) {
    conditions.push("status = ?");
    values.push(filter.status);
  }
  if (filter?.pageRef !== undefined) {
    conditions.push("page_ref = ?");
    values.push(filter.pageRef);
  }
  if (filter?.planId !== undefined) {
    conditions.push("plan_id = ?");
    values.push(filter.planId);
  }
  if (filter?.batchId !== undefined) {
    conditions.push("batch_id = ?");
    values.push(filter.batchId);
  }
  if (filter?.contentId !== undefined) {
    conditions.push("content_id = ?");
    values.push(filter.contentId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = asRows<PostRow>(
    getDb()
      .prepare(
        `SELECT * FROM posts ${where}
         ORDER BY COALESCE(scheduled_at, created_at) DESC, id DESC`,
      )
      .all(...values),
  );

  return rows.map(mapRow);
}

/** Cac bai do worker noi bo phu trach va da den gio dang. */
export function listDuePosts(now: number): Post[] {
  const rows = asRows<PostRow>(
    getDb()
      .prepare(
        `SELECT * FROM posts
         WHERE status = 'queued' AND schedule_mode = 'local'
           AND scheduled_at IS NOT NULL AND scheduled_at <= ?
         ORDER BY scheduled_at ASC`,
      )
      .all(now),
  );
  return rows.map(mapRow);
}

/**
 * Cac bai dang cho duoc gui len Facebook ngay bay gio: bai dang ngay va bai
 * de Facebook giu lich.
 *
 * Khi tao lich hang loat, phan mem khong goi Graph API ngay trong request
 * (hang tram lan goi se qua thoi gian cho va cham gioi han tan suat cua
 * Facebook). Bai duoc xep vao hang doi va worker day dan tung dot.
 */
export function listPendingHandoffPosts(limit: number): Post[] {
  const rows = asRows<PostRow>(
    getDb()
      .prepare(
        `SELECT * FROM posts
         WHERE status = 'queued' AND schedule_mode IN ('facebook', 'now')
         ORDER BY COALESCE(scheduled_at, created_at) ASC, id ASC
         LIMIT ?`,
      )
      .all(limit),
  );
  return rows.map(mapRow);
}

/** Huy toan bo bai chua gui di cua mot ke hoach. Tra ve so bai da huy. */
export function cancelPendingPostsOfPlan(planId: number): number {
  const result = getDb()
    .prepare(
      `UPDATE posts SET status = 'cancelled', updated_at = ?
       WHERE plan_id = ? AND status IN ('draft', 'queued')`,
    )
    .run(nowSeconds(), planId);
  return toNumber(result.changes);
}

export function updatePost(
  id: number,
  patch: Partial<Omit<Post, "id" | "createdAt">>,
): Post | null {
  const columns: Record<string, string> = {
    type: "type",
    message: "message",
    link: "link",
    title: "title",
    scheduledAt: "scheduled_at",
    scheduleMode: "schedule_mode",
    status: "status",
    fbPostId: "fb_post_id",
    fbPermalink: "fb_permalink",
    error: "error",
    attempts: "attempts",
  };

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value as string | number | null);
  }

  if (patch.mediaIds !== undefined) {
    sets.push("media_ids = ?");
    values.push(JSON.stringify(patch.mediaIds));
  }

  if (sets.length === 0) return getPost(id);

  sets.push("updated_at = ?");
  values.push(nowSeconds(), id);

  getDb()
    .prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);

  return getPost(id);
}

/**
 * Cac trang thai ma van ban cua bai VAN con do phan mem giu: sua bay gio thi Facebook se nhan
 * ban moi.
 *
 * `failed` va `cancelled` nam trong danh sach vi chung chua bao gio len Facebook va van co nut
 * "Thử lại"/"Gửi đi" o hang doi - sua van ban roi gui lai la dung viec nguoi dung muon lam.
 * `scheduled` da nam tren Facebook kem gio dang, `publishing` dang tren duong di, `published`
 * thi da len Page - sua trong CSDL khong doi duoc gi tren Facebook nen KHONG dung o day.
 */
export const LOCAL_EDITABLE_STATUSES: PostStatus[] = ["draft", "queued", "failed", "cancelled"];

/**
 * Sua van ban cua mot bai CHUA duoc Facebook nhan.
 *
 * Hai dieu kien nam trong chinh cau UPDATE (compare-and-set) chu khong kiem tra truoc roi ghi
 * sau: worker co the gianh lay bai dung giua hai buoc do, va ket qua se la sua van ban cua mot
 * bai dang tren duong len Facebook.
 *
 * `fb_post_id IS NULL` la dieu kien THAT: no dung ca cho ca hiem - bai bao `failed` nhung
 * Facebook da kip tao bai (loi xay ra o buoc lay permalink). Trang thai mot minh khong bat duoc
 * ca do.
 *
 * Tra ve true khi that su sua duoc.
 */
export function updatePendingPostText(
  id: number,
  patch: { message?: string; title?: string | null; link?: string | null },
): boolean {
  const columns: Record<string, string> = { message: "message", title: "title", link: "link" };

  const sets: string[] = [];
  const values: (string | null)[] = [];

  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }

  if (sets.length === 0) return false;

  const placeholders = LOCAL_EDITABLE_STATUSES.map(() => "?").join(",");
  const result = getDb()
    .prepare(
      `UPDATE posts SET ${sets.join(", ")}, updated_at = ?
       WHERE id = ? AND fb_post_id IS NULL AND status IN (${placeholders})`,
    )
    .run(...values, nowSeconds(), id, ...LOCAL_EDITABLE_STATUSES);

  return toNumber(result.changes) > 0;
}

/**
 * Danh dau bai "dang gui" theo kieu compare-and-set.
 * Tra ve true neu gianh duoc quyen xu ly - ngan worker va thao tac tay
 * cung dang mot bai hai lan.
 */
export function claimForPublishing(id: number, allowedStatuses: PostStatus[]): boolean {
  const placeholders = allowedStatuses.map(() => "?").join(",");
  const result = getDb()
    .prepare(
      `UPDATE posts SET status = 'publishing', updated_at = ?
       WHERE id = ? AND status IN (${placeholders})`,
    )
    .run(nowSeconds(), id, ...allowedStatuses);
  return toNumber(result.changes) > 0;
}

export function deletePost(id: number): void {
  getDb().prepare("DELETE FROM posts WHERE id = ?").run(id);
}

export function countByStatus(): Record<string, number> {
  const rows = asRows<{ status: string; total: number }>(
    getDb().prepare("SELECT status, COUNT(*) AS total FROM posts GROUP BY status").all(),
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.total]));
}
