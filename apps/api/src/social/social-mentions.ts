import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { orgUnits } from "../db/schema/org";
import { feedMentions, feedPostTags, feedTags } from "../db/schema/social";
import { users } from "../db/schema/users";
import { bumpTagUsage } from "./social-counters";
import type { SocialActor, SocialPostAccess, SocialTargetType } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — hashtag (D8) + nhắc tên (D15/M15) cho bài và bình luận.
 *
 * ┌─ ⚠️ MENTION CỦA SOCIAL LÀM NGƯỢC VỚI TASK — ĐỌC TRƯỚC KHI "THỐNG NHẤT HAI MODULE" ─────────────┐
 * │ `task-comments.service.ts:296-313` **NÉM** khi một `mentionEmployeeId` không hợp lệ.            │
 * │ SPEC-16 §12 `ERR-009` chốt SOCIAL phải làm NGƯỢC LẠI: mention người NGOÀI `audience` bị **bỏ    │
 * │ IM LẶNG**, request vẫn `201`, danh sách bị bỏ trả ở `data.droppedMentions[]`.                   │
 * │                                                                                                 │
 * │ Đây không phải "khoan dung hơn" — nó là một QUYẾT ĐỊNH CHỐNG RÒ. Ném lỗi "người này ngoài phạm  │
 * │ vi" biến ô soạn thảo thành **oracle dò danh bạ**: gõ thử một userId rồi đọc mã lỗi là biết được  │
 * │ người đó có tồn tại và có thuộc đơn vị nào hay không. Im lặng bỏ thì caller không phân biệt      │
 * │ được "người không tồn tại" với "người ngoài audience" với "người đã nghỉ việc".                  │
 * │ ⇒ `droppedMentions[]` CỐ Ý chỉ dội lại ĐÚNG `userId` caller **vừa gửi lên** — thông tin mới = 0, │
 * │ và không nói LÝ DO bị bỏ. Trả `fullName` ở đây (bản đầu có) là tự mở lại oracle vừa đóng.        │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * D8 — regex hashtag **Unicode-aware**, không có tiền lệ trong repo nên chốt tại đây.
 *
 * `\p{L}` + cờ `u` là bắt buộc: bộ `[a-zA-Z0-9_]` sẽ cắt `#tuyểndụng` thành `#tuy` — hashtag tiếng
 * Việt có dấu là ca thường, không phải ca biên. `\p{N}` thay `0-9` cùng lý do (chữ số ngoài ASCII).
 *
 * KHÔNG khớp `#` đứng ngay sau ký tự chữ (`abc#def`) — đó là một phần của từ, không phải thẻ mới.
 */
const HASHTAG_RE = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]+)/gu;

/** `feed_tags.tag` là `varchar(64)` — thẻ dài hơn bị BỎ, không bị cắt cụt (cắt cụt đẻ thẻ rác gần-giống). */
const TAG_MAX_LENGTH = 64;
/** Trần số thẻ lấy từ MỘT nội dung — chặn một bài toàn dấu `#` làm phình từ điển thẻ. */
const MAX_TAGS_PER_POST = 20;

/**
 * Rút thẻ từ nội dung: lowercase, bỏ trùng, giữ THỨ TỰ xuất hiện, bỏ thẻ quá dài, trần 20.
 *
 * `toLowerCase()` chứ không `toLocaleLowerCase()`: thẻ là khoá tra cứu dùng chung cả công ty, và
 * `toLocaleLowerCase` phụ thuộc locale của TIẾN TRÌNH (tiếng Thổ biến `I` thành `ı`) ⇒ cùng một bài
 * cho ra thẻ khác nhau tuỳ máy chủ nào xử lý.
 */
export function parseHashtags(body: string | null | undefined): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(HASHTAG_RE)) {
    const tag = m[1].toLowerCase();
    if (tag.length > TAG_MAX_LENGTH) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_POST) break;
  }
  return out;
}

/**
 * Đồng bộ thẻ của MỘT bài về đúng tập `tags` — dùng cho cả lúc tạo lẫn lúc sửa (004 «đồng bộ lại
 * hashtag», API-19 §5.1).
 *
 * `usage_count` chỉ đổi theo phần CHÊNH LỆCH (thêm mới `+1`, gỡ bỏ `-1`), không phải "trừ hết rồi
 * cộng lại": trừ-rồi-cộng đi qua trạng thái trung gian có thể âm và vỡ `chk_feed_tags_usage`.
 */
