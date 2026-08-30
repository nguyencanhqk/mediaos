import { Injectable } from "@nestjs/common";
import { eq, sql, type SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import { users } from "../db/schema/users";
import { DataScopeService } from "../permission/data-scope.service";
import type { RoomActor, RoomRequestUser } from "./rooms.types";

const ROOM = "room";
const ROOM_BOOKING = "room-booking";

/**
 * S11-ROOM-BE-1 — RoomAccessService: lớp phạm vi của module ROOM (SPEC-14 §11 · §13.6 · permission-matrix §9e).
 *
 *   • `resolveViewActor`   — `('view','room')` assert (403) + `('cancel','room-booking')` KHÔNG ném (cho `canCancel`).
 *   • `resolveBookActor`   — `('book','room')` assert: Own ⇒ organizer = caller (403 ROOM-ERR-010 khi gửi khác) ·
 *                            Company ⇒ đặt hộ. `view` resolve KHÔNG ném — chỉ để chiếu tên (plan-review B1).
 *   • `resolveCancelActor` — `('cancel','room-booking')` assert: Own ⇒ chỉ lượt mình tổ chức (403 AUTH-ERR-SCOPE-DENIED) ·
 *                            Company ⇒ mọi lượt. `view` OrNull như trên.
 *   • `resolveManageActor` — `('manage','room')` assert (defense-in-depth trùng PermissionGuard).
 *
 * Data scope ép Ở SERVICE (RLS chỉ cô lập tenant). Gọi MỘT lần/request, NGOÀI `withTenant` (DataScope mở tx riêng —
 * nợ chung khuôn GOAL/ASSET, xem ASSET plan §15). Team/Department không có định nghĩa ở §9e ⇒ FAIL-CLOSED về Own.
 */
@Injectable()
export class RoomAccessService {
  constructor(private readonly dataScope: DataScopeService) {}

  async resolveViewActor(user: RoomRequestUser): Promise<RoomActor> {
    const viewScope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "view", ROOM);
    const cancelScope = await this.dataScope.resolveOrNull(
      user.id,
      user.companyId,
      "cancel",
      ROOM_BOOKING,
    );
    return this.build(user, viewScope, null, cancelScope);
  }

  async resolveBookActor(user: RoomRequestUser): Promise<RoomActor> {
    const writeScope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "book", ROOM);
    const viewScope = await this.dataScope.resolveOrNull(user.id, user.companyId, "view", ROOM);
    // `canCancel` của DTO trả về ngay sau khi đặt (201) — cần scope cancel của actor (KHÔNG ném khi thiếu).
    const cancelScope = await this.dataScope.resolveOrNull(
      user.id,
      user.companyId,
      "cancel",
      ROOM_BOOKING,
    );
    return this.build(user, viewScope, writeScope, cancelScope);
  }

  async resolveCancelActor(user: RoomRequestUser): Promise<RoomActor> {
    const writeScope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "cancel",
      ROOM_BOOKING,
    );
    const viewScope = await this.dataScope.resolveOrNull(user.id, user.companyId, "view", ROOM);
    return this.build(user, viewScope, writeScope, writeScope);
  }

  async resolveManageActor(user: RoomRequestUser): Promise<RoomActor> {
    const writeScope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "manage",
      ROOM,
    );
    const viewScope = await this.dataScope.resolveOrNull(user.id, user.companyId, "view", ROOM);
    return this.build(user, viewScope, writeScope, null);
  }

  /** Company/System ⇒ `true`; hẹp hơn hoặc `null` ⇒ `users.id = actor` (fail-closed). Dựng trên `users` KHÔNG alias. */
  static peopleVisibleCond(viewScope: DataScope | null, actorUserId: string): SQL {
    if (RoomAccessService.isCompany(viewScope)) return sql`true`;
    return eq(users.id, actorUserId);
  }

  static isCompany(scope: DataScope | null): boolean {
    return scope === "Company" || scope === "System";
  }

  private build(
    user: RoomRequestUser,
    viewScope: DataScope | null,
    writeScope: DataScope | null,
    cancelScope: DataScope | null,
  ): RoomActor {
    return {
      actorUserId: user.id,
      companyId: user.companyId,
      viewScope,
      peopleVisibleCond: RoomAccessService.peopleVisibleCond(viewScope, user.id),
      writeScope,
      isCompanyWrite: RoomAccessService.isCompany(writeScope),
      cancelScope,
    };
  }
}
