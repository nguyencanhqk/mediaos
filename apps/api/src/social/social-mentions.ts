import type { FeedMentionDto } from "@mediaos/contracts";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { orgUnits } from "../db/schema/org";
import { feedGroupMembers, feedMentions, feedPostTags, feedTags } from "../db/schema/social";
import { users } from "../db/schema/users";
import { bumpTagUsage } from "./social-counters";
import { activeGroupMemberExists } from "./social-group-predicates";
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

/** Đích của một mention — đủ để hỏi «người X có trong audience của nó không». */
export type AudienceTarget = Pick<SocialPostAccess, "audience" | "orgUnitId" | "groupId">;

/** Người được xét — `orgUnitId` là đơn vị trên hồ sơ nhân sự CÒN SỐNG (null nếu không có). */
export interface AudiencePerson {
  userId: string;
  orgUnitId: string | null;
}

/**
 * Khoá CẶP cho các tập nạp theo lô — `${orgUnitId}:${userId}` / `${groupId}:${userId}`.
 *
 * 🔴 `[PR1-3]` KHÔNG khoá theo `userId` trần: một lô trộn nhiều bài thì «Y là thành viên G1» bị đọc
 * nhầm thành «Y trong audience bài G2» — đúng lỗi mà hai tập `Set<userId>` của bản một-bài không có
 * cơ hội mắc, nhưng bản theo lô thì mắc ngay.
 *
 * 🔴 CHUẨN HOÁ CHỮ THƯỜNG (FULL gate BE-1D): phía TẬP lấy uuid từ DB (luôn thường), phía TRA có thể
 * lấy từ REQUEST (`dto.groupId`/`dto.orgUnitId` — `z.string().uuid()` nhận chữ HOA). Postgres so uuid
 * không phân biệt hoa thường nên bản cũ (`Set<userId>` + `eq` trong SQL) vẫn khớp; so CHUỖI thì không
 * ⇒ mention hợp lệ bị bỏ im lặng.
 */
export const audiencePairKey = (scopeId: string, userId: string): string =>
  `${scopeId}:${userId}`.toLowerCase();

/**
 * Vị từ «X ở trong audience của đích» — **MỘT nguồn** cho CẢ đường GHI (`resolveMentions`) lẫn đường
 * ĐỌC (`loadMentionsForTargets`) (S16-SOCIAL-BE-1D D2). Hai bản sẽ trôi khỏi nhau ngay lần đầu có
 * người sửa một bên.
 *
 * Vế "trong audience" là **NGHỊCH ĐẢO CHÍNH XÁC** của `SocialAccessService.visiblePostCondition`:
 *   • `audience='company'` ⇒ mọi tài khoản còn sống trong công ty (người gọi đã lọc «còn sống»);
 *   • `audience='org_unit'` ⇒ người có `employee_profiles.org_unit_id` = đơn vị của bài, HOẶC người
 *     ĐỨNG ĐẦU đơn vị đó (`org_units.head_user_id`) — đúng hai nguồn mà `departmentOrgUnitIds()` gộp
 *     lại ở chiều ngược. Lệch một vế là mention được người không đọc được bài (họ nhận thông báo về
 *     một bài bấm vào ra 404), hoặc bỏ mất người đọc được.
 *   • `audience='group'` ⇒ **thành viên `active` của chính nhóm đó**, nhân sự `active`, nhóm chưa xoá
 *     mềm (S16-SOCIAL-BE-2A D14-3/D13) — tập `groupMembers` đã mang cả ba vế (`loadActiveGroupMembers`).
 *
 * ⚠️ Luật «tự nhắc chính mình ⇒ bỏ» KHÔNG ở đây `[PR1-2]`: ở đường đọc, «actor» là NGƯỜI XEM — đưa
 * luật đó vào hàm chung là X đọc bài nhắc chính X sẽ thấy mình bị rút. Luật đó sống ở `resolveMentions`.
 *
 * @param heads        khoá `audiencePairKey(orgUnitId, headUserId)` — từ `loadOrgUnitHeads`.
 * @param groupMembers khoá `audiencePairKey(groupId, userId)` — từ `loadActiveGroupMembers`.
 */
export function classifyInAudience(
  target: AudienceTarget,
  person: AudiencePerson,
  heads: ReadonlySet<string>,
  groupMembers: ReadonlySet<string>,
): boolean {
  switch (target.audience) {
    case "company":
      return true;
    case "org_unit":
      return (
        target.orgUnitId != null &&
        (person.orgUnitId === target.orgUnitId ||
          heads.has(audiencePairKey(target.orgUnitId, person.userId)))
      );
    case "group":
      return (
        target.groupId != null && groupMembers.has(audiencePairKey(target.groupId, person.userId))
      );
    default:
      // Audience lạ (giá trị mới thêm vào CHECK mà quên dạy hàm này) ⇒ NGOÀI: hướng an toàn là
      // thiếu mention, không phải mention/hiện tên cho người không đọc được bài.
      return false;
  }
}

/**
 * Người ĐỨNG ĐẦU các đơn vị `orgUnitIds` (đơn vị còn `active`, chưa xoá mềm) — một câu cho cả lô.
 * @returns tập khoá `audiencePairKey(orgUnitId, headUserId)`.
 */