export async function syncPostTags(
  tx: TenantTx,
  companyId: string,
  postId: string,
  tags: readonly string[],
): Promise<string[]> {
  const current = await tx
    .select({ tagId: feedPostTags.tagId, tag: feedTags.tag })
    .from(feedPostTags)
    .innerJoin(
      feedTags,
      and(eq(feedTags.id, feedPostTags.tagId), eq(feedTags.companyId, feedPostTags.companyId)),
    )
    .where(and(eq(feedPostTags.companyId, companyId), eq(feedPostTags.postId, postId)));

  const currentByTag = new Map(current.map((r) => [r.tag, r.tagId]));
  const wanted = new Set(tags);

  const toRemove = current.filter((r) => !wanted.has(r.tag));
  if (toRemove.length > 0) {
    await tx.delete(feedPostTags).where(
      and(
        eq(feedPostTags.companyId, companyId),
        eq(feedPostTags.postId, postId),
        inArray(
          feedPostTags.tagId,
          toRemove.map((r) => r.tagId),
        ),
      ),
    );
    await bumpTagUsage(
      tx,
      companyId,
      toRemove.map((r) => r.tagId),
      -1,
    );
  }

  const toAdd = tags.filter((t) => !currentByTag.has(t));
  if (toAdd.length === 0) return [...currentByTag.values()].filter((id) => id != null);

  // Upsert từ điển thẻ: `DO NOTHING` rồi đọc lại — `DO UPDATE` chỉ để `RETURNING` bắn ra id sẽ ghi đè
  // `usage_count` của hàng đang có.
  await tx
    .insert(feedTags)
    .values(toAdd.map((tag) => ({ companyId, tag })))
    .onConflictDoNothing();

  const resolved = await tx
    .select({ id: feedTags.id, tag: feedTags.tag })
    .from(feedTags)
    .where(and(eq(feedTags.companyId, companyId), inArray(feedTags.tag, [...toAdd])));

  const addedIds = resolved.map((r) => r.id);
  if (addedIds.length > 0) {
    await tx
      .insert(feedPostTags)
      .values(addedIds.map((tagId) => ({ companyId, postId, tagId })))
      .onConflictDoNothing();
    await bumpTagUsage(tx, companyId, addedIds, 1);
  }

  return [...currentByTag.values(), ...addedIds];
}

/**
 * Một người được nhắc tên — đủ để ghi `feed_mentions` và định tuyến NOTI.
 *
 * ⚠️ **KHÔNG có `fullName`, và đó là một quyết định an ninh, không phải tối giản.** Bản đầu có nó để
 * dựng `droppedMentions[]`, và cổng `identity-projection-ratchet` chỉ ra đúng chỗ: trả tên cho một
 * `userId` mà caller chỉ ĐOÁN biến ô soạn thảo thành oracle dò danh bạ — trên chính đường mà SPEC-16
 * §12 `ERR-009` dựng ra để KHÔNG rò gì. `droppedMentions` nay chỉ dội lại id caller VỪA GỬI.
 */
export interface ResolvedMention {
  userId: string;
  employeeId: string | null;
}

export interface MentionResolution {
  /** Người THẬT SỰ được nhắc — đã ghi vào `feed_mentions`, là người nhận `NOTI-EVENT-028`. */
  accepted: ResolvedMention[];
  /** Bị bỏ im lặng. KHÔNG kèm lý do — xem khối ⚠️ đầu file. */
  dropped: ResolvedMention[];
}

/**
 * Phân loại `mentionedUserIds` thành accepted/dropped theo `audience` của bài đích.
 *
 * Vế "trong audience" là **NGHỊCH ĐẢO CHÍNH XÁC** của `SocialAccessService.visiblePostCondition`:
 *   • `audience='company'` ⇒ mọi tài khoản còn sống trong công ty;
 *   • `audience='org_unit'` ⇒ người có `employee_profiles.org_unit_id` = đơn vị của bài, HOẶC người
 *     ĐỨNG ĐẦU đơn vị đó (`org_units.head_user_id`) — đúng hai nguồn mà `departmentOrgUnitIds()` gộp
 *     lại ở chiều ngược. Lệch một vế là mention được người không đọc được bài (họ nhận thông báo về
 *     một bài bấm vào ra 404), hoặc bỏ mất người đọc được.
 *   • `audience='group'` ⇒ KHÔNG BAO GIỜ tới đây (bị từ chối 422 ở `assertWriteAudience`).
 *
 * ⚠️ Tự nhắc chính mình bị BỎ (vào `dropped`): không ai cần thông báo về việc mình vừa gõ tên mình,
 * và để nó lọt sẽ đẻ một hàng `feed_mentions` mà `resolveRecipients` phải lọc lại ở tầng NOTI.
 */
