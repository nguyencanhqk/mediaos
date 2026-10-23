import type { Logger } from "@nestjs/common";
import type { FeedPostDto } from "@mediaos/contracts";
import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { users } from "../db/schema/users";
import type { OutboxService } from "../events/outbox.service";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { userIdsOfEmployeesTx } from "./social-kudos.repository";
import { targetTypeLabel, type ResolvedMention } from "./social-mentions";
import type { SocialNewsRepository } from "./social-news.repository";
import {
  SOCIAL_EVENT_MENTIONED,
  SOCIAL_EVENT_KUDOS_RECEIVED,
  SOCIAL_EVENT_NEWS_PUBLISHED,
  SOCIAL_NEWS_NOTI_RECIPIENT_CAP,
  type SocialKudosReceivedPayload,
  type SocialMentionedPayload,
  type SocialNewsPublishedPayload,
} from "./social-noti.payload";
import type { PostRow } from "./social-posts.repository";
import { buildWsPostCreatedEvent } from "./social-ws-payload";
import type { SocialActor } from "./social.types";

/**
 * S16-SOCIAL-POSTSSPLIT-1 — phần «báo cho người khác» của `SocialPostsService`, tách khỏi
 * `social-posts.service.ts` (vượt trần 800 dòng). Thân hàm GIỮ NGUYÊN từng câu.
 *
 * Hai nhóm, hai thời điểm — KHÔNG đổi chỗ cho nhau:
 *   • `enqueue*Noti*` — ghi hàng outbox **TRONG tx** của lượt ghi (caller truyền `tx`). Ghi sau commit
 *     là at-most-once: chết giữa hai bước ⇒ sự kiện có thật mà không ai được báo, không đường phát lại.
 *   • `emitPostCreated` — phát WS **SAU commit**, NGOÀI tx (emitter tự mở kết nối riêng; gọi trong
 *     callback `withTenant` = tx lồng tx, TREO IM LẶNG trên PgBouncer transaction-mode).
 */

/** Cộng tác viên của đường NOTI — ĐÚNG những thứ thân hàm chạm. */
export interface SocialPostsNotiDeps {
  readonly outbox: Pick<OutboxService, "enqueue">;
  /** ⟲ S16-SOCIAL-BE-1B — chỉ dùng cho tập người nhận NOTI-031 (`audienceUserIds`). */
  readonly news: Pick<SocialNewsRepository, "audienceUserIds">;
  /** Logger CỦA service gọi — giữ nguyên ngữ cảnh `[SocialPostsService]` trong log. */
  readonly logger: Pick<Logger, "warn">;
}

