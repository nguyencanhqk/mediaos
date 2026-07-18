import { Injectable, NotFoundException } from "@nestjs/common";
import { DEFAULT_EMPLOYEE_CODE_NUMBER_LENGTH, HR_PERSONAL_EXTRA_KEYS } from "@mediaos/contracts";
import type {
  HrContractTypeLookup,
  HrDepartmentLookup,
  HrEmployeeCodePreview,
  HrEmployeeDetail,
  HrEmployeeListItem,
  HrEmployeeListResponse,
  HrEmployeeListQuery,
  HrEmployeeSummary,
  HrJobLevelLookup,
  HrMeProfile,
  HrPositionLookup,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { CanInput } from "../permission/permission.types";
// S5-ME-BE-5 (additive): resolve avatar_url (fileId) → signed URL directory-class cho list/detail/me.
import { AvatarPresignService } from "../foundation/files/avatar-presign.service";
import { HrReadRepository, type HrDetailRow, type HrListRow } from "./hr-read.repository";

type RequestUser = { id: string; companyId: string };

/**
 * S2-HR-BE-1 — HR read core (SPEC-03 / API-10). Three surfaces, one masking layer:
 *   - listHrEmployees: gate (resolveAndAssert read:employee) → scope FILTER → per-row salary mask.
 *   - getHrEmployee: tenant read → in-scope check → field-level salary + PII mask.
 *   - getMyProfile: self lookup by userId (NOT scope) → same masking layer.
 * Lookups expose only non-sensitive reference data.
 *
 * BẤT BIẾN #1: every read runs in withTenant(caller.companyId); the scope predicate carries company_id
 * too (belt-and-suspenders over RLS). BẤT BIẾN #3: baseSalary + salaryType (view-salary) + PII phone/
 * notes/contractType (view-sensitive) are masked SERVER-side; a wildcard *:* grant does NOT reveal them
 * (both are sensitive catalog pairs → can() requires an exact ALLOW). Reveal ⟹ audit atomically:
 * the view-salary audit INSERT shares the caller's tenant tx, so a failed audit rolls back the read.
 */
@Injectable()
export class HrReadService {
  constructor(
    private readonly repo: HrReadRepository,
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    private readonly avatarPresign: AvatarPresignService,
  ) {}

  // ── Avatar directory-class resolve (S5-ME-BE-5) ───────────────────────────────────
  //
  // avatar_url lưu fileId (UUID) — KHÔNG hiển thị được trực tiếp. Resolve → signed URL SAU khi read chính đã
  // đóng (withTenant RIÊNG trong AvatarPresignService — tránh nested tx). Truyền ĐÚNG (employeeId, avatarUrl):
  // AvatarPresignService CHỈ ký khi cặp khớp 1 avatar ĐÃ XÁC MINH (link ME/avatar + image) ⇒ cột avatar_url
  // bị đầu độc KHÔNG bao giờ ký. Fail-soft: không ký được → null → initials.

  /** Resolve avatar cho 1 trang list items (1 batch, khớp theo employeeId=item.id). */
  private async resolveListAvatars<T extends { id: string; avatarUrl: string | null }>(
    companyId: string,
    items: T[],
  ): Promise<T[]> {
    const subjects = items
      .filter((i) => i.avatarUrl !== null)
      .map((i) => ({ employeeId: i.id, avatarUrl: i.avatarUrl }));
    if (subjects.length === 0) return items;
    const urlByEmployee = await this.avatarPresign.resolveEmployeeAvatars(companyId, subjects);
    return items.map((i) => ({ ...i, avatarUrl: urlByEmployee.get(i.id) ?? null }));
  }

  /** Resolve avatar cho 1 DTO đơn (detail / me profile). */
  private async resolveOneAvatar<T extends { id: string; avatarUrl: string | null }>(
    companyId: string,
    dto: T,
  ): Promise<T> {
    if (!dto.avatarUrl) return dto;
    const urlByEmployee = await this.avatarPresign.resolveEmployeeAvatars(companyId, [
      { employeeId: dto.id, avatarUrl: dto.avatarUrl },
    ]);
    return { ...dto, avatarUrl: urlByEmployee.get(dto.id) ?? null };
  }

  // ── List ────────────────────────────────────────────────────────────────────────

  async listHrEmployees(
    user: RequestUser,
    query: HrEmployeeListQuery,
    // S5-ME-BE-5: `resolveAvatars=false` để CONSUMER chỉ đếm/tổng hợp (dashboard HR_OVERVIEW/NEW_EMPLOYEES bỏ
    // avatarUrl) KHÔNG tốn N presign vô ích trên hot-path. Endpoint HTTP list (cần ảnh) dùng mặc định true.
    opts?: { resolveAvatars?: boolean },
  ): Promise<HrEmployeeListResponse> {
    // GATE first (403 if no read:employee grant) — runs BEFORE any repo/DB read.
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "read",
      "employee",
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    // SCOPE = filter: translate the resolved scope into a query predicate (Own/Team/Department/…).
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    const result = await this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listScopedTx(tx, user.companyId, scopeCond, {
        search: query.search,
        orgUnitId: query.orgUnitId,
        positionId: query.positionId,
        status: query.status,
        sort: query.sort,
        order: query.order,
        page: query.page,
        pageSize: query.pageSize,
      });

      // HR-PERF-1 (beBatchPermHr) — per-row decisions are STILL per-object (OBJECT-level grants,
      // ADR-0010, resolve per employee; a page can legitimately mix revealed + masked rows), but they
      // are resolved in ONE batch instead of 2N can() calls: canBatch fetches company grants once +
      // object grants once, then decides each (id × action) with the SAME decideCan() as can(). The
      // decisions are byte-identical to the old per-row loop. Reveal ⟹ audit stays atomic per row:
      // each revealed salary row still writes its view-salary audit on THIS tenant tx (a failed audit
      // rolls back the read).
      const ids = rows.map((r) => r.id);
      const decisions = await this.permission.canBatch(user.id, user.companyId, "employee", ids, [
        { action: "view-salary", isSensitive: true },
        { action: "view-sensitive", isSensitive: true },
        // HR-IDENTITY-READ-1: CCCD (§14.18) has its OWN sensitive gate — resolved in the SAME batch so
        // OBJECT-level view-identity grants (ADR-0010) decide per row, byte-identical to can().
        { action: "view-identity", isSensitive: true },
      ]);

      const items: HrEmployeeListItem[] = [];
      for (const row of rows) {
        const cell = decisions.get(row.id);
        // Salary: reveal ONLY when allow && auditRequired (mirror revealSalary) — and audit that reveal.
        const salary = cell?.get("view-salary");
        const revealSalary = Boolean(salary?.allow && salary?.auditRequired);
        if (revealSalary) {
          await this.audit.record(tx, {
            action: "view-salary",
            objectType: "employee",
            objectId: row.id,
            actorUserId: user.id,
          });
        }
        // PII (HR-PROFILE-UI-1): view-sensitive per-row (no separate audit — read-only, mirror
        // canViewSensitive).
        const revealPii = Boolean(cell?.get("view-sensitive")?.allow);
        // Identity (HR-IDENTITY-READ-1): reveal ONLY when allow && auditRequired (mirror revealIdentity)
        // — and audit that reveal PER ROW on THIS tenant tx (a failed audit rolls back the read).
        const identity = cell?.get("view-identity");
        const revealIdentity = Boolean(identity?.allow && identity?.auditRequired);
        if (revealIdentity) {
          await this.audit.record(tx, {
            action: "view-identity",
            objectType: "employee",
            objectId: row.id,
            actorUserId: user.id,
          });
        }
        items.push(this.toListItem(row, revealSalary, revealPii, revealIdentity));
      }

      const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;
      return {
        items,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
        },
      };
    });

    // S5-ME-BE-5: resolve avatar fileId→signed URL SAU khi tx đọc chính đóng (batch 1 lần cho cả trang).
    // Consumer đếm/tổng hợp (resolveAvatars=false) bỏ qua để KHÔNG tốn N presign vô ích.
    if (opts?.resolveAvatars === false) return result;
    return { ...result, items: await this.resolveListAvatars(user.companyId, result.items) };
  }

  // ── Detail ────────────────────────────────────────────────────────────────────────

  async getHrEmployee(user: RequestUser, id: string): Promise<HrEmployeeDetail> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "read",
      "employee",
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);

    const detail = await this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!row) throw new NotFoundException("Employee not found");

      // In-scope check (defense-in-depth: cross-tenant fails for EVERY scope). Out-of-scope reads
      // 404 — never leak that the row exists outside the caller's scope.
      const inScope = this.dataScope.isEmployeeInScope(scope, ctx, {
        userId: row.userId,
        companyId: row.companyId,
        orgUnitId: row.orgUnitId,
        directManagerUserId: row.directManagerUserId,
      });
      if (!inScope) throw new NotFoundException("Employee not found");

      const revealSalary = await this.revealSalary(tx, user, id);
      const revealPii = await this.canViewSensitive(user, id);
      const revealIdentity = await this.revealIdentity(tx, user, id);
      const resignationReason = await this.resolveResignationReason(
        tx,
        user.companyId,
        row,
        revealPii,
      );
      return this.toDetail(row, revealSalary, revealPii, revealIdentity, resignationReason);
    });
    // S5-ME-BE-5: resolve avatar fileId→signed URL (directory-class) SAU khi tx đọc chính đóng.
    return this.resolveOneAvatar(user.companyId, detail);
  }

  // ── Summary (HR-PROFILE-UI-1 — overview strip) ──────────────────────────────────

  async getEmployeesSummary(user: RequestUser): Promise<HrEmployeeSummary> {
    // Same gate + scope pipeline as the list: the aggregates can never count a row the caller's
    // list would not return (Own-scope caller aggregates exactly their own row).
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "read",
      "employee",
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.summaryScopedTx(tx, user.companyId, scopeCond);

      const byStatus: Record<string, number> = {};
      let total = 0;
      for (const r of rows.byStatus) {
        byStatus[r.status] = Number(r.count);
        total += Number(r.count);
      }
      const byEmploymentType: Record<string, number> = {};
      for (const r of rows.byEmploymentType) {
        byEmploymentType[r.employmentType ?? "unknown"] = Number(r.count);
      }

      // Gender aggregate is PII-derived → fail-closed behind view-sensitive (type-level: the
      // aggregate is not about one row, so no resourceId). No grant ⟹ byGender null, FE hides it.
      let byGender: Record<string, number> | null = null;
      const revealGender = await this.canViewSensitive(user, null);
      if (revealGender) {
        byGender = {};
        for (const r of rows.byGender) {
          byGender[r.gender ?? "unknown"] = Number(r.count);
        }
      }

      return { total, byStatus, byEmploymentType, byGender };
    });
  }

  // ── Me / profile ────────────────────────────────────────────────────────────────

  async getMyProfile(user: RequestUser): Promise<HrMeProfile> {
    // Gate: the controller's @RequirePermission("read","employee") is the coarse access gate; THIS
    // self-by-userId lookup is the fine gate — it pins the row to the caller, so the route returns the
    // caller's OWN profile only. Self-only: locked to caller.id within the tenant — NOT a scope query
    // (a Company-scope read must not let /me/profile return someone else's row).
    const profile = await this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findByUserIdTx(tx, user.companyId, user.id);
      if (!row) throw new NotFoundException("No employee profile linked to your account");

      // Own data still flows through the SAME masking layer (no bypass): the caller's grants decide.
      const revealSalary = await this.revealSalary(tx, user, row.id);
      const revealPii = await this.canViewSensitive(user, row.id);
      const revealIdentity = await this.revealIdentity(tx, user, row.id);
      const resignationReason = await this.resolveResignationReason(
        tx,
        user.companyId,
        row,
        revealPii,
      );
      return this.toDetail(row, revealSalary, revealPii, revealIdentity, resignationReason);
    });
    // S5-ME-BE-5: resolve avatar fileId→signed URL (directory-class) SAU khi tx đọc chính đóng.
    return this.resolveOneAvatar(user.companyId, profile);
  }

  // ── Lookups ───────────────────────────────────────────────────────────────────────

  async listDepartments(user: RequestUser): Promise<HrDepartmentLookup[]> {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listDepartmentsTx(tx, user.companyId),
    );
  }

  async listPositions(user: RequestUser): Promise<HrPositionLookup[]> {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listPositionsTx(tx, user.companyId),
    );
  }

  async listJobLevels(user: RequestUser): Promise<HrJobLevelLookup[]> {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listJobLevelsTx(tx, user.companyId),
    );
  }

  async listContractTypes(user: RequestUser): Promise<HrContractTypeLookup[]> {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listContractTypesTx(tx, user.companyId),
    );
  }

  async previewEmployeeCode(user: RequestUser): Promise<HrEmployeeCodePreview> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const cfg = await this.repo.getEmployeeCodeConfigTx(tx, user.companyId);
      if (!cfg) {
        return {
          available: false,
          prefix: null,
          pattern: null,
          numberLength: DEFAULT_EMPLOYEE_CODE_NUMBER_LENGTH,
          sample: null,
        };
      }
      const padded = "1".padStart(cfg.numberLength, "0");
      const sample = `${cfg.prefix ?? ""}${padded}`;
      return {
        available: true,
        prefix: cfg.prefix,
        pattern: cfg.pattern,
        numberLength: cfg.numberLength,
        sample,
      };
    });
  }

  // ── Sensitive reveal helpers ────────────────────────────────────────────────────

  /**
   * Reveal base_salary AND write the view-salary audit atomically (mirrors EmployeesService.revealSalary).
   * isSensitive=true → a wildcard grant cannot satisfy it. We only reveal when allow && auditRequired,
   * and in that case record the view inside the caller's tx — a failed audit rolls back the read.
   */
  private async revealSalary(tx: TenantTx, user: RequestUser, targetId: string): Promise<boolean> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action: "view-salary",
      resourceType: "employee",
      resourceId: targetId,
      isSensitive: true,
    };
    const decision = await this.permission.can(input);
    const reveal = decision.allow && decision.auditRequired;
    if (reveal) {
      await this.audit.record(tx, {
        action: "view-salary",
        objectType: "employee",
        objectId: targetId,
        actorUserId: user.id,
      });
    }
    return reveal;
  }

  /**
   * HR-IDENTITY-READ-1 — reveal identity_* (CCCD, SPEC-03 §14.18) AND write the view-identity audit
   * atomically (mirrors revealSalary). isSensitive=true → a wildcard *:* grant cannot satisfy it (only
   * an EXACT view-identity:employee ALLOW does). We reveal ONLY when allow && auditRequired, and in that
   * case record the view inside the caller's tenant tx — a failed audit rolls back the read. Identity is
   * a SEPARATE, higher-sensitivity gate: view-sensitive/view-salary grants do NOT reveal it.
   */
  private async revealIdentity(
    tx: TenantTx,
    user: RequestUser,
    targetId: string,
  ): Promise<boolean> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action: "view-identity",
      resourceType: "employee",
      resourceId: targetId,
      isSensitive: true,
    };
    const decision = await this.permission.can(input);
    const reveal = decision.allow && decision.auditRequired;
    if (reveal) {
      await this.audit.record(tx, {
        action: "view-identity",
        objectType: "employee",
        objectId: targetId,
        actorUserId: user.id,
      });
    }
    return reveal;
  }

  /**
   * S5-HR-WORKINFO-1 — resolve the "Thông tin nghỉ việc" reason for the detail. Only queries the
   * append-only status history when the employee is actually leaving (status ∈ {resigned,terminated})
   * AND the caller may see PII (revealPii): the reason is free-text HR data, so it fails CLOSED behind
   * view-sensitive (mirror `notes`). Any other case ⟹ null, and NO extra query is issued.
   */
  private async resolveResignationReason(
    tx: TenantTx,
    companyId: string,
    row: HrDetailRow,
    revealPii: boolean,
  ): Promise<string | null> {
    const isLeaving = row.status === "resigned" || row.status === "terminated";
    if (!isLeaving || !revealPii) return null;
    return this.repo.findLatestResignationReasonTx(tx, companyId, row.id);
  }

  /**
   * view-sensitive:employee gate for PII (phone/notes/contractType + personal-info). Sensitive catalog
   * pair → wildcard grants do NOT satisfy it. PII reveal is not separately audited (read-only, no
   * salary-class trail). targetId null = type-level check (used for the summary gender aggregate,
   * which is not about one row).
   */
  private async canViewSensitive(user: RequestUser, targetId: string | null): Promise<boolean> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action: "view-sensitive",
      resourceType: "employee",
      resourceId: targetId,
      isSensitive: true,
    };
    const decision = await this.permission.can(input);
    return decision.allow;
  }

  // ── Projection / masking ────────────────────────────────────────────────────────

  private toListItem(
    row: HrListRow,
    revealSalary: boolean,
    revealPii: boolean,
    revealIdentity: boolean,
  ): HrEmployeeListItem {
    return {
      id: row.id,
      userId: row.userId,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      email: row.email,
      orgUnitId: row.orgUnitId,
      orgUnitName: row.orgUnitName,
      positionId: row.positionId,
      positionName: row.positionName,
      workType: row.workType,
      employmentType: row.employmentType,
      status: row.status,
      // Directory-class (non-gated).
      avatarUrl: row.avatarUrl,
      startDate: row.startDate,
      officialDate: row.officialDate,
      workLocation: row.workLocation,
      // PII — masked unless view-sensitive grants reveal (HR-PROFILE-UI-1).
      gender: revealPii ? row.gender : null,
      dateOfBirth: revealPii ? row.dateOfBirth : null,
      phone: revealPii ? row.phone : null,
      contractType: revealPii ? row.contractType : null,
      baseSalary: revealSalary && row.baseSalary != null ? Number(row.baseSalary) : null,
      // HR-IDENTITY-READ-1 (§14.18): CCCD — fail-closed null unless view-identity reveals (audited).
      identityNumber: revealIdentity ? row.identityNumber : null,
      identityIssueDate: revealIdentity ? row.identityIssueDate : null,
      identityIssuePlace: revealIdentity ? row.identityIssuePlace : null,
    };
  }

  /**
   * HR-PROFILE-UI-1b — project the personal_extra JSONB onto the CONTRACT key allowlist. The blob is
   * PII as a WHOLE (masked upstream); this projection additionally guarantees an unknown/legacy key in
   * the DB can never leak through (and never breaks the client's strict Zod parse). Empty ⇒ null.
   */
  private projectPersonalExtra(raw: Record<string, string> | null): Record<string, string> | null {
    if (!raw) return null;
    const out: Record<string, string> = {};
    for (const key of HR_PERSONAL_EXTRA_KEYS) {
      const value = raw[key];
      if (typeof value === "string" && value.length > 0) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private toDetail(
    row: HrDetailRow,
    revealSalary: boolean,
    revealPii: boolean,
    revealIdentity: boolean,
    resignationReason: string | null,
  ): HrEmployeeDetail {
    return {
      id: row.id,
      userId: row.userId,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      email: row.email,
      orgUnitId: row.orgUnitId,
      orgUnitName: row.orgUnitName,
      positionId: row.positionId,
      positionName: row.positionName,
      directManagerId: row.directManagerId,
      // S5-HR-WORKINFO-1: directory-class reporting-line + jobLevelName (NOT gated — mirror org-chart node).
      jobLevelName: row.jobLevelName,
      directManagerName: row.directManagerName,
      directManagerEmployeeId: row.directManagerEmployeeId,
      indirectManagerName: row.indirectManagerName,
      workType: row.workType,
      employmentType: row.employmentType,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      baseSalary: revealSalary && row.baseSalary != null ? Number(row.baseSalary) : null,
      // SENSITIVE (salary-class, S2-HR-MASK-1): salaryType is the compensation MODEL (monthly/hourly/
      // project). Owner chốt 2026-06-26 classes it under SPEC-03 §18.8 "dữ liệu lương" → gate WITH the
      // amount behind view-salary (fail-closed). No view-salary reveal ⟹ null, same as baseSalary.
      salaryType: revealSalary ? row.salaryType : null,
      // Directory-class (non-gated).
      avatarUrl: row.avatarUrl,
      // PII — masked unless view-sensitive grants reveal.
      phone: revealPii ? row.phone : null,
      contractType: revealPii ? row.contractType : null,
      // S5-HR-WORKINFO-1: contractTypeName rides the SAME view-sensitive gate as contractType legacy.
      contractTypeName: revealPii ? row.contractTypeName : null,
      notes: revealPii ? row.notes : null,
      // S5-HR-WORKINFO-1: resignationReason already fail-closed at resolveResignationReason (only set when
      // status ∈ {resigned,terminated} AND revealPii) — a null here means active/unauthorized/no-history.
      resignationReason,
      // HR-PROFILE-UI-1: personal-info PII (mig 0451) — SAME view-sensitive gate, fail-closed.
      gender: revealPii ? row.gender : null,
      dateOfBirth: revealPii ? row.dateOfBirth : null,
      maritalStatus: revealPii ? row.maritalStatus : null,
      personalEmail: revealPii ? row.personalEmail : null,
      currentAddress: revealPii ? row.currentAddress : null,
      permanentAddress: revealPii ? row.permanentAddress : null,
      emergencyContactName: revealPii ? row.emergencyContactName : null,
      emergencyContactPhone: revealPii ? row.emergencyContactPhone : null,
      // HR-IDENTITY-READ-1: CCCD (§14.18) — SEPARATE view-identity gate (higher-sensitivity than the
      // view-sensitive PII above); fail-closed null unless view-identity reveals (audited atomically).
      identityNumber: revealIdentity ? row.identityNumber : null,
      identityIssueDate: revealIdentity ? row.identityIssueDate : null,
      identityIssuePlace: revealIdentity ? row.identityIssuePlace : null,
      // HR-PROFILE-UI-1b (mig 0489, hybrid): directory-class không gate...
      officialDate: row.officialDate,
      probationEndDate: row.probationEndDate,
      workLocation: row.workLocation,
      // ...MST + blob nhân khẩu = PII, mask NGUYÊN KHỐI (blob còn được chiếu lên key allowlist).
      taxCode: revealPii ? row.taxCode : null,
      personalExtra: revealPii ? this.projectPersonalExtra(row.personalExtra) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
