import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  FOUNDATION_ERROR_CODES,
  type AuditLogDto,
  type AuditLogListResponse,
  type AuditLogQuery,
} from "@mediaos/contracts";
import { DatabaseService } from "../../db/db.service";
import { AuditMaskerService } from "../../events/audit-masker.service";
import { DataScopeService } from "../../permission/data-scope.service";
import { fromScope, type IdentityGrant } from "../../permission/identity-projection";
import { auditLogs } from "../../db/schema";
import type { AuditLog } from "../../db/schema/audit";
import { AuditRepository, type AuditFilter } from "./audit.repository";

/** Actor HTTP của đường COMPANY — `id` BẮT BUỘC vì `data_scope` không resolve được nếu thiếu. */
export interface AuditActor {
  id: string;
  companyId: string;
}

/**
 * AuditQueryService (FOUNDATION-BE-3) — đọc audit chỉ-đọc theo 2 scope, tách bạch ở TẦNG SERVICE
 * (KHÔNG để controller tự chọn context):
 *   - COMPANY: `withTenant(companyId)` → RLS ép chỉ thấy audit của tenant hiện tại (BACKEND-04 §9.5).
 *   - SYSTEM (operator): `withPlatformReadContext()` → đọc CHÉO tenant SELECT-only (GUC hẹp, mig 0340);
 *     `?companyId` (nếu có) áp WHERE để khoanh 1 tenant, mặc định = mọi tenant.
 *
 * BẤT BIẾN #3 — redact-at-read (D5): map row→DTO che lại before/after/oldValues/newValues qua
 * AuditMaskerService (DÙNG CHUNG hàm mask với mask-at-write) ⇒ phủ cả hàng audit CŨ ghi trước khi
 * mask-at-write tồn tại. changed_fields chỉ là TÊN field nên an toàn truyền thẳng.
 *
 * Tên class CỐ Ý khác `AuditService` (events/) — service này CHỈ đọc/redact, không ghi.
 *
 * ── S10-SEC-AUDITLOGROW-2 (KI-072): TẬP HÀNG của đường COMPANY đi theo `data_scope` ───────────────
 * `withTenant` + RLS chặn CHÉO TENANT — nó KHÔNG chặn TRONG tenant. Trước WO này, docstring "COMPANY
 * scope" ở trên là một Ý ĐỊNH: không dòng nào resolve `data_scope`, nên vai `view:audit-log@Own` đọc
 * trọn `audit_logs` của tenant và dò được lịch sử hành động của UUID bất kỳ qua `?actorUserId=`.
 * Nay `rowScopeFor()` dựng vị từ và `*ForActorTx` AND nó vào `WHERE` + `count(*)`.
 *
 * ⚠️ PHẠM VI ĐÃ ĐÓNG = HAI route COMPANY của lớp này. Đường operator `/all` (cặp `view:platform-audit`,
 * `withPlatformReadContext`) và `ChatOversightRepository.listOversightAudit` (cặp CHAT) VẪN đọc
 * `audit_logs` không bound hàng — cặp quyền khác, WO khác. Đừng đọc "KI-072 đóng" thành "`audit_logs`
 * đã bound".
 */
@Injectable()
export class AuditQueryService {
  private readonly logger = new Logger(AuditQueryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AuditRepository,
    private readonly masker: AuditMaskerService,
    // BẮT BUỘC — nguồn của tầng chặn TẬP HÀNG. Docstring lớp từng ghi "COMPANY scope" như một sự thật;
    // nó là ý định (KI-072). Tiêm ở SERVICE, KHÔNG ở `AuditRepository`: repo phải giữ zero-dep vì
    // AttendanceModule/LeaveModule tự provide nó (xem docblock repo).
    private readonly dataScope: DataScopeService,
  ) {}

