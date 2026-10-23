import type { Pool } from "pg";

/**
 * S16-SOCIAL-QA-1 (L3) — ẢNH CHỤP «DB không đổi» cho các ca theo đối tượng (bài · bình luận · nhóm).
 *
 * Helper RIÊNG của lát L3 (kit / routes / seed đã đóng băng): chỉ ĐỌC qua pool được trao, không dựng
 * app, không gọi HTTP. Mỗi hàm trả MỘT chuỗi JSON — so `toBe` trước / sau một lời gọi bị từ chối.
 * Mọi câu đều lọc `company_id` (CI chạy mọi file trên MỘT DB).
 */

async function one(direct: Pool, sql: string, params: readonly unknown[]): Promise<string> {
  const r = await direct.query<{ v: unknown }>(sql, [...params]);
  return JSON.stringify(r.rows[0]?.v ?? null);
}

/**
 * Mọi thứ một route theo `post_id` có thể ghi: hàng bài (mọi cột) + khối bình chọn / sáng kiến của nó
 * + số hàng ở các bảng con (bình luận · cảm xúc · lưu · lượt xem · xác nhận đọc · phiếu).
 */
export function snapPost(direct: Pool, companyId: string, postId: string): Promise<string> {
  return one(
    direct,
    `SELECT jsonb_build_object(
       'post',      (SELECT to_jsonb(p) FROM feed_posts p WHERE p.id = $1 AND p.company_id = $2),
       'poll',      (SELECT to_jsonb(x) FROM feed_polls x WHERE x.post_id = $1 AND x.company_id = $2),
       'idea',      (SELECT to_jsonb(i) FROM feed_ideas i WHERE i.post_id = $1 AND i.company_id = $2),
       'comments',  (SELECT count(*) FROM feed_comments WHERE post_id = $1 AND company_id = $2),
       'reactions', (SELECT count(*) FROM feed_reactions
                      WHERE target_type = 'post' AND target_id = $1 AND company_id = $2),
       'saved',     (SELECT count(*) FROM feed_saved_posts WHERE post_id = $1 AND company_id = $2),
       'views',     (SELECT count(*) FROM feed_post_views WHERE post_id = $1 AND company_id = $2),
       'acks',      (SELECT count(*) FROM feed_post_acks WHERE post_id = $1 AND company_id = $2),
       'votes',     (SELECT count(*) FROM feed_poll_votes v
                       JOIN feed_polls x ON x.id = v.poll_id AND x.company_id = v.company_id
                      WHERE x.post_id = $1 AND v.company_id = $2)
     ) AS v`,
    [postId, companyId],
  );
}

/** Hàng bình luận (mọi cột) + số cảm xúc trên nó. */
export function snapComment(direct: Pool, companyId: string, commentId: string): Promise<string> {
  return one(
    direct,
    `SELECT jsonb_build_object(
       'comment',   (SELECT to_jsonb(c) FROM feed_comments c WHERE c.id = $1 AND c.company_id = $2),
       'reactions', (SELECT count(*) FROM feed_reactions
                      WHERE target_type = 'comment' AND target_id = $1 AND company_id = $2)
     ) AS v`,
    [commentId, companyId],
  );
}

/** Hàng nhóm (mọi cột) + mọi hàng thành viên của nhóm (xếp theo `user_id`). */
export function snapGroup(direct: Pool, companyId: string, groupId: string): Promise<string> {
  return one(
    direct,
    `SELECT jsonb_build_object(
       'group',   (SELECT to_jsonb(g) FROM feed_groups g WHERE g.id = $1 AND g.company_id = $2),
       'members', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.user_id), '[]'::jsonb)
                     FROM feed_group_members m WHERE m.group_id = $1 AND m.company_id = $2)
     ) AS v`,
    [groupId, companyId],
  );
}

/** Số hàng `audit_logs` của một người với một `action` trong công ty. */
export async function countAudit(
  direct: Pool,
  companyId: string,
  action: string,
  actorUserId: string,
): Promise<number> {
  const r = await direct.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE company_id = $1 AND action = $2 AND actor_user_id = $3`,
    [companyId, action, actorUserId],
  );
  return r.rows[0].n;
}

/** Số bài (kể cả đã xoá) do một người đăng trong công ty. */
export async function countPostsBy(
  direct: Pool,
  companyId: string,
  authorUserId: string,
): Promise<number> {
  const r = await direct.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM feed_posts WHERE company_id = $1 AND author_user_id = $2`,
    [companyId, authorUserId],
  );
  return r.rows[0].n;
}