export async function resolveMentions(
  tx: TenantTx,
  actor: SocialActor,
  post: Pick<SocialPostAccess, "audience" | "orgUnitId">,
  mentionedUserIds: readonly string[],
): Promise<MentionResolution> {
  const unique = [...new Set(mentionedUserIds)];
  if (unique.length === 0) return { accepted: [], dropped: [] };

  const rows = await tx
    .select({
      // KHÔNG chiếu `users.fullName` — xem docblock `ResolvedMention`.
      userId: users.id,
      employeeId: employeeProfiles.id,
      orgUnitId: employeeProfiles.orgUnitId,
    })
    .from(users)
    .leftJoin(
      employeeProfiles,
      and(
        eq(employeeProfiles.userId, users.id),
        eq(employeeProfiles.companyId, users.companyId),
        isNull(employeeProfiles.deletedAt),
      ),
    )
    .where(
      and(
        eq(users.companyId, actor.companyId),
        inArray(users.id, unique),
        isNull(users.deletedAt),
        eq(users.status, "active"),
      ),
    );

  const found = new Map(rows.map((r) => [r.userId, r]));

  // Ai đứng đầu ĐÚNG đơn vị của bài — chỉ hỏi khi bài thật sự giới hạn theo đơn vị.
  let heads = new Set<string>();
  if (post.audience === "org_unit" && post.orgUnitId) {
    const headRows = await tx
      .select({ headUserId: orgUnits.headUserId })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.id, post.orgUnitId),
          eq(orgUnits.companyId, actor.companyId),
          eq(orgUnits.status, "active"),
          isNull(orgUnits.deletedAt),
        ),
      );
    heads = new Set(headRows.map((r) => r.headUserId).filter((id): id is string => id != null));
  }

  const accepted: ResolvedMention[] = [];
  const dropped: ResolvedMention[] = [];

  for (const userId of unique) {
    const row = found.get(userId);
    // Không tìm thấy (không tồn tại · tenant khác · đã khoá · đã xoá) ⇒ BỎ, và `droppedMentions[]`
    // chỉ mang lại đúng id caller đã gửi — không xác nhận người đó có thật.
    if (!row) {
      dropped.push({ userId, employeeId: null });
      continue;
    }
    const person: ResolvedMention = { userId: row.userId, employeeId: row.employeeId };
    if (userId === actor.actorUserId) {
      dropped.push(person);
      continue;
    }
    const inAudience =
      post.audience === "company" ||
      (post.audience === "org_unit" &&
        post.orgUnitId != null &&
        (row.orgUnitId === post.orgUnitId || heads.has(row.userId)));
    if (inAudience) accepted.push(person);
    else dropped.push(person);
  }

  return { accepted, dropped };
}

/**
 * Ghi tập mention của MỘT đích về đúng `accepted` — dùng cho cả tạo lẫn sửa (004/016 «đồng bộ lại
 * mention»).
 *
 * @returns danh sách user **MỚI được nhắc ở lượt này** — chỉ họ mới nhận `NOTI-EVENT-028`. Sửa bài
 *   mà giữ nguyên mention cũ KHÔNG được bắn lại thông báo (mỗi lần bấm Lưu là một thông báo trùng).
 */
export async function syncMentions(
  tx: TenantTx,
  companyId: string,
  targetType: SocialTargetType,
  targetId: string,
  accepted: readonly ResolvedMention[],
): Promise<ResolvedMention[]> {
  const existing = await tx
    .select({ mentionedUserId: feedMentions.mentionedUserId })
    .from(feedMentions)
    .where(
      and(
        eq(feedMentions.companyId, companyId),
        eq(feedMentions.targetType, targetType),
        eq(feedMentions.targetId, targetId),
      ),
    );
  const had = new Set(existing.map((r) => r.mentionedUserId));
  const wanted = new Set(accepted.map((m) => m.userId));

  const toRemove = [...had].filter((id) => !wanted.has(id));
  if (toRemove.length > 0) {
    await tx
      .delete(feedMentions)
      .where(
        and(
          eq(feedMentions.companyId, companyId),
          eq(feedMentions.targetType, targetType),
          eq(feedMentions.targetId, targetId),
          inArray(feedMentions.mentionedUserId, toRemove),
        ),
      );
  }

  const fresh = accepted.filter((m) => !had.has(m.userId));
  if (fresh.length > 0) {
    await tx
      .insert(feedMentions)
      .values(
        fresh.map((m) => ({
          companyId,
          targetType,
          targetId,
          mentionedUserId: m.userId,
          mentionedEmployeeId: m.employeeId,
        })),
      )
      // `feed_mentions_uq` là chốt cuối chống nhắc đôi — đua hai request cùng lúc là no-op, không 500.
      .onConflictDoNothing();
  }
  return fresh;
}

/** Gỡ mọi mention của một đích (dùng khi xoá mềm bình luận — bài thì đi qua vị từ của bài cha). */
export async function clearMentions(
  tx: TenantTx,
  companyId: string,
  targetType: SocialTargetType,
  targetId: string,
): Promise<void> {
  await tx
    .delete(feedMentions)
    .where(
      and(
        eq(feedMentions.companyId, companyId),
        eq(feedMentions.targetType, targetType),
        eq(feedMentions.targetId, targetId),
      ),
    );
}

/** Nhãn dùng trong template NOTI-028 (`{target_type_label}`) — tiếng Việt, khớp `0581`. */
export function targetTypeLabel(targetType: SocialTargetType): string {
  return targetType === "post" ? "bài viết" : "bình luận";
}

/** Dùng bởi repository khi cần vị từ "bài có gắn thẻ X" trong SQL (lọc `tag` của 001). */
export function tagFilterExists(companyId: string, tag: string) {
  return sql`EXISTS (
    SELECT 1 FROM feed_post_tags pt
      JOIN feed_tags t ON t.id = pt.tag_id AND t.company_id = pt.company_id
     WHERE pt.company_id = ${companyId}
       AND pt.post_id = feed_posts.id
       AND t.tag = ${tag.toLowerCase()}
  )`;
}
