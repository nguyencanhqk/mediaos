import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S11-ROOM-BE-1 — RoomAudienceReader: người nhận NOTI của module ROOM (SPEC-14 §17) = organizer ∪ attendees của
 * lượt (mode `UserIds`). Mirror `AssetAudienceReader`: raw SQL, KHÔNG import `RoomsModule` (giữ `notifications/**`
 * acyclic). Actor-exclusion để engine lo (`payload.actorUserId`).
 *
 * BẤT BIẾN #1: chạy TRONG `withTenant` do caller mở + `company_id` bind tường minh mọi câu.
 * Fail-soft đọc: thiếu hàng ⇒ [] (engine log Skipped), KHÔNG throw.
 */
@Injectable()
export class RoomAudienceReader {
  async participantsOfBooking(
    tx: TenantTx,
    companyId: string,
    bookingId: string,
  ): Promise<string[]> {
    const map = await this.participantsByBookingIds(tx, companyId, [bookingId]);
    return map.get(bookingId) ?? [];
  }

  /** `bookingId → userId[]` (organizer trước, rồi attendees) cho nhiều lượt — MỘT câu. */
  async participantsByBookingIds(
    tx: TenantTx,
    companyId: string,
    bookingIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (bookingIds.length === 0) return out;
    const res = await tx.execute(sql`
      select x.booking_id as "bookingId", x.user_id as "userId"
        from (
          select b.id as booking_id, b.organizer_user_id as user_id, 0 as ord
            from room_bookings b
           where b.company_id = ${companyId} and b.id = any(${sql.param([...bookingIds])}::uuid[])
          union all
          select a.booking_id, a.user_id, 1 as ord
            from room_booking_attendees a
           where a.company_id = ${companyId} and a.booking_id = any(${sql.param([...bookingIds])}::uuid[])
        ) x
       order by x.booking_id, x.ord, x.user_id
    `);
    for (const r of res.rows as unknown as Array<{ bookingId: string; userId: string | null }>) {
      if (!r.userId) continue;
      const list = out.get(r.bookingId) ?? [];
      if (!list.includes(r.userId)) list.push(r.userId);
      out.set(r.bookingId, list);
    }
    return out;
  }
}