  /**
   * S10-SEC-AUDITLOGROW-2 (KI-072) — vị từ chặn **TẬP HÀNG** của `audit_logs`, theo `data_scope` của
   * cặp **`view:audit-log`** (chính cặp GATE của hai route COMPANY).
   *
   * ⚠️ NGỮ NGHĨA `Own` Ở BẢNG NÀY = "hàng do TÔI GÂY RA" (`actor_user_id`), **KHÁC** `login_logs`
   * (`Own` = hàng VỀ tôi, bám `user_id` — ranh giới D7 của S10-SEC-AUDITLOGROW-1). Không phải một lựa
   * chọn giữa hai phương án: `audit_logs` chỉ có MỘT cột người.
   *
   * Hệ quả CÓ CHỦ ĐÍCH, đừng "sửa": `actor_user_id` NULLABLE, và `NULL = uuid` cho **NULL** chứ không
   * TRUE ⇒ hàng do job máy/hệ thống ghi (360 hàng trên PROD 22/08) **biến mất khỏi mọi vai `Own`**.
   * Đó là fail-closed đúng chiều — một vai `Own` không có căn cứ nào để xem hành động không ai gây ra.
   * Nới thành `OR actor_user_id IS NULL` là mở toang TOÀN BỘ hàng hệ thống của tenant cho mọi vai
   * `Own`. Ca `N1` của `foundation-audit-row-scope.int-spec.ts` ghim chiều này.
   *
   * ⚠️ Ở đây cặp GATE **chính là** cặp BOUND, nên `null` sau khi guard đã cho qua KHÔNG phải "actor
   * không có cặp danh bạ" — nó nghĩa là **guard và trình phân giải scope BẤT ĐỒNG**, một trạng thái
   * không được im lặng ⇒ 403 fail-closed. Ba nguyên nhân đã biết cho cùng một `null`, và log KHÔNG
   * được chẩn đoán hộ chỉ một trong ba: (K1) kill-switch; (K2) grant vừa bị gỡ — guard còn phục vụ từ
   * cache 300s trong khi `getCompanyRoleGrantsWithScope` đọc thẳng DB; (K3) `data_scope` trong DB
   * không chuẩn hoá được ⇒ `resolveStrongestScope` fail-closed VĨNH VIỄN (không phải cửa sổ).
   *
   * VÌ SAO KHÔNG `resolveAndAssert` (nó ném đúng 403 này): hàm đó **không log một dòng nào**, nên 403
   * của nó không phân biệt được với 403 của guard ở mọi tầng vận hành. Và KHÔNG thêm log vào trong nó:
   * ~101 call-site dùng nó làm cổng DUY NHẤT, ở đó `null` là deny BÌNH THƯỜNG ⇒ báo động giả hàng loạt.
   *
   * ⚠️ Chuỗi message giữ **NGUYÊN VĂN** của `resolveAndAssert`. `AllExceptionsFilter` không phân biệt
   * exception ném từ guard với ném từ service, nên `status`/`code`/`type`/`details` giống hệt 403 của
   * guard; chỉ `message` khác, và khác biệt đó chỉ nói cho actor về grant CỦA CHÍNH HỌ. Cái KHÔNG được
   * phép là làm message giàu thông tin hơn ("scope resolution failed", tên cặp, tên bảng) — đó là oracle.
   *
   * `{ isSensitive: true }` soi gương `@RequirePermission("view","audit-log",{ isSensitive: true })`.
   * Bỏ nó thì kết quả vẫn đúng HÔM NAY (catalog có `is_sensitive=true`) — tức đúng nhờ DỮ LIỆU, không
   * nhờ code: lật cờ catalog là route mở cho wildcard `*:*`.
   *
   * ⚠️ KHAI BẰNG CÚ PHÁP METHOD, không phải property arrow: census `enclosing()` của
   * `identity-projection-census.ts` chỉ nhận `MethodDeclaration`/`FunctionDeclaration`; arrow property
   * trả `"?"` ⇒ `ROW_SCOPE_MINT_PINS` ĐỎ dù đã ký đúng chuỗi.
   *
   * ⚠️ CỐ Ý KHÔNG trích dùng chung với `AuthLogsViewerService.rowScopeFor` (khuôn gần như giống hệt):
   * trích là refactor CROWN chạm đường đã nghiệm thu, VÀ nó gộp hai bề mặt bound-HÀNG thành MỘT điểm
   * đúc ⇒ `ROW_SCOPE_MINT_PINS` (pin theo DANH SÁCH, không theo số đếm) mất khả năng nhìn thấy việc
   * `audit_logs` được bound. Xem plan D7.
   */
  private async rowScopeFor(actor: AuditActor, why: string): Promise<IdentityGrant> {
    const scope = await this.dataScope.resolveOrNull(
      actor.id,
      actor.companyId,
      "view",
      "audit-log",
      { isSensitive: true },
    );
    if (scope === null) {
      this.logger.error(
        "foundation-audit: guard cho qua nhưng resolveStrongestScope trả null — kill-switch (K1), " +
          "grant vừa bị gỡ trong cửa sổ cache guard (K2), HOẶC data_scope trong DB không chuẩn hoá " +
          "được (K3, vĩnh viễn); đối chiếu log `resolveStrongestScope() infrastructure error` cùng " +
          "request trước khi kết luận",
        { userId: actor.id, companyId: actor.companyId, where: why },
      );
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }
    return fromScope(
      this.dataScope.buildUserScopeConditionOn(
        scope,
        { userId: actor.id, companyId: actor.companyId },
        // `idCol` = cột NGƯỜI của hàng. Trên bảng này đó là `actorUserId` — KHÔNG phải `companyId`.
        // `rowScopeSql` chỉ assert TÊN BẢNG, mà hai cột cùng thuộc `audit_logs`, nên nhầm ở đây đi
        // LỌT cổng đó và biến vị từ `Own` thành `company_id = <uuid người dùng>` (0 hàng, im lặng).
        // Cái bắt được: ca ALLOW của `audit.service.spec.ts` + A2/A3 của int-spec.
        { idCol: auditLogs.actorUserId, companyIdCol: auditLogs.companyId },
      ),
      "scoped-predicate",
      why,
      // Buộc vị từ vào ĐÚNG bảng: `rowScopeSql` ném nếu ai đem grant này AND vào truy vấn bảng kia.
      auditLogs.actorUserId,
    );
  }

