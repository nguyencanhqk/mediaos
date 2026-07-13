import { Injectable, Logger } from "@nestjs/common";
import { DATA_SCOPES, type DataScope } from "@mediaos/contracts";
import type {
  BatchActionSpec,
  BatchDecisions,
  CanInput,
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  PermissionContext,
  PermissionDecision,
} from "./permission.types";
import { decideCan, isGrantActive } from "./permission.decide";

/** Scope strength order (BACKEND-03 §18.1): higher = wider visibility. */
const SCOPE_STRENGTH: Record<DataScope, number> = {
  Own: 1,
  Team: 2,
  Department: 3,
  Company: 4,
  System: 5,
};

/**
 * FIX-1-CAP-EXPOSE (S2-AUTH-BE-5) — ALLOWLIST cặp quyền NHẠY CẢM được phép PHƠI vào /auth/me `capabilities`
 * dưới dạng GỢI Ý UI (FE render/ẩn entry điều hướng, vd trang Audit-log viewer). getCapabilities() CỐ Ý lọc bỏ
 * MỌI grant sensitive (FE không được suy quyền nhạy cảm từ map gợi ý) ⇒ FE useCan() trên cặp nhạy cảm luôn
 * false. Allowlist này TÁI MỞ có kiểm soát ĐÚNG các cặp view-only ĐỌC — KHÔNG nới enforcement (cổng thật vẫn là
 * can()/PermissionGuard per-resource). Cặp = "action:resourceType" khớp SEED THẬT (mig 0340: view:audit-log
 * is_sensitive=true), KHÔNG theo mã FE. Wildcard *:* KHÔNG nằm trong allowlist ⇒ KHÔNG kế thừa (mirror sensitive
 * gate của can(): wildcard không thoả cặp nhạy cảm). Thêm cặp mới ⇒ thêm dòng ở đây (curated, append-only).
 *
 * S3-FE-REGISTRY-1 (beCapExpose) — APPEND 4 cặp ATT/LEAVE view NHẠY CẢM để FE dựng CỜ HIỂN THỊ nav
 * (att.team-records / att.records / trang leave). Cặp seed THẬT is_sensitive=true (attendance-permissions.const
 * mig 0454: view-own/view-team/view-company·attendance; leave-permissions.const mig 0455: view·leave). KHÔNG
 * thêm view-own:leave / approve:leave (đã non-sensitive ⇒ lộ qua getCapabilities, không thuộc allowlist).
 * Enforcement KHÔNG đổi — chỉ mở cờ hiển thị (UI-hint).
 *
 * S2-AUTH-CAP-1 — APPEND 3 cặp NHẠY CẢM để FE dựng CỜ HIỂN THỊ: nút export nghỉ phép + viewer audit-log
 * LEAVE/ATT. Cặp seed THẬT is_sensitive=true, grant Company CHỈ hr(0011)+company-admin(0001):
 *   export:leave              — leave-permissions.const:60 / mig 0455
 *   view:leave-audit-log      — leave-permissions.const:85 / mig 0455
 *   view:attendance-audit-log — attendance-permissions.const:84 / mig 0454
 * employee(0008)/manager(0010) KHÔNG có grant ⇒ least-privilege; wildcard *:* KHÔNG thuộc allowlist ⇒ KHÔNG
 * kế thừa. Enforcement (can()/PermissionGuard per-resource) KHÔNG đổi — chỉ mở cờ hiển thị (UI-hint).
 */