/**
 * ⟲ **S16-SOCIAL-BE-1B** — `NOTI-031` «tin tức công ty mới». Producer tính người nhận TRONG tx (C8).
 *
 * ┌─ 🔴 TRẦN 500 NGƯỜI NHẬN — VÀ VÌ SAO KHÔNG ĐƯỢC CẮT CÂM ────────────────────────────────────────┐
 * │ v1 không chia lô: công ty >500 người vẫn đọc tin qua `GET /social/news`; NOTI là kênh đẩy PHỤ.  │
 * │ Nhưng cắt IM LẶNG là đúng hình dạng «thành công RỖNG = fail-OPEN», và hệ quả nghiệp vụ THẬT là: │
 * │ với tin `requires_ack`, người thứ 501 trở đi **không hề được báo** trong khi route `022` vẫn    │
 * │ liệt họ vào danh sách «chưa đọc» — hai đường nói ngược nhau về cùng một người.                  │
 * │ Ba ràng buộc, cả ba đo được ở ca `N-C8-trần`:                                                   │
 * │   1. XÁC ĐỊNH — repository trả tập ĐÃ sắp theo `user_id` tăng dần, cắt SAU khi sắp.             │
 * │   2. QUAN SÁT ĐƯỢC — log WARN (post_id + tổng + trần) **VÀ** `recipientsTruncated`/              │
 * │      `totalRecipients` trong payload outbox (hàng dữ liệu tự mang bằng chứng, log thì trôi).    │
 * │   3. KHÔNG NUỐT tập rỗng — log WARN rồi KHÔNG enqueue (registrar sẽ NÉM nếu nhận payload rỗng). │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export async function enqueueNewsPublishedNoti(
  deps: SocialPostsNotiDeps,
  tx: TenantTx,
  actor: SocialActor,
  postId: string,
  // S16-SOCIAL-BE-2A D14(2): +`groupId` — tin đăng vào nhóm tính người nhận theo membership, và
  // thiếu trường này thì `audienceUserIds` fail-closed về tập rỗng (tin không báo cho ai).
  post: { audience: string; orgUnitId: string | null; groupId: string | null },
): Promise<void> {
  // Cắt + đếm + loại tác giả đều ở SQL (xem `audienceUserIds`): `recipients` đã là ≤ trần, `total`
  // là tổng THẬT trước khi cắt — hai con số khác nhau và payload cần CẢ HAI.
  const { userIds: recipients, total } = await deps.news.audienceUserIds(
    tx,
    actor.companyId,
    post,
    { excludeUserId: actor.actorUserId, limit: SOCIAL_NEWS_NOTI_RECIPIENT_CAP },
  );

  if (total === 0) {
    deps.logger.warn(
      `NOTI-031: tin ${postId} (audience=${post.audience}) không có người nhận nào — không phát thông báo.`,
    );
    return;
  }

  const truncated = total > SOCIAL_NEWS_NOTI_RECIPIENT_CAP;
  if (truncated) {
    deps.logger.warn(
      `NOTI-031: tin ${postId} có ${total} người nhận, vượt trần ${SOCIAL_NEWS_NOTI_RECIPIENT_CAP} — đã cắt ${total - recipients.length} người (thứ tự user_id tăng dần).`,
    );
  }

  const actorName = await resolveActorName(tx, actor.companyId, actor.actorUserId);
  const payload: SocialNewsPublishedPayload = {
    actorUserId: actor.actorUserId,
    postId,
    post_id: postId,
    actor_name: actorName,
    recipientUserIds: recipients,
    recipientsTruncated: truncated,
    totalRecipients: total,
  };
  await deps.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_NEWS_PUBLISHED, payload });
}

/**
 * S16-SOCIAL-BE-2B-2 — NOTI-033 «bạn được vinh danh». Người nhận = tập được vinh danh, map
 * `employee_id` → `user_id` rồi lọc **D18** (4 vế).
 *
 * ⚠️ Trừ `actorUserId` MỘT LẦN NỮA dù `KUDOS_SELF_RECIPIENT` đã chặn tự-vinh-danh ở đường ghi: lưới
 * kia là luật NGHIỆP VỤ (owner có thể nới), lưới này là tính chất của THÔNG BÁO (không ai tự báo cho
 * mình). Hai lý do khác nhau ⇒ hai lưới, không phải một lưới lặp.
 *
 * ⚠️ Tập rỗng ⇒ **KHÔNG enqueue**. Ba đường dẫn tới rỗng và cả ba đều BÌNH THƯỜNG, không phải lỗi:
 * mọi người nhận đã nghỉ việc (ca `K-4`) · tài khoản bị khoá (`K-4b`) · nhân sự chưa có tài khoản
 * `users` (`K-4c`). Enqueue một hàng với `recipientUserIds: []` sẽ thành dead-letter câm ở registrar
 * (`requireUserIds` ném) — một lỗi hạ tầng cho một tình huống nghiệp vụ hợp lệ.
 */
