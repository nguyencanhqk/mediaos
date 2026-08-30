import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { companies } from "../db/schema/companies";
import { users } from "../db/schema/users";
import { fromScope, identityColumns } from "../permission/identity-projection";
import type { RoomActor, RoomPeopleMap, RoomPersonRef } from "./rooms.types";

/**
 * S11-ROOM-BE-1 — RoomPeopleRepository: ĐIỂM CHIẾU DANH TÍNH DUY NHẤT của module ROOM (`users.full_name`) +
 * hai truy vấn phụ trợ về người/công ty. Mọi DTO người (organizer · bookedBy · attendees · cancelledBy ·
 * `conflicts[].organizerName` · `organizer_name`/`actor_name` NOTI) đi qua `namesByUserIdsTx` — không nơi nào khác
 * trong `rooms/**` được `select` `users.full_name`/`users.email` (identity-projection ratchet, KI-052).
 *
 * Căn cứ chiếu = `actor.peopleVisibleCond` suy từ cặp ĐỌC `('view','room')` (plan-review B1) — cặp GATE của route ghi
 * (`book`/`cancel`) KHÁC cặp bound này ⇒ basis `identity-gated` (khuôn N-1c `/org/teams/:id/members`).
 *
 * BẤT BIẾN #1: mọi câu bind `company_id` tường minh dù RLS đã đỡ; `deleted_at IS NULL` (user xoá mềm không được
 * chiếu tên, không được là organizer/attendee — B2). KHÔNG `email`/số điện thoại (SPEC-14 §18).
 */
@Injectable()
export class RoomPeopleRepository {
  private peopleGrant(actor: RoomActor) {
    return fromScope(
      actor.peopleVisibleCond,
      "identity-gated",
      "S11-ROOM-BE-1 §11 — tên người trong lượt gác bởi ('view','room') (Company mọi role seed); scope hẹp hơn/không có cặp ⇒ chỉ tên chính actor.",
      users.id,
    );
  }

  /**
   * `userId → {displayName, employeeCode}`; user không tồn tại/khác tenant/đã xoá mềm KHÔNG có trong map.
   * `employeeCode` = subquery TƯƠNG QUAN (KHÔNG LEFT JOIN có vị từ ở WHERE — B5): user không có hồ sơ vẫn có tên.
   */
  async namesByUserIdsTx(
    tx: TenantTx,
    actor: RoomActor,
    userIds: readonly string[],
  ): Promise<RoomPeopleMap> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, RoomPersonRef>();
    if (ids.length === 0) return out;
    const rows = await tx
      .select({
        userId: users.id,
        ...identityColumns(this.peopleGrant(actor), { displayName: users.fullName }),
        // mã nhân viên KHÔNG phải cột danh tính (census chỉ quét email/full_name). Partial unique
        // (company_id, user_id) WHERE deleted_at IS NULL ⇒ ≤ 1 hàng sống; ORDER BY chỉ để tất định.
        // ⚠️ Định danh CHỮ `users.id` — drizzle render `${users.id}` trong SELECT-list thành `"id"` TRẦN ⇒ subquery so
        // với `ep.id` (memory `drizzle-sql-template-renders-columns-unqualified`; đo lại 30/08/2026 trên 0.45).
        employeeCode: sql<string | null>`(
          select ep.employee_code from employee_profiles ep
           where ep.user_id = users.id and ep.company_id = ${actor.companyId} and ep.deleted_at is null
           order by ep.created_at desc
           limit 1
        )`,
      })
      .from(users)
      .where(
        and(eq(users.companyId, actor.companyId), isNull(users.deletedAt), inArray(users.id, ids)),
      );
    for (const r of rows) {
      out.set(r.userId, {
        userId: r.userId,
        displayName: r.displayName ?? null,
        employeeCode: r.employeeCode ?? null,
      });
    }
    return out;
  }

  /**
   * `id → status` của user thuộc company, CHƯA xoá mềm (MỘT câu `IN`) — kiểm organizer/attendees (ROOM-ERR-006/010).
   * Thiếu trong map = không tồn tại HOẶC khác tenant HOẶC đã xoá mềm — cùng một kind (không thành oracle).
   */
  async userStatusesTx(
    tx: TenantTx,
    companyId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (userIds.length === 0) return out;
    const rows = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          isNull(users.deletedAt),
          inArray(users.id, [...userIds]),
        ),
      );
    for (const r of rows) out.set(r.id, r.status);
    return out;
  }

  /** IANA tz của công ty (ROOM-DEC-003) — thiếu hàng ⇒ NÉM (tenant không tồn tại là lỗi hệ thống, không nuốt). */
  async companyTimezoneTx(tx: TenantTx, companyId: string): Promise<string> {
    const [row] = await tx
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!row)
      throw new Error(`RoomPeopleRepository: company ${companyId} không tồn tại (timezone).`);
    return row.timezone;
  }
}