export async function loadOrgUnitHeads(
  tx: TenantTx,
  companyId: string,
  orgUnitIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(orgUnitIds)];
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ orgUnitId: orgUnits.id, headUserId: orgUnits.headUserId })
    .from(orgUnits)
    .where(
      and(
        inArray(orgUnits.id, ids),
        eq(orgUnits.companyId, companyId),
        eq(orgUnits.status, "active"),
        isNull(orgUnits.deletedAt),
      ),
    );
  const out = new Set<string>();
  for (const r of rows) if (r.headUserId) out.add(audiencePairKey(r.orgUnitId, r.headUserId));
  return out;
}

/**
 * Thành viên ACTIVE của các nhóm `groupIds`, trong số `userIds` — một câu cho cả lô, lọc D7 ngay
 * trong câu: người đã nghỉ việc còn nguyên hàng `feed_group_members` nên membership KHÔNG đủ để kết
 * luận "còn trong nhóm" (vế `employee_profiles.status='active'` sống ở ĐÂY và chỉ ở đây `[PR2-3]`).
 *
 * `activeGroupMemberExists` nhận CỘT `feed_group_members.group_id` (không phải một group vô hướng)
 * để mỗi hàng được xét theo ĐÚNG nhóm của nó `[PR1-3]`.
 *
 * @returns tập khoá `audiencePairKey(groupId, userId)`.
 */
export async function loadActiveGroupMembers(
  tx: TenantTx,
  companyId: string,
  groupIds: readonly string[],
  userIds: readonly string[],
): Promise<Set<string>> {
  const gids = [...new Set(groupIds)];
  const uids = [...new Set(userIds)];
  if (gids.length === 0 || uids.length === 0) return new Set();
  const rows = await tx
    .select({
      groupId: feedGroupMembers.groupId,
      userId: feedGroupMembers.userId,
    })
    .from(feedGroupMembers)
    .innerJoin(
      employeeProfiles,
      and(
        eq(employeeProfiles.companyId, feedGroupMembers.companyId),
        eq(employeeProfiles.userId, feedGroupMembers.userId),
        eq(employeeProfiles.status, "active"),
        isNull(employeeProfiles.deletedAt),
      ),
    )
    .where(
      and(
        eq(feedGroupMembers.companyId, companyId),
        inArray(feedGroupMembers.groupId, gids),
        inArray(feedGroupMembers.userId, uids),
        activeGroupMemberExists(companyId, feedGroupMembers.groupId, feedGroupMembers.userId),
      ),
    );
  return new Set(rows.map((r) => audiencePairKey(r.groupId, r.userId)));
}

/**
 * Phân loại `mentionedUserIds` thành accepted/dropped theo `audience` của bài đích — vị từ ở
 * `classifyInAudience` (một nguồn với đường đọc).
 *
 * ⚠️ Tự nhắc chính mình bị BỎ (vào `dropped`): không ai cần thông báo về việc mình vừa gõ tên mình,
 * và để nó lọt sẽ đẻ một hàng `feed_mentions` mà `resolveRecipients` phải lọc lại ở tầng NOTI. Luật
 * này CHỈ thuộc đường GHI — xem docblock `classifyInAudience`.
 */
export async function resolveMentions(
  tx: TenantTx,
  actor: SocialActor,
  post: AudienceTarget,
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

  // Chỉ hỏi khi bài thật sự thuộc một nhóm / giới hạn theo đơn vị.
  const groupMembers =
    post.audience === "group" && post.groupId != null
      ? await loadActiveGroupMembers(tx, actor.companyId, [post.groupId], unique)
      : new Set<string>();
  const heads =
    post.audience === "org_unit" && post.orgUnitId
      ? await loadOrgUnitHeads(tx, actor.companyId, [post.orgUnitId])
      : new Set<string>();

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
    const person: ResolvedMention = {
      userId: row.userId,
      employeeId: row.employeeId,
    };
    if (userId === actor.actorUserId) {
      dropped.push(person);
      continue;
    }
    const inAudience = classifyInAudience(
      post,
      { userId: row.userId, orgUnitId: row.orgUnitId },
      heads,
      groupMembers,
    );
    if (inAudience) accepted.push(person);
    else dropped.push(person);
  }

  return { accepted, dropped };
}

/** Một đích cần nạp mention — audience là của CHÍNH bài (bài) hoặc của BÀI CHA (bình luận). */
export interface MentionTarget extends AudienceTarget {
  id: string;
}

