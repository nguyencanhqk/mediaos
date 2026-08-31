import { Injectable } from "@nestjs/common";
import { eq, sql, type SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import { users } from "../db/schema/users";
import { DataScopeService } from "../permission/data-scope.service";
import { RECRUIT_ROUTE_PAIRS, type RecruitRouteKey } from "./recruit-route-pairs.const";
import type { RecruitActor, RecruitRequestUser } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — RecruitAccessService: lớp phạm vi + TẦNG GUARD THỨ HAI của module RECRUIT
 * (SPEC-12 §11 · §13.6 · permission-matrix §9f). Mirror `RoomAccessService`.
 *
 * `resolveActor(user, routeKey)` gọi ĐÚNG MỘT LẦN mỗi request (đầu mỗi method service):
 *   1. Assert cặp `RECRUIT_ROUTE_PAIRS[routeKey]` với `isSensitive` ĐÚNG CỜ (7 cặp `candidate`
 *      sensitive — wildcard `*:*` không thoả) — 403 khi thiếu, ĐỘC LẬP với decorator route. Đây là
 *      tầng 2 của census `recruit-two-layer-guard-census`; deny ở đây để lại ZERO side-effect
 *      (convert gọi TRƯỚC khi cấp mã — plan §6.1 Pha 1).
 *   2. Tính `peopleVisibleCond` từ scope CỦA CHÍNH cặp route (Company/System ⇒ true; hẹp hơn ⇒
 *      fail-closed `users.id = actor`) — căn cứ THẬT cho điểm chiếu `RecruitPeopleRepository`.
 *   3. Resolve KHÔNG-ném các cờ phụ: `('view','interview')` (Own-filter + quyết định 010/011),
 *      `('update','candidate')` sensitive (mask PII), `('manage','offer')` non-sensitive (salary).
 *
 * Job-opening/candidate/offer CHỈ Company (§13.6) — không Own/Department nào ⇒ KHÔNG row-filter
 * thêm ngoài `company_id` (RLS + withTenant). Interview là resource DUY NHẤT có Own (participant).
 */
@Injectable()
export class RecruitAccessService {
  constructor(private readonly dataScope: DataScopeService) {}

  async resolveActor(user: RecruitRequestUser, routeKey: RecruitRouteKey): Promise<RecruitActor> {
    const p = RECRUIT_ROUTE_PAIRS[routeKey];
    // Tầng 2 — assert đúng cặp + đúng cờ sensitive; 403 AUTH-ERR-FORBIDDEN khi thiếu grant.
    const routeScope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      p.action,
      p.resourceType,
      { isSensitive: p.isSensitive },
    );
    const [interviewViewScope, candidateUpdateScope, offerManageScope] = await Promise.all([
      this.dataScope.resolveOrNull(user.id, user.companyId, "view", "interview"),
      // isSensitive:true TƯỜNG MINH — thiếu cờ thì wildcard *:* mở khoá PII (plan §4.4).
      this.dataScope.resolveOrNull(user.id, user.companyId, "update", "candidate", {
        isSensitive: true,
      }),
      // isSensitive:false TƯỜNG MINH — manage:offer KHÔNG sensitive (REC-DEC-004, §9f:569).
      this.dataScope.resolveOrNull(user.id, user.companyId, "manage", "offer", {
        isSensitive: false,
      }),
    ]);
    return {
      actorUserId: user.id,
      companyId: user.companyId,
      routeKey,
      routeScope,
      peopleVisibleCond: RecruitAccessService.peopleVisibleCond(routeScope, user.id),
      interviewViewScope,
      canSeeCandidatePii: candidateUpdateScope !== null,
      canSeeSalary: offerManageScope !== null,
    };
  }

  /** Company/System ⇒ `true`; hẹp hơn ⇒ fail-closed `users.id = actor` (trên `users` KHÔNG alias). */
  static peopleVisibleCond(scope: DataScope | null, actorUserId: string): SQL {
    if (RecruitAccessService.isCompany(scope)) return sql`true`;
    return eq(users.id, actorUserId);
  }

  static isCompany(scope: DataScope | null): boolean {
    return scope === "Company" || scope === "System";
  }
}