export async function enqueueKudosReceivedNoti(
  deps: Pick<SocialPostsNotiDeps, "outbox" | "logger">,
  tx: TenantTx,
  actor: SocialActor,
  postId: string,
  recipientEmployeeIds: readonly string[],
): Promise<void> {
  const mapped = await userIdsOfEmployeesTx(tx, actor.companyId, recipientEmployeeIds);
  const recipients = mapped.filter((id) => id !== actor.actorUserId);
  if (recipients.length === 0) {
    deps.logger.warn(
      `NOTI-033: vinh danh ở bài ${postId} không có người nhận nào CÒN HOẠT ĐỘNG (${recipientEmployeeIds.length} nhân sự được ghi) — không phát thông báo.`,
    );
    return;
  }

  const actorName = await resolveActorName(tx, actor.companyId, actor.actorUserId);
  const payload: SocialKudosReceivedPayload = {
    post_id: postId,
    actor_name: actorName,
    recipientUserIds: recipients,
  };
  await deps.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_KUDOS_RECEIVED, payload });
}

/** Một outbox event cho MỖI người được nhắc — xem `social-noti.payload.ts`. */
export async function enqueueMentionNotis(
  deps: Pick<SocialPostsNotiDeps, "outbox">,
  tx: TenantTx,
  actor: SocialActor,
  targetType: "post" | "comment",
  targetId: string,
  postId: string,
  fresh: readonly ResolvedMention[],
): Promise<void> {
  if (fresh.length === 0) return;
  const actorName = await resolveActorName(tx, actor.companyId, actor.actorUserId);
  for (const m of fresh) {
    const payload: SocialMentionedPayload = {
      actorUserId: actor.actorUserId,
      postId,
      targetType,
      targetId,
      mentionedUserId: m.userId,
      actor_name: actorName,
      post_id: postId,
      target_type_label: targetTypeLabel(targetType),
    };
    await deps.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_MENTIONED, payload });
  }
}

/**
 * Phát `feed:post.created` — S16-SOCIAL-BE-2C: bài `company` → room công ty, bài `group` → room NHÓM
 * (chỉ thành viên `active`, đã qua `view:feed`); `org_unit` / không `published` ⇒ KHÔNG phát (D21).
 *
 * Quyết định + bóc khoá nằm ở hàm THUẦN `buildWsPostCreatedEvent` (`social-ws-payload.ts` — nhãn
 * `audience`/`groupId` lấy TỪ HÀNG DB, không từ hằng); emitter định tuyến theo payload ĐÃ parse.
 * S16-SOCIAL-AVATARPRESIGN-1 (D3-b): builder cũng ép `author.avatarUrl: null` cho CẢ HAI biến thể
 * (room công ty lẫn room nhóm) — `dto` mang URL ĐÃ KÝ của REST, capability đó không lên room.
 */
export function emitPostCreated(
  realtime: Pick<RealtimeEmitterService, "emitFeedPostCreated">,
  actor: SocialActor,
  row: PostRow,
  dto: FeedPostDto,
): void {
  const ev = buildWsPostCreatedEvent(row, dto);
  if (ev) realtime.emitFeedPostCreated(actor.companyId, ev);
}

/**
 * Tên hiển thị của actor cho biến template `{actor_name}`.
 *
 * Tên người sống ở `users.full_name` — ĐO THẬT: `employee_profiles` KHÔNG có cột tên nào (chỉ
 * `emergency_contact_name`). Đừng đi tìm nó ở bảng nhân sự.
 *
 * Fallback `"Một đồng nghiệp"` thay vì chuỗi rỗng: registrar `requireField` NÉM khi biến template
 * rỗng (đúng — rỗng thì template render ra `{actor_name}` nguyên văn), nên một tài khoản chưa đặt
 * tên sẽ làm MỌI thông báo của họ dead-letter. Tên hiển thị không phải dữ liệu bắt buộc của hệ thống.
 *
 * S16-SOCIAL-POSTSSPLIT-1: dời từ `social-posts.service.ts` — khoá ratchet danh tính đổi CÓ CHỦ ĐÍCH
 * thành `social/social-posts-notify.ts#resolveActorName:users.fullName` (cùng truy vấn, cùng căn cứ).
 */
export async function resolveActorName(
  tx: TenantTx,
  companyId: string,
  userId: string,
): Promise<string> {
  const rows = await tx
    .select({ fullName: users.fullName })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .limit(1);
  return rows[0]?.fullName?.trim() || "Một đồng nghiệp";
}