/**
 * S16-SOCIAL-BE-1D — ĐƯỜNG ĐỌC mention cho cả một trang (bài HOẶC bình luận), ≤ 3 câu bất kể số đích.
 *
 * ┌─ 🔴 ĐIỀU KIỆN TỒN TẠI: `targets` PHẢI đến từ một đường ĐÃ qua cổng đọc bài ──────────────────────┐
 * │ (`listFeed`/`findVisible`/`assertPostVisible`/`assertCommentVisible`) — hàm này KHÔNG tự kiểm     │
 * │ tầm nhìn của người xem với bài. Nó chỉ đọc những hàng `feed_mentions` ĐÃ có trên các bài đó, và  │
 * │ không bao giờ tra danh bạ ngoài tập đó (plan §5 `[PR2-4]`). Đừng biến nó thành đường tra nhân sự.│
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Luật (D1, owner chốt O-1): phần tử có link ⇔ người được nhắc VẪN trong audience của đích tại lúc
 * ĐỌC (`classifyInAudience`, cùng vị từ lúc ghi) VÀ tài khoản còn `active`/chưa xoá VÀ còn hồ sơ nhân
 * sự sống VÀ có tên (D4). Trượt bất kỳ vế nào ⇒ `{withheld:true}` GIỮ vị trí (D8). Kết quả KHÔNG phụ
 * thuộc người xem — không có luật tự-nhắc ở đây.
 *
 * `users.status`/`deleted_at` là CỘT CHIẾU (đầu vào phân loại), KHÔNG phải WHERE `[PR1-6]`: lọc ở WHERE
 * làm phần tử biến mất ⇒ vỡ «độ dài giữ nguyên». `employeeId` lấy từ JOIN SỐNG, không từ snapshot
 * `feed_mentions.mentioned_employee_id`. `users.fullName` chiếu NGAY trong hàm này `[PR1-7]` — điểm
 * chiếu `loadMentionsForTargets:users.fullName` của sổ identity-projection (`second-assert`).
 *
 * @returns Map `targetId` → mảng mention theo thứ tự ỔN ĐỊNH `(created_at, id)` — các mention ghi cùng một lượt KHÔNG theo thứ tự trong body; đích không có mention nào ⇒ `[]`.
 */
export async function loadMentionsForTargets(
  tx: TenantTx,
  companyId: string,
  targetType: SocialTargetType,
  targets: readonly MentionTarget[],
): Promise<Map<string, FeedMentionDto[]>> {
  const out = new Map<string, FeedMentionDto[]>(targets.map((t) => [t.id, []]));
  if (targets.length === 0) return out;

  const rows = await tx
    .select({
      targetId: feedMentions.targetId,
      userId: users.id,
      userStatus: users.status,
      userDeletedAt: users.deletedAt,
      label: users.fullName,
      employeeId: employeeProfiles.id,
      orgUnitId: employeeProfiles.orgUnitId,
    })
    .from(feedMentions)
    .leftJoin(
      users,
      and(eq(users.id, feedMentions.mentionedUserId), eq(users.companyId, feedMentions.companyId)),
    )
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
        eq(feedMentions.companyId, companyId),
        eq(feedMentions.targetType, targetType),
        inArray(
          feedMentions.targetId,
          targets.map((t) => t.id),
        ),
      ),
    )
    .orderBy(asc(feedMentions.createdAt), asc(feedMentions.id));
  if (rows.length === 0) return out;

  const byId = new Map(targets.map((t) => [t.id, t]));
  const orgUnitIds = targets.flatMap((t) =>
    t.audience === "org_unit" && t.orgUnitId ? [t.orgUnitId] : [],
  );
  const groupIds = targets.flatMap((t) => (t.audience === "group" && t.groupId ? [t.groupId] : []));
  const mentionedUserIds = rows.flatMap((r) => (r.userId ? [r.userId] : []));
  const heads = await loadOrgUnitHeads(tx, companyId, orgUnitIds);
  const groupMembers = await loadActiveGroupMembers(tx, companyId, groupIds, mentionedUserIds);

  for (const r of rows) {
    const target = byId.get(r.targetId);
    const list = out.get(r.targetId);
    // Không thể xảy ra (WHERE chỉ lấy `targetId` thuộc `targets`) — NÉM thay vì bỏ qua: một hàng lạc
    // bị nuốt im lặng là mention biến mất khỏi mảng, đúng thứ D8 cấm.
    if (!target || !list) {
      throw new Error(`loadMentionsForTargets: hàng mention lạc đích ${r.targetId}`);
    }
    const { userId, employeeId } = r;
    const label = r.label?.trim() || null;
    const linked =
      userId != null &&
      r.userStatus === "active" &&
      r.userDeletedAt == null &&
      employeeId != null &&
      label != null &&
      classifyInAudience(target, { userId, orgUnitId: r.orgUnitId }, heads, groupMembers);
    list.push(linked ? { withheld: false, employeeId, label } : { withheld: true });
  }
  return out;
}

/**
 * Lấy mảng mention của MỘT đích từ kết quả `loadMentionsForTargets` — NÉM khi thiếu thay vì `?? []`.
 * Bộ nạp điền sẵn `[]` cho MỌI đích, nên thiếu khoá là lỗi lập trình (đích không được đưa vào lô);
 * nuốt nó thành `[]` là thẻ bài hiện «không ai được nhắc» trong im lặng.
 */
export function mentionsFor(
  map: ReadonlyMap<string, FeedMentionDto[]>,
  id: string,
): FeedMentionDto[] {
  const list = map.get(id);
  if (!list) throw new Error(`mentionsFor: đích ${id} không có trong lô đã nạp`);
  return list;
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