  /** COMPANY scope: list audit của tenant hiện tại — TẬP HÀNG theo `data_scope` (KI-072). */
  async listCompany(actor: AuditActor, query: AuditLogQuery): Promise<AuditLogListResponse> {
    const filter = this.toFilter(query, false);
    // CÓ THỂ NÉM 403 — cố ý để nó ném TRƯỚC khi chạm DB. `resolveOrNull` tự mở transaction riêng của
    // nó, nên gọi ở đây (ngoài `withTenant`) là đúng: không lồng transaction.
    const rowScope = await this.rowScopeFor(
      actor,
      "GET /foundation/audit-logs — TẬP HÀNG đi theo data_scope của cặp gate view:audit-log (KI-072)",
    );
    return this.db.withTenant(actor.companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.repo.findManyForActorTx(tx, rowScope, filter, query.limit, query.offset),
        // ⚠️ `rowScope` BẮT BUỘC ở đây nữa: đếm không có vị từ scope thì `pagination.total` rò số hàng
        // ngoài scope trong khi `data` sạch — oracle đếm được, không lộ ra ở body.
        this.repo.countForActorTx(tx, rowScope, filter),
      ]);
      return {
        data: rows.map((row) => this.toDto(row)),
        meta: { total, limit: query.limit, offset: query.offset },
      };
    });
  }

  /**
   * COMPANY scope: 1 dòng audit theo id — CHIỀU THỨ HAI, không phải hệ quả của đường list.
   *
   * Ba lý do một hàng "biến mất" — không tồn tại · thuộc tenant khác (RLS) · cùng tenant nhưng
   * `actor_user_id` ngoài scope — đều đi tới CÙNG nhánh 404 `AUDIT_NOT_FOUND`. Phân biệt lý do thứ ba
   * bằng 403 sẽ tạo oracle "id này có thật trong tenant của bạn, chỉ là của người khác" (plan D5).
   */
  async getCompanyDetail(actor: AuditActor, id: string): Promise<AuditLogDto> {
    const rowScope = await this.rowScopeFor(
      actor,
      "GET /foundation/audit-logs/:id — TẬP HÀNG đi theo data_scope của cặp gate view:audit-log (KI-072)",
    );
    const row = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.findByIdForActorTx(tx, rowScope, id),
    );
    if (!row)
      throw new NotFoundException({
        code: FOUNDATION_ERROR_CODES.AUDIT_NOT_FOUND,
        message: "Audit log không tồn tại",
      });
    return this.toDto(row);
  }

  /** SYSTEM scope: list audit CHÉO tenant (operator). `?companyId` khoanh 1 tenant nếu truyền. */
  async listSystem(query: AuditLogQuery): Promise<AuditLogListResponse> {
    const filter = this.toFilter(query, true);
    return this.db.withPlatformReadContext(async (tx) => {
      const [rows, total] = await Promise.all([
        this.repo.findManyUnscopedTx(tx, filter, query.limit, query.offset),
        this.repo.countUnscopedTx(tx, filter),
      ]);
      return {
        data: rows.map((row) => this.toDto(row)),
        meta: { total, limit: query.limit, offset: query.offset },
      };
    });
  }

  /** SYSTEM scope: 1 dòng audit theo id (chéo tenant). `companyId` khoanh tenant nếu truyền. */
  async getSystemDetail(id: string, companyId?: string): Promise<AuditLogDto> {
    const row = await this.db.withPlatformReadContext((tx) =>
      this.repo.findByIdUnscopedTx(tx, id, companyId),
    );
    if (!row)
      throw new NotFoundException({
        code: FOUNDATION_ERROR_CODES.AUDIT_NOT_FOUND,
        message: "Audit log không tồn tại",
      });
    return this.toDto(row);
  }

  /** Map query DTO → filter repo. companyId CHỈ áp ở System path (Company path đã RLS-scope). */
  private toFilter(query: AuditLogQuery, isSystem: boolean): AuditFilter {
    return {
      action: query.action,
      objectType: query.objectType,
      objectId: query.objectId,
      actorUserId: query.actorUserId,
      moduleCode: query.moduleCode,
      entityType: query.entityType,
      entityId: query.entityId,
      actorType: query.actorType,
      requestId: query.requestId,
      actionGroup: query.actionGroup,
      permissionCode: query.permissionCode,
      dataScope: query.dataScope,
      companyId: isSystem ? query.companyId : undefined,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    };
  }

  /** Map 1 row audit → DTO. before/after/oldValues/newValues ĐƯỢC redact lại tại đây (D5). */
  private toDto(row: AuditLog): AuditLogDto {
    return {
      id: row.id,
      companyId: row.companyId,
      actorUserId: row.actorUserId ?? null,
      action: row.action,
      objectType: row.objectType,
      objectId: row.objectId ?? null,
      before: this.masker.mask(row.before ?? null),
      after: this.masker.mask(row.after ?? null),
      ip: row.ip ?? null,
      userAgent: row.userAgent ?? null,
      moduleCode: row.moduleCode ?? null,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
      actorType: row.actorType ?? null,
      oldValues: this.masker.mask(row.oldValues ?? null),
      newValues: this.masker.mask(row.newValues ?? null),
      changedFields: (row.changedFields as string[] | null) ?? null,
      sensitivityLevel: row.sensitivityLevel ?? null,
      resultStatus: row.resultStatus ?? null,
      requestId: row.requestId ?? null,
      correlationId: row.correlationId ?? null,
      ipAddress: row.ipAddress ?? null,
      // ── DB-08 §8.5 (v2 mig 0438). deviceInfo/metadata redact-at-read (D5) — có thể chứa token/ip. ──
      actorEmployeeId: row.actorEmployeeId ?? null,
      actionGroup: row.actionGroup ?? null,
      entityIdText: row.entityIdText ?? null,
      entityCode: row.entityCode ?? null,
      permissionCode: row.permissionCode ?? null,
      dataScope: row.dataScope ?? null,
      deviceInfo: this.masker.mask(row.deviceInfo ?? null),
      diffSummary: row.diffSummary ?? null,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
      metadata: this.masker.mask(row.metadata ?? null),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
