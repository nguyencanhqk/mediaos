import type { Pool } from "pg";
import { expect } from "vitest";

/**
 * S16-SOCIAL-QA-1 (L0) — phần «đối soát 7 cột đếm» của bộ đồ nghề QA SOCIAL, tách khỏi
 * `social-qa1-kit.ts` để mỗi file < 800 dòng. ĐÓNG BĂNG sau L0 (lát sau KHÔNG sửa file này).
 *
 * Code có 7 cột đếm denormalized (SPEC-16 §13.6 liệt 6, thiếu `feed_comments.like_count`). Mọi phép
 * đếm lọc theo công ty của spec: CI chạy mọi file song song trên MỘT DB.
 */

export const QA1_COUNTER_COLUMNS = [
  "feed_posts.like_count",
  "feed_posts.comment_count",
  "feed_posts.view_count",
  "feed_comments.like_count",
  "feed_tags.usage_count",
  "feed_groups.member_count",
  "feed_poll_options.vote_count",
] as const;
export type Qa1CounterColumn = (typeof QA1_COUNTER_COLUMNS)[number];

export interface CounterDrift {
  column: Qa1CounterColumn;
  companyId: string;
  /** id của hàng mang cột đếm (bài · bình luận · thẻ · nhóm · lựa chọn). */
  id: string;
  stored: number;
  actual: number;
}

export interface CounterReport {
  drifts: CounterDrift[];
  /** Số hàng ĐÃ SOÁT của từng cột — 0 nghĩa là phép đối soát của cột đó rỗng. */
  checked: Record<Qa1CounterColumn, number>;
}

/**
 * Câu «sự thật» của từng cột — phạm vi lọc đúng theo sản phẩm:
 *   • 3 cột của bài: chỉ bài CHƯA xoá (xoá mềm không hạ cột; khôi phục đếm lại);
 *   • `feed_comments.like_count`: chỉ bình luận CHƯA xoá;
 *   • `usage_count`: đếm qua bài CHƯA xoá, KHÔNG lọc trạng thái / nhóm;
 *   • `member_count`: chỉ hàng `active`, KHÔNG lọc nhóm đã xoá;
 *   • `vote_count`: theo TỪNG lựa chọn.
 * Mọi câu lọc `company_id = ANY($1)` — chỉ công ty của spec.
 */
const COUNTER_SQL: Record<Qa1CounterColumn, string> = {
  "feed_posts.like_count": `
    SELECT p.id, p.company_id, p.like_count AS stored,
           (SELECT count(*) FROM feed_reactions r
             WHERE r.company_id = p.company_id AND r.target_type = 'post' AND r.target_id = p.id)::int AS actual
      FROM feed_posts p WHERE p.company_id = ANY($1::uuid[]) AND p.deleted_at IS NULL`,
  "feed_posts.comment_count": `
    SELECT p.id, p.company_id, p.comment_count AS stored,
           (SELECT count(*) FROM feed_comments c
             WHERE c.company_id = p.company_id AND c.post_id = p.id AND c.deleted_at IS NULL)::int AS actual
      FROM feed_posts p WHERE p.company_id = ANY($1::uuid[]) AND p.deleted_at IS NULL`,
  "feed_posts.view_count": `
    SELECT p.id, p.company_id, p.view_count AS stored,
           (SELECT count(*) FROM feed_post_views v
             WHERE v.company_id = p.company_id AND v.post_id = p.id)::int AS actual
      FROM feed_posts p WHERE p.company_id = ANY($1::uuid[]) AND p.deleted_at IS NULL`,
  "feed_comments.like_count": `
    SELECT c.id, c.company_id, c.like_count AS stored,
           (SELECT count(*) FROM feed_reactions r
             WHERE r.company_id = c.company_id AND r.target_type = 'comment' AND r.target_id = c.id)::int AS actual
      FROM feed_comments c WHERE c.company_id = ANY($1::uuid[]) AND c.deleted_at IS NULL`,
  "feed_tags.usage_count": `
    SELECT t.id, t.company_id, t.usage_count AS stored,
           (SELECT count(*) FROM feed_post_tags pt
              JOIN feed_posts p ON p.id = pt.post_id AND p.company_id = pt.company_id
             WHERE pt.company_id = t.company_id AND pt.tag_id = t.id AND p.deleted_at IS NULL)::int AS actual
      FROM feed_tags t WHERE t.company_id = ANY($1::uuid[])`,
  "feed_groups.member_count": `
    SELECT g.id, g.company_id, g.member_count AS stored,
           (SELECT count(*) FROM feed_group_members m
             WHERE m.company_id = g.company_id AND m.group_id = g.id AND m.status = 'active')::int AS actual
      FROM feed_groups g WHERE g.company_id = ANY($1::uuid[])`,
  "feed_poll_options.vote_count": `
    SELECT o.id, o.company_id, o.vote_count AS stored,
           (SELECT count(*) FROM feed_poll_votes v
             WHERE v.company_id = o.company_id AND v.poll_id = o.poll_id AND v.option_id = o.id)::int AS actual
      FROM feed_poll_options o WHERE o.company_id = ANY($1::uuid[])`,
};

/**
 * So CẢ 7 cột đếm với `COUNT(*)` thật, chỉ trong `companyIds`.
 *
 * @returns `drifts` (rỗng = khớp) + `checked` (số hàng đã soát mỗi cột). KHÔNG tự `expect` — dùng
 *   `expectCountersReconciled` khi muốn assert.
 * Bẫy: cột đọc từ DB, không từ response (thân `011/012/018/019` trả COUNT thật).
 */
export async function reconcileSocialCounters(
  direct: Pool,
  companyIds: readonly string[],
): Promise<CounterReport> {
  if (companyIds.length === 0) throw new Error("[social-qa1-kit] đối soát cần ít nhất 1 công ty");
  const drifts: CounterDrift[] = [];
  const checked = {} as Record<Qa1CounterColumn, number>;
  for (const column of QA1_COUNTER_COLUMNS) {
    const r = await direct.query<{
      id: string;
      company_id: string;
      stored: number;
      actual: number;
    }>(COUNTER_SQL[column], [[...companyIds]]);
    checked[column] = r.rows.length;
    for (const row of r.rows) {
      if (Number(row.stored) !== Number(row.actual)) {
        drifts.push({
          column,
          companyId: row.company_id,
          id: row.id,
          stored: Number(row.stored),
          actual: Number(row.actual),
        });
      }
    }
  }
  return { drifts, checked };
}

/** `feed_posts.like_count id=… stored=1 actual=0` — một dòng cho thông điệp đỏ. */
export const formatDrift = (d: CounterDrift): string =>
  `${d.column} id=${d.id} stored=${d.stored} actual=${d.actual}`;

/**
 * Assert «không cột nào lệch» (thông điệp đỏ nêu `bảng.cột` + id) và, với các cột ở `requireRows`,
 * «đã soát ≥ 1 hàng» (chống xanh-rỗng). Gọi ở cuối spec race · xoá mềm · fuzz.
 */
export async function expectCountersReconciled(
  direct: Pool,
  companyIds: readonly string[],
  requireRows: readonly Qa1CounterColumn[] = [],
): Promise<CounterReport> {
  const report = await reconcileSocialCounters(direct, companyIds);
  expect(report.drifts.map(formatDrift), "cột đếm lệch so với COUNT thật").toEqual([]);
  for (const column of requireRows) {
    expect(report.checked[column], `đối soát ${column} không soát hàng nào`).toBeGreaterThan(0);
  }
  return report;
}
