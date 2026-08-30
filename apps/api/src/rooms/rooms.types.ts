import type { SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";

/** Actor lấy từ JWT (JwtAuthGuard → CompanyGuard). */
export interface RoomRequestUser {
  id: string;
  companyId: string;
}

/**
 * S11-ROOM-BE-1 — ngữ cảnh phạm vi của actor, resolve ĐÚNG MỘT LẦN mỗi request ở `RoomAccessService` rồi truyền
 * xuống repository/mapper (memory `reused-method-must-be-actor-scoped`).
 *
 * Hai trục TÁCH BẠCH (plan-review B1):
 *   • `viewScope` — cặp ĐỌC `('view','room')` (Company cho mọi role seed — SPEC-14 §11): căn cứ DUY NHẤT cho việc
 *     chiếu TÊN người (`peopleVisibleCond`). Company/System ⇒ `true`; hẹp hơn hoặc KHÔNG có cặp ⇒ FAIL-CLOSED
 *     `users.id = actor` (tên người khác về `null`, dữ liệu lượt vẫn thấy). Cặp gate của 010/012 (`book`/`cancel`)
 *     KHÁC cặp bound này ⇒ basis identity-projection = `identity-gated` (khuôn N-1c).
 *   • `writeScope` — cặp GATE của route ghi (`book` · `cancel` · `manage`): quyết định đặt hộ / huỷ lượt người khác.
 */
export interface RoomActor {
  actorUserId: string;
  companyId: string;
  /** Scope `('view','room')`; `null` = không có cặp (chỉ xảy ra ở route ghi với role tuỳ biến). */
  viewScope: DataScope | null;
  /** Vị từ trên `users` (KHÔNG alias) cho `identityColumns` — suy từ `viewScope`. */
  peopleVisibleCond: SQL;
  /** Scope của cặp ghi đang gate route (`book`/`cancel`/`manage`); `null` ở route đọc. */
  writeScope: DataScope | null;
  /** `writeScope ∈ {Company, System}` — đặt hộ / huỷ mọi lượt / quản trị phòng. */
  isCompanyWrite: boolean;
  /** Scope `('cancel','room-booking')` (để tính `canCancel` ở đường đọc); `null` = không có cặp. */
  cancelScope: DataScope | null;
}

/** Trang → limit/offset (page/per_page đã qua Zod). */
export interface PageInput {
  page: number;
  perPage: number;
}
export const toOffset = (p: PageInput): number => (p.page - 1) * p.perPage;

/** Người trong lượt sau khi chiếu danh tính (map `userId → …`). */
export interface RoomPersonRef {
  userId: string;
  displayName: string | null;
  employeeCode: string | null;
}
export type RoomPeopleMap = ReadonlyMap<string, RoomPersonRef>;
