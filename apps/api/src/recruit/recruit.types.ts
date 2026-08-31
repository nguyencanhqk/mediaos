import type { SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import type { RecruitRouteKey } from "./recruit-route-pairs.const";

/** Actor lấy từ JWT (JwtAuthGuard → CompanyGuard). */
export interface RecruitRequestUser {
  id: string;
  companyId: string;
}

/**
 * S12-RECRUIT-BE-1 — ngữ cảnh phạm vi của actor, resolve ĐÚNG MỘT LẦN mỗi request ở
 * `RecruitAccessService.resolveActor(user, routeKey)` rồi truyền xuống repository/mapper (mirror
 * `RoomActor` — memory `reused-method-must-be-actor-scoped`).
 *
 *   • Tầng guard THỨ HAI nằm trong `resolveActor`: assert cặp của `RECRUIT_ROUTE_PAIRS[routeKey]`
 *     (kèm `isSensitive` đúng cờ) — 403 khi thiếu grant, độc lập với decorator route.
 *   • `peopleVisibleCond` — vị từ trên `users` cho `identityColumns`, suy từ scope của CHÍNH cặp
 *     route đang phục vụ: Company/System ⇒ `true`; hẹp hơn/`null` ⇒ fail-closed `users.id = actor`.
 *   • `interviewViewScope` — scope `('view','interview')` resolve KHÔNG ném (quyết định 010 vs 011 ở
 *     feedback + lọc Own list interview). `null` = không có cặp.
 *   • `canSeeCandidatePii` / `canSeeSalary` — cờ masking tính MỘT lần (isSensitive tường minh, plan
 *     §4.4/§4.5): `('update','candidate')` sensitive · `('manage','offer')` non-sensitive (REC-DEC-004).
 */
export interface RecruitActor {
  actorUserId: string;
  companyId: string;
  routeKey: RecruitRouteKey;
  /** Scope của cặp route đang phục vụ (đã assert ≠ null ở tầng 2). */
  routeScope: DataScope;
  /** Vị từ trên `users` (KHÔNG alias) cho `identityColumns`. */
  peopleVisibleCond: SQL;
  /** Scope `('view','interview')` — KHÔNG ném; null = không có cặp. */
  interviewViewScope: DataScope | null;
  /** `('update','candidate')` (isSensitive:true) — email/phone ứng viên nguyên vẹn. */
  canSeeCandidatePii: boolean;
  /** `('manage','offer')` (isSensitive:false — REC-DEC-004) — khoá `salary` xuất hiện. */
  canSeeSalary: boolean;
}

/** Trang `page`/`per_page` → offset (đã qua Zod). */
export const recruitOffset = (page: number, perPage: number): number => (page - 1) * perPage;

/** Người sau khi chiếu danh tính (map `userId → …`). */
export interface RecruitPersonRef {
  userId: string;
  displayName: string | null;
  employeeCode: string | null;
}
export type RecruitPeopleMap = ReadonlyMap<string, RecruitPersonRef>;
