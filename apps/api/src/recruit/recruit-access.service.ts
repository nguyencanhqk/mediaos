import { ForbiddenException, Injectable } from "@nestjs/common";
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

  /**
   * ⟲ S14-PERF-DASHACTOR-1 — 4 round-trip → **1**. Bốn câu hỏi scope ở đây luôn cùng
   * `(user.id, user.companyId)` nên đọc CÙNG một tập grant; `getCompanyRoleGrantsWithScope` KHÔNG
   * được cache (`permission.cache.ts:95` passthrough có chủ ý) ⇒ trước WO này mỗi `resolveActor` =
   * 4 query DB giống hệt nhau (nặng nhất repo: `CandidatesService.summary` cho widget DASH).
   *
   * Đọc kết quả **THEO CHỈ SỐ**, KHÔNG theo khoá cặp — hai lý do, cả hai đều là lỗ nếu làm sai:
   *   • `routeKey='candidateUpdate'` hỏi ĐÚNG cặp `update:candidate` mà cờ mask PII cũng hỏi; tra
   *     theo khoá thì hai vai đè nhau và bản `isSensitive` LỎNG hơn có thể thắng.
   *   • `Map.get()` trượt trả `undefined`, mà `canSeeCandidatePii`/`canSeeSalary` bên dưới kiểm
   *     `!== null` ⇒ `undefined` sẽ MỞ KHOÁ PII/lương, và typecheck không bắt.
   *
   * Thứ tự deny KHÔNG đổi ở đầu ra, chỉ đổi ở thời điểm TÍNH: trước đây `resolveAndAssert` ném
   * trước khi 3 cờ phụ chạy; nay cả 4 được decide in-memory rồi mới assert. Vô hại (thuần hàm, 0
   * side-effect, vẫn ném TRƯỚC khi trả actor) — ghi ra để không ai tưởng là rò.
   */
  async resolveActor(user: RecruitRequestUser, routeKey: RecruitRouteKey): Promise<RecruitActor> {
    const p = RECRUIT_ROUTE_PAIRS[routeKey];
    const [routeScopeOrNull, interviewViewScope, candidateUpdateScope, offerManageScope] =
      await this.dataScope.resolveManyOrNull(user.id, user.companyId, [
        // [0] cặp của route — cờ sensitive lấy từ BẢNG, không gõ lại literal.
        { action: p.action, resourceType: p.resourceType, isSensitive: p.isSensitive },
        // [1] không khai isSensitive — giữ NGUYÊN hành vi cũ (resolveOrNull không truyền opts).
        { action: "view", resourceType: "interview" },
        // [2] isSensitive:true TƯỜNG MINH — thiếu cờ thì wildcard *:* mở khoá PII (plan §4.4).
        { action: "update", resourceType: "candidate", isSensitive: true },
        // [3] isSensitive:false TƯỜNG MINH — manage:offer KHÔNG sensitive (REC-DEC-004, §9f:569).
        { action: "manage", resourceType: "offer", isSensitive: false },
      ]);
    // Tầng 2 — assert đúng cặp + đúng cờ sensitive; 403 AUTH-ERR-FORBIDDEN khi thiếu grant.
    // `resolveManyOrNull` KHÔNG ném (hợp đồng của nó), nên assert ở ĐÂY phải giữ nguyên CHUỖI mà
    // `resolveAndAssert` vẫn ném — mã lỗi này là hợp đồng với FE/QA, không phải văn bản tự do.
    if (routeScopeOrNull == null) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }
    const routeScope = routeScopeOrNull;
    // SÀN SCOPE (FULL gate security M1, khuôn ROOM resolveViewActor + dash-widget-gate-needs-scope-floor):
    // cặp §13.6 CHỈ-Company mà grant resolve ra hẹp hơn ⇒ TỪ CHỐI, không "coi như" Company — một lần
    // đổi data_scope per-pair sau này không được âm thầm nới thành toàn công ty.
    if (p.companyFloor && !RecruitAccessService.isCompany(routeScope)) {
      throw new ForbiddenException(
        "AUTH-ERR-SCOPE-DENIED: cặp RECRUIT này chỉ hợp lệ ở scope Company",
      );
    }
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
