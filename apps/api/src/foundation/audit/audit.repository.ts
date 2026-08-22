import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { rowScopeSql, type IdentityGrant } from "../../permission/identity-projection";
import { auditLogs } from "../../db/schema";

/**
 * Bộ lọc audit list/detail. Mọi field optional. `companyId` CHỈ có nghĩa ở đường SYSTEM
 * (withPlatformReadContext mở chéo tenant → operator có thể khoanh 1 tenant); đường COMPANY đã bị
 * withTenant + RLS ép sẵn nên KHÔNG truyền companyId vào filter (tránh nhầm/no-op).
 */
export interface AuditFilter {
  action?: string;
  objectType?: string;
  /**
   * S3-ATT-BE-6 — allowlist of object_type (IN, ANDed with objectType if both given). Used by module
   * scoped audit readers (e.g. AttendanceAuditService) to bound the read to THEIR object types
   * server-side (NOT client-controlled — module_code is not consistently populated by every writer, so
   * an object_type allowlist is the reliable module boundary).
   */
  objectTypes?: string[];
  objectId?: string;
  actorUserId?: string;
  moduleCode?: string;
  entityType?: string;
  entityId?: string;
  actorType?: string;
  requestId?: string;
  // ── DB-08 §8.5 filters (v2 mig 0438) ──
  actionGroup?: string;
  permissionCode?: string;
  dataScope?: string;
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * AuditRepository — đọc append-only `audit_logs`. Mọi truy vấn nhận `tx` từ withTenant (Company scope)
 * HOẶC withPlatformReadContext (System scope, SELECT-only) — KHÔNG tự mở context (giữ ranh giới tenant
 * ở tầng service). Chỉ SELECT/COUNT (append-only #2 — KHÔNG có path UPDATE/DELETE ở repo này).
 *
 * ── S10-SEC-AUDITLOGROW-2 (KI-072): HAI HỌ PHƯƠNG THỨC, đọc kỹ trước khi thêm đường đọc mới ───────
 *
 *   `*ForActorTx`  — BOUND HÀNG. Nhận `rowScope: IdentityGrant` BẮT BUỘC, AND vị từ `data_scope` của
 *                    cặp `view:audit-log` vào `WHERE`. **MỌI đường đọc COMPANY (có actor HTTP) PHẢI
 *                    dùng họ này.**
 *   `*UnscopedTx`  — KHÔNG bound. CHỈ dành cho: (a) đường operator `withPlatformReadContext` (chéo
 *                    tenant CÓ CHỦ Ý, cặp `view:platform-audit` — biên audience khác); (b)
 *                    `AttendanceAuditService`/`LeaveAuditService`, hai module tự bound bằng allowlist
 *                    `objectTypes` + cặp quyền RIÊNG của module.
 *
 * ⚠️ VÌ SAO tách bằng TÊN chứ không bằng một tham số `rowScope?` optional trên họ cũ: optional là field
 * QUÊN ĐƯỢC — đúng hình dạng khuyết tật mà KI-072 tồn tại để đóng, chỉ dịch từ `AuditFilter` sang tham
 * số hàm. Tên buộc người viết mới phải TỰ ĐỌC ra rằng mình đang chọn đường không bound.
 *
 * ⚠️ Và tên MỘT MÌNH cũng không đủ — họ `*UnscopedTx` vẫn public, vẫn hợp kiểu cho mọi caller.
 * `rowScopePredicateMints()` chỉ đếm điểm ĐÚC (`fromScope`), KHÔNG thấy điểm TIÊU THỤ. Cái ép bề mặt
 * tiêu thụ đứng yên là ASSERT TĨNH ở `test/foundation/identity-projection-ratchet.unit-spec.ts`
 * ("chiều 8"): nó pin `file#<số lời gọi>` ⇒ thêm một lời gọi họ `*UnscopedTx` **ở bất kỳ file nào,
 * kể cả file đã ký**, là ĐỎ. Đừng gỡ nó cho gọn.
 *
 * ⚠️ Và đây là ranh giới THẬT của assert đó, đừng đọc mạnh hơn (⟲FULL gate — bản đầu của docblock này
 * viết "thêm một hộ là ĐỎ", nói quá đúng vào chỗ người sau sẽ tin nhất): nó parse CHUỖI, không phải
 * call-graph. Nó KHÔNG thấy lời gọi gián tiếp qua biến/alias, và KHÔNG thấy đường đọc `audit_logs`
 * không đi qua lớp này (`tx.select().from(auditLogs)` trực tiếp — đúng cách
 * `chat/chat-oversight.repository.ts` đang đọc bảng này hôm nay, một nợ CÓ TÊN chưa cấp số).
 *
 * ⚠️ LỚP NÀY PHẢI GIỮ **ZERO dependency DI**. `attendance.module.ts` và `leave.module.ts` tự `provide`
 * `AuditRepository` cục bộ đúng vì nó không có dep nào; tiêm `DataScopeService` vào ĐÂY (thay vì vào
 * `AuditQueryService`) sẽ làm hai module đó sập ở boot ⇒ sập AppModule ⇒ hàng trăm spec đỏ dây chuyền.
 */
@Injectable()
export class AuditRepository {
  /** Dựng điều kiện WHERE từ filter (eq từng field + between created_at). companyId chỉ áp ở System path. */
  private buildWhere(filter: AuditFilter): SQL | undefined {
    const conds: SQL[] = [];
    if (filter.action) conds.push(eq(auditLogs.action, filter.action));
    if (filter.objectType) conds.push(eq(auditLogs.objectType, filter.objectType));
    if (filter.objectTypes && filter.objectTypes.length > 0)
      conds.push(inArray(auditLogs.objectType, filter.objectTypes));
    if (filter.objectId) conds.push(eq(auditLogs.objectId, filter.objectId));
    if (filter.actorUserId) conds.push(eq(auditLogs.actorUserId, filter.actorUserId));
    if (filter.moduleCode) conds.push(eq(auditLogs.moduleCode, filter.moduleCode));
    if (filter.entityType) conds.push(eq(auditLogs.entityType, filter.entityType));
    if (filter.entityId) conds.push(eq(auditLogs.entityId, filter.entityId));
    if (filter.actorType) conds.push(eq(auditLogs.actorType, filter.actorType));
    if (filter.requestId) conds.push(eq(auditLogs.requestId, filter.requestId));
    if (filter.actionGroup) conds.push(eq(auditLogs.actionGroup, filter.actionGroup));
    if (filter.permissionCode) conds.push(eq(auditLogs.permissionCode, filter.permissionCode));
    if (filter.dataScope) conds.push(eq(auditLogs.dataScope, filter.dataScope));
    if (filter.companyId) conds.push(eq(auditLogs.companyId, filter.companyId));
    if (filter.dateFrom) conds.push(gte(auditLogs.createdAt, new Date(filter.dateFrom)));
    if (filter.dateTo) conds.push(lte(auditLogs.createdAt, new Date(filter.dateTo)));
    return conds.length ? and(...conds) : undefined;
  }

  /**
   * S10-SEC-AUDITLOGROW-2 (KI-072) — `WHERE` của họ `*ForActorTx`: vị từ `data_scope` ĐỨNG ĐẦU, rồi
   * mới tới điều kiện từ `filter` (vốn đến TRỌN VẸN từ query param của caller).
   *
   * ⚠️ Thứ tự đó không phải thẩm mỹ: `filter` là dữ liệu của caller, `rowScope` là vị từ của hệ thống.
   * Đặt `rowScope` làm phần tử đầu của `conds` và làm THAM SỐ ĐẦU của hàm khiến "quên" nó thành lỗi
   * cú pháp, không phải một nhánh chạy được.
   *
   * Hệ quả cho `filter.actorUserId`: `?actorUserId=<người khác>` với scope `Own` cho
   * `actor_user_id = other AND actor_user_id = me` ⇒ **0 hàng + HTTP 200**, KHÔNG phải 403. Phép GIAO
   * là cố ý (plan D4): 403 ở đây phân biệt được "ngoài scope" với "không có hàng" ⇒ trả lời hộ câu
   * "UUID này có hoạt động trong tenant không" = oracle.
   *
   * ⚠️ RED-proof phải **THAY** `rowScopeSql(...)` bằng `sql\`true\``, TUYỆT ĐỐI KHÔNG xoá phần tử khỏi
   * `conds`: xoá làm một lượt gọi không-filter có `conds = []` ⇒ `and()` = `undefined` ⇒ `?? sql\`false\``
   * ⇒ 0 hàng ⇒ mọi ca DENY xanh-RỖNG và đột biến trông như "bản vá vẫn chạy".
   */
  private buildWhereForActor(rowScope: IdentityGrant, filter: AuditFilter): SQL {
    const scoped = this.buildWhere(filter);
    const rowCond = rowScopeSql(rowScope, auditLogs.actorUserId);
    return scoped ? (and(rowCond, scoped) ?? rowCond) : rowCond;
  }

  /** 1 trang audit theo filter + vị từ scope của actor, mới nhất trước. Đường COMPANY. */
  async findManyForActorTx(
    tx: TenantTx,
    rowScope: IdentityGrant,
    filter: AuditFilter,
    limit: number,
    offset: number,
  ) {
    return tx
      .select()
      .from(auditLogs)
      .where(this.buildWhereForActor(rowScope, filter))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Tổng số dòng khớp filter + vị từ scope (cho `pagination.total`).
   *
   * ⚠️ `rowScope` BẮT BUỘC ở đây y như `findManyForActorTx`, và đây là nửa dễ quên nhất của cả bản vá:
   * vá mỗi đường list thì `data` sạch trong khi `total` vẫn phát ra số hàng ngoài scope — một oracle
   * ĐẾM ĐƯỢC, không lộ ra ở body, không ai nhìn thấy khi test chỉ assert `data`.
   */
  async countForActorTx(
    tx: TenantTx,
    rowScope: IdentityGrant,
    filter: AuditFilter,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(this.buildWhereForActor(rowScope, filter));
    return row?.n ?? 0;
  }

  /**
   * 1 dòng theo id + vị từ scope của actor. Đường COMPANY.
   *
   * ⚠️ Vị từ dựng RIÊNG ở đây, KHÔNG đi qua `buildWhereForActor` (không có `AuditFilter` nào ở đường
   * detail) ⇒ RED-proof phải thay `rowScopeSql` ở CẢ HAI chỗ, thay một chỗ không chạm ca `/:id`.
   *
   * Hàng ngoài scope trả về `undefined` ⇒ service ném 404 CÙNG mã với "id của tenant khác" và "id
   * không tồn tại" (plan D5): ba lý do biến mất phải không phân biệt được với nhau, nếu không thì
   * chính mã lỗi trở thành oracle "id này có thật trong tenant của bạn".
   */
  async findByIdForActorTx(tx: TenantTx, rowScope: IdentityGrant, id: string) {
    const [row] = await tx
      .select()
      .from(auditLogs)
      .where(and(rowScopeSql(rowScope, auditLogs.actorUserId), eq(auditLogs.id, id)) ?? sql`false`)
      .limit(1);
    return row;
  }

  /**
   * 1 trang audit theo filter, KHÔNG bound hàng. Xem docblock lớp — chỉ operator + ATT/LEAVE viewer.
   */
  async findManyUnscopedTx(tx: TenantTx, filter: AuditFilter, limit: number, offset: number) {
    return tx
      .select()
      .from(auditLogs)
      .where(this.buildWhere(filter))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /** Tổng số dòng khớp filter, KHÔNG bound hàng. Xem docblock lớp. */
  async countUnscopedTx(tx: TenantTx, filter: AuditFilter): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(this.buildWhere(filter));
    return row?.n ?? 0;
  }

  /**
   * 1 dòng theo id, KHÔNG bound hàng. System scope: truyền companyId tường minh để khoanh tenant nếu
   * cần (GUC mở chéo nên không có RLS auto-scope). Xem docblock lớp.
   */
  async findByIdUnscopedTx(tx: TenantTx, id: string, companyId?: string) {
    const conds: SQL[] = [eq(auditLogs.id, id)];
    if (companyId) conds.push(eq(auditLogs.companyId, companyId));
    const [row] = await tx
      .select()
      .from(auditLogs)
      .where(and(...conds))
      .limit(1);
    return row;
  }
}