const SENSITIVE_CAPABILITY_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  "view:audit-log",
  // S3-FE-REGISTRY-1 — APPEND-only (giữ view:audit-log ở trên):
  "view-own:attendance",
  "view-team:attendance",
  "view-company:attendance",
  "view:leave",
  // S2-AUTH-CAP-1 — APPEND-only (giữ 5 cặp trên nguyên vẹn):
  "export:leave",
  "view:leave-audit-log",
  "view:attendance-audit-log",
  // S2-AUTH-BE-12 — APPEND-only: admin reset 2FA của user khác (is_sensitive=true, mig 0466). Mở CỜ HIỂN
  // THỊ cho FE (nút reset-2FA trong màn user-admin); enforcement THẬT vẫn là PermissionGuard per-resource
  // (@RequirePermission('reset-2fa','user',{isSensitive:true})) — allowlist KHÔNG nới cổng.
  "reset-2fa:user",
  // S2-AUTH-CAP-2 — APPEND-only: FE gate nút "Quản lý vai trò" (UserDetailPage/UserRolesPage,
  // PermissionGate assign-role:user) + nút "Phân quyền" (RoleDetailPage/RolesPage/RolePermissionsPage,
  // assign:permission). Cặp seed THẬT is_sensitive=true, grant Company CHỈ company-admin — thiếu allowlist
  // ⇒ nút ẨN với CẢ admin dù grant thật tồn tại (phát hiện 2026-07-07). Enforcement KHÔNG đổi.
  "assign-role:user",
  "assign:permission",
  // S2-AUTH-USEROPS-1 — APPEND-only: xóa mềm / khôi phục / admin đặt lại mật khẩu trên /system/users
  // (nút Xóa · tab Đã xóa + Khôi phục · Đặt lại mật khẩu). Cặp seed THẬT is_sensitive=true (mig 0476:
  // restore/reset-password INSERT mới; delete NÂNG từ false→true của mig 0005), grant Company CHỈ
  // company-admin. Thiếu allowlist ⇒ useCanExact false với CẢ admin (bài học CAP-2). Enforcement KHÔNG
  // đổi — PermissionGuard per-resource (@RequirePermission …, {isSensitive:true}) vẫn là cổng thật.
  "delete:user",
  "restore:user",
  "reset-password:user",
  // S3-ATT-EXPORT-1 — APPEND-only: FE gate nút "Xuất CSV" chấm công (AttendanceReportsPage/records,
  // PermissionGate export:attendance). Cặp seed THẬT is_sensitive=true (attendance-permissions.const:55,
  // mig 0454:42), grant Company CHỈ hr(0011)+company-admin(0001) (mig 0454:124-125). Thiếu allowlist ⇒
  // getAllowlistedSensitiveCapabilities KHÔNG surface ⇒ nút Export ẨN với CẢ HR/company-admin dù grant thật
  // tồn tại (bài học CAP-2/USEROPS-1). Enforcement KHÔNG đổi — @RequirePermission('export','attendance')
  // per-resource vẫn là cổng THẬT (data-scope Own/Team/Company áp TRƯỚC kết xuất). Chỉ mở CỜ HIỂN THỊ.
  "export:attendance",
  // S4-TASK-SEED-1 — APPEND-only: 8 cặp NHẠY CẢM TASK (is_sensitive=true, mig 0485 — grant per ma trận
  // SPEC-06 §9: company-admin đủ bộ @Company; manager các cặp project @Team [owner-check per-project ở
  // BE S4-TASK-BE-1]; hr view-report:project + export:task + view:task-audit-log @Company). done_when #5
  // yêu cầu admin thấy ĐỦ 23 cặp TASK qua /auth/me — thiếu allowlist thì 8 cặp này ẨN với CẢ admin (bài
  // học CAP-2/USEROPS-1/EXPORT-1). Grant-bound + DENY-override giữ; wildcard *:* KHÔNG kế thừa.
  // Enforcement KHÔNG đổi — @RequirePermission per-resource vẫn là cổng thật. Chỉ mở CỜ HIỂN THỊ.
  "delete:project",
  "close:project",
  "archive:project",
  "manage-member:project",
  "view-report:project",
  "delete:task",
  "export:task",
  "view:task-audit-log",
  // S4-NOTI-BE-3 — APPEND-only: 6 cặp NHẠY CẢM NOTI config (is_sensitive=true, seed mig 0481, catalog
  // pin ở notification-event-catalog.const.ts NOTI_CONFIG_PAIRS), grant Company CHỈ company-admin. Thiếu
  // allowlist ⇒ 6 cặp này ẨN với CẢ admin trên /auth/me — CAP-2 đã tái diễn (CAP-2/USEROPS-1/EXPORT-1),
  // done_when WO này bắt buộc phải thấy đủ 6 cặp qua /auth/me. Enforcement KHÔNG đổi — @RequirePermission
  // per-resource (notification-admin.controller.ts) vẫn là cổng thật. Chỉ mở CỜ HIỂN THỊ.
  "view:notification-config",
  "update:notification-config",
  "view:notification-template",
  "update:notification-template",
  "view:notification-delivery-log",
  "view:notification-audit-log",
  // HR-PROFILE-UI-1 — APPEND-only: 2 cặp NHẠY CẢM HR (is_sensitive=true, seed mig 0019/0442-band).
  // FE Hồ sơ nhân sự dùng useCan làm CỜ HIỂN THỊ: cột PII (giới tính/ngày sinh/ĐT/loại HĐ) trong catalog
  // Tùy chỉnh cột + nhãn "bị ẩn do phân quyền" vs "—" ở detail/panel. Thiếu allowlist ⇒ cột PII ẨN với
  // CẢ HR/company-admin dù grant thật tồn tại (bài học CAP-2/USEROPS-1/EXPORT-1 tái diễn). Enforcement
  // KHÔNG đổi — masking THẬT vẫn ở HrReadService per-row (canViewSensitive/revealSalary, isSensitive:true,
  // wildcard không mở; salary reveal ⟹ audit atomic). Chỉ mở CỜ HIỂN THỊ.
  "view-sensitive:employee",
  "view-salary:employee",
  // HR-PROFILE-UI-2 — APPEND-only: FE gate nút "Xuất CSV" màn Hồ sơ nhân sự (EmployeeListPage,
  // useCanExact export:employee). Cặp seed THẬT is_sensitive=true (mig 0491 flip false→true), grant
  // Company CHỈ hr + company-admin. Thiếu allowlist ⇒ getAllowlistedSensitiveCapabilities KHÔNG surface ⇒
  // nút Export ẨN với CẢ HR/company-admin dù grant thật tồn tại (bài học CAP-2/USEROPS-1/EXPORT-1).
  // Enforcement KHÔNG đổi — @RequirePermission('export','employee',{isSensitive:true}) per-resource +
  // data-scope Own/Team/Company áp TRƯỚC kết xuất + row cap 422 vẫn là cổng THẬT. Chỉ mở CỜ HIỂN THỊ.
  "export:employee",
  // S4-FE-DASH-3 — APPEND-only: 2 cặp NHẠY CẢM DASH config để FE dựng CỜ HIỂN THỊ màn
  // DashboardConfigPage (PermissionGate → useCanExact('view'/'update','dashboard-config')). Cặp seed THẬT
  // is_sensitive=true — catalog dashboard-widget-catalog.const.ts:314-324 (DASH.CONFIG.VIEW /
  // DASH.CONFIG.UPDATE), seed + grant mig 0484 khối (3); grant Company CHỈ company-admin —
  // DASH_GRANT_MATRIX:379-385 (employee/manager/hr KHÔNG có grant, least-privilege). Thiếu allowlist ⇒
  // getCapabilities() lọc bỏ sensitive + getAllowlistedSensitiveCapabilities KHÔNG surface ⇒ 2 cặp ẨN
  // với CẢ company-admin dù grant thật tồn tại ⇒ /auth/me KHÔNG BAO GIỜ trả → useCanExact luôn false ⇒
  // trang LUÔN EmptyState "không có quyền" trong app thật (bài học CAP-2/EXPORT-1/NOTI-BE-3, đã lặp 5+
  // lần). Enforcement KHÔNG đổi — @RequirePermission('view'/'update','dashboard-config',{isSensitive:true})
  // + PermissionGuard class-level (dashboard-config.controller.ts) + RLS company_id vẫn là cổng THẬT;
  // wildcard *:* KHÔNG thuộc allowlist ⇒ KHÔNG kế thừa. Chỉ mở CỜ HIỂN THỊ.
  "view:dashboard-config",
  "update:dashboard-config",
]);

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(private readonly repo: IPermissionRepository) {}

  /**
   * 4-tier permission check (§3b of G3-permission-engine.md).
   *
   * Priority (lower number = higher authority):
   *   1. Object-level DENY  → deny-explicit (immediate)
   *   2. Object-level ALLOW → allow (beats company-level; object grants are always exact — no wildcards)
   *   3. Company-level DENY (any role DENY across all roles) → deny-explicit
   *   4. Company-level ALLOW → allow (wildcards valid for non-sensitive only)
   *   5. Default            → deny-default
   *
   * Sensitive gate: wildcard grants (*:*) do NOT satisfy; requires exact non-wildcard ALLOW.
   * Defense-in-depth: effectivelySensitive = input.isSensitive OR any matching grant.isSensitive.
   *
   * expires_at: re-checked per call (cache-hit safety — not delegated to repository).
   * fail-closed: any DB/infrastructure error → DENY, logged, never false-ALLOW.
   */
  async can(input: CanInput): Promise<PermissionDecision> {
    // NOTE: requiresReauth / objectGrantRequired are consumed inside decideCan(input) — we destructure
    // only what the fetch + fail-closed log need here (keeps the decision logic in one place).
    const { userId, companyId, action, resourceType, resourceId, isSensitive = false, ctx } = input;

    try {
      const now = new Date();

      // ── Company-level grants ──────────────────────────────────────────────
      // Repository may include stale/expired rows (cache scenario). decideCan re-checks expiresAt.
      const rawCompanyGrants = await this.repo.getCompanyRoleGrants(userId, companyId);

      // ── Object-level grants ───────────────────────────────────────────────
      // Only queried when a specific resource instance is identified.
      // null/undefined resourceId = type-level check (Tầng 1+4 only, Tầng 3 skipped).
      const objectGrants =
        resourceId != null
          ? await this.repo.getObjectGrants(userId, companyId, resourceType, resourceId)
          : [];

      // ── Decide ────────────────────────────────────────────────────────────
      // Single source of truth (permission.decide.ts) — SHARED verbatim with canBatch(); the two paths
      // differ ONLY in the fetch above (single vs batched), never in the decision semantics.
      return decideCan(rawCompanyGrants, objectGrants, input, now);
    } catch (error: unknown) {
      // Fail-closed: DB/cache/network error → DENY. Never false-ALLOW on exception.
      // Log with full context so infra failures are distinguishable from legitimate denies.
      this.logger.error("permission.can() infrastructure error — fail-closed deny", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        action,
        resourceType,
        resourceId,
        requestId: ctx?.requestId,
      });
      return { allow: false, reason: "deny-default", auditRequired: isSensitive };
    }
  }

  /**
   * HR-PERF-1 (beBatchPermHr) — BATCHED 4-tier check for a PAGE of resource instances (same user,
   * company, resourceType). For a list surface (e.g. HR employees) this replaces the per-row 2N can()
   * loop with a fixed ≤2 repository reads: getCompanyRoleGrants ONCE + getObjectGrantsBatch ONCE.
   *
   * Each (resourceId × action) decision is computed by the SAME decideCan() as can() — so a batched
   * decision is BYTE-IDENTICAL to the per-row can() (object-DENY priority-1, sensitive wildcard-fail,
   * company-DENY override, fail-closed all preserved). Returns a Map<resourceId, Map<action, decision>>
   * with an entry for EVERY (resourceId × action).
   *
   * Fail-closed: ANY repository error → EVERY cell is a deny-default (allow:false), mirror of can()'s
   * catch (auditRequired = the action's isSensitive). Never false-ALLOW on infrastructure failure.
   */
  async canBatch(
    userId: string,
    companyId: string,
    resourceType: string,
    resourceIds: string[],
    actions: BatchActionSpec[],
    ctx?: PermissionContext,
  ): Promise<BatchDecisions> {
    try {
      if (resourceIds.length === 0) return new Map();
      const now = new Date();

      // ≤2 repository reads for the whole page (vs 2N with per-row can()).
      const rawCompanyGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const objectBatch = await this.repo.getObjectGrantsBatch(
        userId,
        companyId,
        resourceType,
        resourceIds,
      );

      const result: BatchDecisions = new Map();
      for (const resourceId of resourceIds) {
        const objectGrants = objectBatch.get(resourceId) ?? [];
        const perAction = new Map<string, PermissionDecision>();
        for (const spec of actions) {
          const input: CanInput = {
            userId,
            companyId,
            action: spec.action,
            resourceType,
            resourceId,
            isSensitive: spec.isSensitive,
            requiresReauth: spec.requiresReauth,
            objectGrantRequired: spec.objectGrantRequired,
            ctx,
          };
          perAction.set(spec.action, decideCan(rawCompanyGrants, objectGrants, input, now));
        }
        result.set(resourceId, perAction);
      }
      return result;
    } catch (error: unknown) {
      // Fail-closed GLOBALLY: one infra failure denies the WHOLE page — mirror can()'s catch per cell.
      this.logger.error("permission.canBatch() infrastructure error — fail-closed deny (page)", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        resourceType,
        count: resourceIds.length,
        requestId: ctx?.requestId,
      });
      const denied: BatchDecisions = new Map();
      for (const resourceId of resourceIds) {
        const perAction = new Map<string, PermissionDecision>();
        for (const spec of actions) {
          perAction.set(spec.action, {
            allow: false,
            reason: "deny-default",
            auditRequired: spec.isSensitive ?? false,
          });
        }
        denied.set(resourceId, perAction);
      }
      return denied;
    }
  }

  /**
   * AC-5 — danh sách scope (catalog entry) actor được phép gán cho PAT = toàn catalog ∩ grant THỰC actor.
   * Dùng dựng bộ chọn scope FE. Lỗi DB → [] (fail-safe cho UI hint; create vẫn ép lại scope ⊆ grant).
   */
  async listGrantableScopes(
    userId: string,
    companyId: string,
  ): Promise<Array<{ id: string; action: string; resourceType: string; isSensitive: boolean }>> {
    try {
      const catalog = await this.repo.getAllPermissions();
      if (catalog.length === 0) return [];
      const grantedIds = await this.userGrantsPermissionIds(
        userId,
        companyId,
        catalog.map((p) => p.id),
      );
      const grantedSet = new Set(grantedIds);
      return catalog.filter((p) => grantedSet.has(p.id));
    } catch (error: unknown) {
      this.logger.error("listGrantableScopes() infrastructure error — returning empty", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return [];
    }
  }

  /**
   * Returns a flat map of non-sensitive capabilities for the given user.
   * Key format: "${action}:${resourceType}" — wildcards included as-is (FE handles multi-key lookup).
   * Only non-sensitive grants; sensitive permissions require explicit per-resource checks.
   * Deny-overrides-across-roles applied: any DENY removes the key entirely.
   * On error → empty map (fail-safe for UI hints, never fail-closed like can()).
   */
  async getCapabilities(userId: string, companyId: string): Promise<Record<string, boolean>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now) && !g.isSensitive);

      const denyKeys = new Set<string>();
      for (const g of grants) {
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }

      // Wildcard-aware deny check: a DENY on *:T or A:* or *:* suppresses matching ALLOW keys.
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const caps: Record<string, boolean> = {};
      for (const g of grants) {
        if (g.effect === "ALLOW" && !isDenied(g.action, g.resourceType)) {
          caps[`${g.action}:${g.resourceType}`] = true;
        }
      }
      return caps;
    } catch (error: unknown) {
      this.logger.error("getCapabilities() infrastructure error — returning empty map", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return {};
    }
  }

  /**
   * FIX-1-CAP-EXPOSE (S2-AUTH-BE-5) — map cờ cho các cặp NHẠY CẢM trong SENSITIVE_CAPABILITY_ALLOWLIST mà user
   * THỰC SỰ được ALLOW ở cấp-role (company-tier). getCapabilities() lọc bỏ TẤT CẢ sensitive ⇒ FE useCan() trên
   * cặp nhạy cảm luôn false (vd viewer audit-log không bao giờ render được). Method này surface CÓ KIỂM SOÁT ĐÚNG
   * cặp allowlist để FE render entry/nav. KHÔNG đổi semantics getCapabilities() (caller module-catalog giữ
   * nguyên) và KHÔNG phải cổng enforcement — can()/PermissionGuard per-resource vẫn là cổng THẬT.
   *
   * Thuật toán = Y HỆT getCapabilities (đọc getCompanyRoleGrants, isGrantActive, deny-override wildcard-aware) +
   * 2 ràng buộc:
   *   - chỉ thêm key khi cặp LITERAL "action:resourceType" ∈ allowlist ⇒ wildcard (*:* / view:*) KHÔNG khớp
   *     allowlist ⇒ KHÔNG kế thừa (mirror sensitive gate can(): wildcard không thoả cặp nhạy cảm).
   *   - deny-override tính trên TẤT CẢ active grants (DENY trên cặp nhạy cảm HOẶC wildcard *:* đều suppress) —
   *     an toàn hơn getCapabilities (vốn chỉ tính deny trên tập non-sensitive).
   * Lỗi hạ tầng → {} (fail-safe UI hint — KHÔNG fail-closed như can()).
   */
  async getAllowlistedSensitiveCapabilities(
    userId: string,
    companyId: string,
  ): Promise<Record<string, boolean>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const active = rawGrants.filter((g) => isGrantActive(g.expiresAt, now));

      const denyKeys = new Set<string>();
      for (const g of active) {
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const caps: Record<string, boolean> = {};
      for (const g of active) {
        if (g.effect !== "ALLOW") continue;
        const key = `${g.action}:${g.resourceType}`;
        // Allowlist gate: chỉ cặp LITERAL nhạy cảm được phép (wildcard không có trong allowlist ⇒ loại bỏ ⇒
        // sensitive KHÔNG kế thừa qua *:*). Sau đó áp deny-override wildcard-aware (mirror getCapabilities).
        if (!SENSITIVE_CAPABILITY_ALLOWLIST.has(key)) continue;
        if (isDenied(g.action, g.resourceType)) continue;
        caps[key] = true;
      }
      return caps;
    } catch (error: unknown) {
      this.logger.error(
        "getAllowlistedSensitiveCapabilities() infrastructure error — returning empty map",
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          companyId,
        },
      );
      return {};
    }
  }

  /**
   * S2-AUTH-BE-1 — union data_scope cho từng cặp ALLOW non-sensitive (cho /auth/me `scopes`, BACKEND-03 §15.3
   * rule 6). KEYSET Y HỆT getCapabilities: chỉ ALLOW non-sensitive; cặp bị DENY-override (wildcard-aware) bị
   * LOẠI hoàn toàn (KHÔNG union). Mảng scope đã DEDUPE. Lỗi hạ tầng → {} (fail-safe UI hint; guard BE-2 là cổng
   * thật). Độc lập getCapabilities: nếu method này lỗi mà getCapabilities ok, /me trả caps không kèm scope —
   * chấp nhận (chỉ là gợi ý FE).
   */
  async getCapabilityScopes(
    userId: string,
    companyId: string,
  ): Promise<Record<string, DataScope[]>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrantsWithScope(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now) && !g.isSensitive);

      const denyKeys = new Set<string>();
      for (const g of grants) {
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const scopeSets = new Map<string, Set<DataScope>>();
      for (const g of grants) {
        if (g.effect !== "ALLOW" || isDenied(g.action, g.resourceType)) continue;
        const key = `${g.action}:${g.resourceType}`;
        const set = scopeSets.get(key) ?? new Set<DataScope>();
        set.add(g.dataScope as DataScope);
        scopeSets.set(key, set);
      }

      const out: Record<string, DataScope[]> = {};
      for (const [key, set] of scopeSets) out[key] = [...set];
      return out;
    } catch (error: unknown) {
      this.logger.error("getCapabilityScopes() infrastructure error — returning empty map", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return {};
    }
  }

  /**
   * S2-AUTH-BE-2 — effective (strongest) data_scope cho 1 cặp (action,resourceType) ĐÃ được phép.
   * Đây là phần "scope" của cổng cuối: consumer (HR list/detail) dùng để dịch sang điều kiện query.
   *
   * Thuật toán (PIN chống nới scope ngầm — BACKEND-03 §18, plan-review):
   *   1. DENY-overrides (wildcard-aware) khớp → null (chặn, ưu tiên cao nhất).
   *   2. Mỗi grant đóng góp ĐÚNG dataScope của chính nó — KHÔNG nâng cấp (vd: *:* mang 'Company' KHÔNG thành System).
   *   3. Sensitive (caller-hint HOẶC grant.isSensitive) → chỉ EXACT non-wildcard ALLOW đủ điều kiện (mirror can()).
   *   4. EXACT > WILDCARD: có exact ALLOW đủ điều kiện → mạnh nhất trong exact; else (non-sensitive) → mạnh nhất wildcard.
   *   5. Không đủ điều kiện → null. Lỗi hạ tầng → fail-closed null (KHÁC getCapabilityScopes fail-safe {} cho UI).
   * KHÔNG đụng can() hot-path; method độc lập, read-only.
   */
  async resolveStrongestScope(
    userId: string,
    companyId: string,
    action: string,
    resourceType: string,
    opts?: { isSensitive?: boolean },
  ): Promise<DataScope | null> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrantsWithScope(userId, companyId);
      const grants = rawGrants.filter((grant) => isGrantActive(grant.expiresAt, now));

      const matches = (grant: CompanyRoleGrantWithScope): boolean =>
        (grant.action === action || grant.action === "*") &&
        (grant.resourceType === resourceType || grant.resourceType === "*");

      // Deny-overrides-across-roles (wildcard-aware) — any matching DENY blocks all scope.
      if (grants.some((grant) => grant.effect === "DENY" && matches(grant))) return null;

      const allowMatches = grants.filter((grant) => grant.effect === "ALLOW" && matches(grant));
      if (allowMatches.length === 0) return null;

      const isExact = (grant: CompanyRoleGrantWithScope): boolean =>
        grant.action === action && grant.resourceType === resourceType;

      // Sensitive gate (mirror can() §3b): wildcard ALLOW does NOT satisfy a sensitive pair.
      const effectivelySensitive =
        (opts?.isSensitive ?? false) || allowMatches.some((grant) => grant.isSensitive);

      let eligible: CompanyRoleGrantWithScope[];
      if (effectivelySensitive) {
        // Mirror can() (:124-131): only exact (non-wildcard) ALLOW satisfies a sensitive pair.
        eligible = allowMatches.filter(isExact);
      } else {
        const exact = allowMatches.filter(isExact);
        eligible = exact.length > 0 ? exact : allowMatches;
      }
      if (eligible.length === 0) return null;

      // Strongest scope among eligible; each grant contributes its own scope (no upgrade).
      let best: DataScope | null = null;
      let bestStrength = 0;
      for (const grant of eligible) {
        const scope = normalizeScope(grant.dataScope);
        if (scope == null) continue;
        const strength = SCOPE_STRENGTH[scope];
        if (strength > bestStrength) {
          bestStrength = strength;
          best = scope;
        }
      }
      return best;
    } catch (error: unknown) {
      this.logger.error("resolveStrongestScope() infrastructure error — fail-closed null", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        action,
        resourceType,
      });
      return null;
    }
  }

  /**
   * AC-5 — filter `permissionIds` xuống tập user THỰC SỰ được phép (effective ALLOW, đã trừ DENY-overrides
   * + bỏ wildcard). Dùng lúc TẠO PAT: scope của key PHẢI ⊆ tập này (PAT KHÔNG vượt quyền user, fail-closed).
   *
   * Cách tính: với mỗi permission id → (action, resourceType, isSensitive) qua catalog; user "có" nếu một
   * company-grant ALLOW khớp (exact với sensitive — wildcard KHÔNG thoả gate nhạy cảm, mirror can()) VÀ
   * KHÔNG bị DENY khớp (deny-overrides). Trả tập con của `permissionIds`. Lỗi DB → [] (fail-closed: không
   * giao id nào → caller từ chối tạo key vượt quyền). KHÔNG xét object-grant (PAT là company-tier capability).
   */
  async userGrantsPermissionIds(
    userId: string,
    companyId: string,
    permissionIds: string[],
  ): Promise<string[]> {
    if (permissionIds.length === 0) return [];
    try {
      const now = new Date();
      const catalog = await this.repo.getPermissionsByIds(permissionIds);
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now));

      const matches = (g: CompanyRoleGrant, action: string, resourceType: string): boolean =>
        (g.action === action || g.action === "*") &&
        (g.resourceType === resourceType || g.resourceType === "*");

      return catalog
        .filter((p) => {
          const denied = grants.some(
            (g) => g.effect === "DENY" && matches(g, p.action, p.resourceType),
          );
          if (denied) return false;
          const allows = grants.filter(
            (g) => g.effect === "ALLOW" && matches(g, p.action, p.resourceType),
          );
          if (allows.length === 0) return false;
          // Sensitive gate: wildcard KHÔNG thoả — cần exact non-wildcard ALLOW (mirror can()).
          if (p.isSensitive) {
            return allows.some((g) => g.action !== "*" && g.resourceType !== "*");
          }
          return true;
        })
        .map((p) => p.id);
    } catch (error: unknown) {
      this.logger.error(
        "userGrantsPermissionIds() infrastructure error — fail-closed (empty set)",
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          companyId,
        },
      );
      return [];
    }
  }
}

/** Narrows an arbitrary string to a known DataScope, or null when it is not a recognised scope. */
function normalizeScope(value: string): DataScope | null {
  return (DATA_SCOPES as readonly string[]).includes(value) ? (value as DataScope) : null;
}
