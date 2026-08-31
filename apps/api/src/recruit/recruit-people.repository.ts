import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { users } from "../db/schema/users";
import { fromScope, identityColumns } from "../permission/identity-projection";
import type { RecruitActor, RecruitPeopleMap, RecruitPersonRef } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — RecruitPeopleRepository: ĐIỂM CHIẾU DANH TÍNH DUY NHẤT của module RECRUIT
 * (`users.full_name`). Mọi DTO người (recruiter phụ trách · interviewer/participant · picker 031/032
 * · tên trong payload NOTI) đi qua `namesByUserIdsTx` — KHÔNG nơi nào khác trong `recruit/**` được
 * `select` `users.fullName`/`users.email` (identity-projection ratchet, khuôn `RoomPeopleRepository`).
 *
 * Căn cứ chiếu = `actor.peopleVisibleCond` tính MỘT lần/request bởi `RecruitAccessService` theo cặp
 * CỦA ROUTE (`RECRUIT_ROUTE_PAIRS`) — basis `identity-gated` (plan §5; repository KHÔNG nhận cặp
 * rời, chống đường lách truyền cặp sai route — plan-review vòng 2 #3).
 *
 * BẤT BIẾN #1: mọi câu bind `company_id` tường minh dù RLS đã đỡ; `deleted_at IS NULL`.
 * KHÔNG `users.email`/số điện thoại trong bất kỳ projection nào (SPEC-12 §18).
 */
@Injectable()
export class RecruitPeopleRepository {
  private peopleGrant(actor: RecruitActor) {
    return fromScope(
      actor.peopleVisibleCond,
      "identity-gated",
      "S12-RECRUIT-BE-1 §5 — peopleVisibleCond tính 1 lần/request bởi RecruitAccessService theo cặp của route (RECRUIT_ROUTE_PAIRS); RECRUIT không có Own/Department ở job-opening/candidate/offer nên mọi grant thật đều Company, chỉ 0 grant mới thu hẹp fail-closed về self.",
      users.id,
    );
  }

  /**
   * `userId → {displayName, employeeCode}`; user không tồn tại/khác tenant/xoá mềm KHÔNG có trong
   * map. `employeeCode` = subquery TƯƠNG QUAN (không LEFT JOIN — nhân bản hàng khi nhiều hồ sơ lịch
   * sử), CÙNG vị từ với displayName (mã NV là nửa danh tính — mirror ROOM M2).
   */
  async namesByUserIdsTx(
    tx: TenantTx,
    actor: RecruitActor,
    userIds: readonly string[],
  ): Promise<RecruitPeopleMap> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, RecruitPersonRef>();
    if (ids.length === 0) return out;
    const rows = await tx
      .select({
        userId: users.id,
        ...identityColumns(this.peopleGrant(actor), { displayName: users.fullName }),
        // ⚠️ `users.id` viết CHỮ trong subquery (drizzle single-table bỏ tên bảng cho Column trong
        // `sql` ở SELECT-list — memory `drizzle-sql-template-renders-columns-unqualified`).
        employeeCode: sql<string | null>`case when (${actor.peopleVisibleCond}) then (
          select ep.employee_code from employee_profiles ep
           where ep.user_id = users.id and ep.company_id = ${actor.companyId} and ep.deleted_at is null
           order by ep.created_at desc
           limit 1
        ) else null end`,
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
   * Picker 031 — nhân viên `active` cho chọn interviewer. GIỮ MỘT điểm chiếu: bước 1 SELECT
   * `employee_profiles` (KHÔNG chạm `users`) lấy ứng viên khớp; bước 2 lấy tên qua
   * `namesByUserIdsTx`. Lọc `q` áp lên employee_code (bước 1) VÀ displayName (SAU khi đã bọc cột —
   * plan §5, không filter trên cột `users` trần).
   */
  async activeEmployeePickerTx(
    tx: TenantTx,
    actor: RecruitActor,
    q: string | undefined,
    limit: number,
  ): Promise<Array<{ id: string; fullName: string | null; employeeCode: string | null }>> {
    const rows = await tx
      .select({
        employeeId: employeeProfiles.id,
        userId: employeeProfiles.userId,
        employeeCode: employeeProfiles.employeeCode,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, actor.companyId),
          isNull(employeeProfiles.deletedAt),
          eq(employeeProfiles.status, "active"),
        ),
      );
    const names = await this.namesByUserIdsTx(
      tx,
      actor,
      rows.map((r) => r.userId).filter((x): x is string => Boolean(x)),
    );
    const needle = q?.toLowerCase();
    const out: Array<{ id: string; fullName: string | null; employeeCode: string | null }> = [];
    for (const r of rows) {
      const display = (r.userId ? names.get(r.userId)?.displayName : null) ?? null;
      if (needle) {
        const hitCode = r.employeeCode?.toLowerCase().includes(needle) ?? false;
        const hitName = display?.toLowerCase().includes(needle) ?? false;
        if (!hitCode && !hitName) continue;
      }
      out.push({ id: r.employeeId, fullName: display, employeeCode: r.employeeCode ?? null });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Picker 032 — user sống trong company cho chọn recruiter. Bước 1 lấy id user active (cột KHÔNG
   * identity); bước 2 tên qua `namesByUserIdsTx`; lọc `q` trên giá trị ĐÃ qua identityColumns.
   */
  async recruiterUserPickerTx(
    tx: TenantTx,
    actor: RecruitActor,
    q: string | undefined,
    limit: number,
  ): Promise<Array<{ id: string; fullName: string | null }>> {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.companyId, actor.companyId),
          isNull(users.deletedAt),
          eq(users.status, "active"),
        ),
      );
    const names = await this.namesByUserIdsTx(
      tx,
      actor,
      rows.map((r) => r.id),
    );
    const needle = q?.toLowerCase();
    const out: Array<{ id: string; fullName: string | null }> = [];
    for (const r of rows) {
      const display = names.get(r.id)?.displayName ?? null;
      if (needle && !(display?.toLowerCase().includes(needle) ?? false)) continue;
      out.push({ id: r.id, fullName: display });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * `employeeId → userId` của participant (resolve NOTI-017 + own-scope check). Chỉ hồ sơ sống.
   */
  async userIdsByEmployeeIdsTx(
    tx: TenantTx,
    companyId: string,
    employeeIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const ids = [...new Set(employeeIds)];
    if (ids.length === 0) return out;
    const rows = await tx
      .select({
        id: employeeProfiles.id,
        userId: employeeProfiles.userId,
        status: employeeProfiles.status,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
          inArray(employeeProfiles.id, ids),
        ),
      );
    for (const r of rows) out.set(r.id, r.userId ?? null);
    return out;
  }

  /**
   * `employeeId → status` hồ sơ sống trong company (kiểm interviewer RECRUIT-ERR-009). Thiếu trong
   * map = không tồn tại/khác tenant/xoá mềm — cùng một kind (không thành oracle).
   */
  async employeeStatusesTx(
    tx: TenantTx,
    companyId: string,
    employeeIds: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = [...new Set(employeeIds)];
    if (ids.length === 0) return out;
    const rows = await tx
      .select({ id: employeeProfiles.id, status: employeeProfiles.status })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
          inArray(employeeProfiles.id, ids),
        ),
      );
    for (const r of rows) out.set(r.id, r.status);
    return out;
  }

  /** employee_profile SỐNG của caller (chân own-scope interview/feedback); null = không có hồ sơ. */
  async callerEmployeeIdTx(
    tx: TenantTx,
    companyId: string,
    actorUserId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, actorUserId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** User sống trong company (kiểm recruiterUserId — 404 `009` khi không hợp lệ). */
  async isLiveUserTx(tx: TenantTx, companyId: string, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.companyId, companyId),
          isNull(users.deletedAt),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}
