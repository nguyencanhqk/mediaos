import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { feedGroups } from "../db/schema/social";
import { activeGroupMemberExists } from "./social-group-predicates";

/**
 * S16-SOCIAL-BE-2C — id các nhóm bảng tin mà `userId` là thành viên `active`, nhóm CÒN SỐNG, cùng
 * `companyId`. Đây là danh sách room `co:{c}:feedgroup:{g}` mà `RealtimeGateway` join cho socket lúc
 * connect (sau cổng `view:feed`) — SERVER tự tra, không có đường nào nhận id nhóm từ client (WS một
 * chiều, CHAT-DEC-005).
 *
 * ┌─ VỊ TỪ: `activeGroupMemberExists` (TẬP NGƯỜI), KHÔNG `visibleGroupPostExists` (ĐỌC) ─────────────┐
 * │ Vị từ ĐỌC = thành viên `active` HOẶC nhóm `public` — dùng nó ở đây thì room của mỗi nhóm public  │
 * │ chứa CẢ CÔNG TY (mutant M5). Room là TẬP NGƯỜI nhận: chỉ thành viên `active` (owner ký Q-PUBLIC) │
 * │ — `pending` là yêu cầu chờ duyệt, chưa phải thành viên. Một luật một bản: KHÔNG chép vị từ.      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **TỰ TƯƠNG QUAN (plan M28 — đo trên lane DB).** Câu ngoài là `FROM feed_groups` và cột
 * `feed_groups.id` của nó được truyền VÀO `EXISTS` của vị từ — mà bên trong vị từ CŨNG `JOIN feed_groups`.
 * Kết quả đúng là nhờ DUY NHẤT alias `g` bên trong vị từ: alias che tên bảng ⇒ `"feed_groups"."id"` bind
 * bảng NGOÀI. Bỏ alias đó ⇒ reader trả MỌI nhóm sống của công ty cho bất kỳ ai là thành viên `active` của
 * MỘT nhóm (đo: `['K','P','Q']` thay vì `['K']`) — ca R5 + mutant M19 ghim. Dùng query builder
 * (`.from(feedGroups)`), KHÔNG `alias()` trong `sql` thô (render `FROM "fg"` ⇒ relation không tồn tại).
 *
 * Hai tầng `deleted_at IS NULL` (vế ngoài ở đây + `g.deleted_at` trong vị từ) là CÓ CHỦ ĐÍCH: nhóm xoá
 * mềm (`034`) không còn là audience của ai (D13), và `034` KHÔNG chạm hàng thành viên (M8).
 *
 * Chỉ chiếu `id` (uuid) — không mở điểm danh tính mới, không cột timestamptz chuỗi thô.
 */
export async function listActiveFeedGroupIdsTx(
  tx: TenantTx,
  companyId: string,
  userId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: feedGroups.id })
    .from(feedGroups)
    .where(
      and(
        eq(feedGroups.companyId, companyId),
        isNull(feedGroups.deletedAt),
        activeGroupMemberExists(companyId, feedGroups.id, userId),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Bề mặt DI của reader cho `RealtimeGateway` — lớp DUY NHẤT của `social/**` mà tầng realtime được
 * chạm (module lá `SocialGroupRoomsModule`; ratchet `feed-realtime-structure.spec.ts` S1/S2).
 *
 * Mở `withTenant` RIÊNG (RLS + FORCE) và gateway gọi nó NGOÀI mọi tx khác, tuần tự với `can()`
 * (M10 — `PermissionService.can` tự mở `withTenant`; lồng hai tx là treo IM LẶNG trên PgBouncer).
 */
@Injectable()
export class SocialGroupRoomsReader {
  constructor(private readonly db: DatabaseService) {}

  listActiveGroupIds(companyId: string, userId: string): Promise<string[]> {
    return this.db.withTenant(companyId, (tx) => listActiveFeedGroupIdsTx(tx, companyId, userId));
  }
}
