import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type {
  CreateContractRequest,
  EmployeeContractDto,
  ListContractsQuery,
  UpdateContractRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { FileService } from "../foundation/files/files.service";
import { SettingService } from "../foundation/settings/setting.service";
import { DataScopeService } from "../permission/data-scope.service";
import { isUniqueViolation } from "../common/db-error";
import { contractTypes, employeeProfiles, type EmployeeContract } from "../db/schema";
import { ContractRepository, type ContractPatch } from "./contract.repository";

type RequestUser = { id: string; companyId: string };

/**
 * Ngưỡng cảnh báo hết hạn MẶC ĐỊNH (ngày) khi company_settings/system_settings đều vắng — DB-03 §7.7
 * quy tắc 5. S2-HR-BE-6 scope FIX (2026-07-02): 2 mốc mặc định [30,7], company-configurable qua
 * SettingService (key 'hr.contract_expiring_warning_days', setting-defaults.ts). Mốc RỘNG NHẤT quyết
 * định EmployeeContractDto.expiringSoon (giữ nguyên shape DTO hiện có — KHÔNG đổi thành mảng).
 */
const DEFAULT_EXPIRING_MILESTONES = [30, 7];
const CONTRACT_EXPIRY_SETTING_KEY = "hr.contract_expiring_warning_days";

/** Module/entity dùng khi link file hợp đồng qua FileService (polymorphic file_links). */
const HR_MODULE = "HR";
const CONTRACT_ENTITY = "contract";
/** view:contract resourceType dùng để resolve data_scope qua DataScopeService (S2-INT-2 pattern). */
const CONTRACT_RESOURCE = "contract";

/**
 * S2-HR-BE-6 — Employee contracts service (hợp đồng lao động). Crown-jewel touch points:
 *  - BẤT BIẾN #1: every read/write runs in `withTenant(user.companyId)`; the repo ANDs company_id.
 *    contract_type cross-tenant validated INSIDE the tx (RLS lọc → 0 row ⇒ reject).
 *  - BẤT BIẾN #2: soft-delete only; audit row written in the SAME tx as each mutation (create/update/
 *    link/delete) — both commit or both roll back. audit_logs is append-only.
 *  - BẤT BIẾN #3: audit before/after snapshot carries note/title/metadata only — masker che PII nếu lọt.
 *
 * SCOPE (S2-HR-BE-6 FIX, 2026-07-02, owner-chốt session 1849d064 / harness/handoff.md / PR #78 / mig
 * 0465): the controller's `@RequirePermission("view"|"manage","contract")` is the COARSE gate (403 when
 * no grant at all). This service adds the FINE data_scope filter for READS via DataScopeService (S2-INT-2
 * reused, no new scope logic): employee → Own (chỉ hợp đồng chính mình), manager → Team (multi-manager
 * tree), hr/company-admin → Company (unchanged, mig 0462). `manage:contract` stays Company-only (no
 * Own/Team grant seeded) — employee/manager CANNOT create/update/delete/link-file (still 403).
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContractRepository,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly settings: SettingService,
    private readonly dataScope: DataScopeService,
  ) {}

  // ── Read ────────────────────────────────────────────────────────────────────

  async list(
    user: RequestUser,
    query: ListContractsQuery,
  ): Promise<{
    data: EmployeeContractDto[];
    meta: { total: number; page: number; limit: number };
  }> {
    // GATE (403 already passed at controller for the "view" pair) — resolve the STRONGEST granted
    // scope, then translate to a query predicate (Own/Team/Company). Never widened past the grant.
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "view",
      CONTRACT_RESOURCE,
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    const milestones = await this.resolveExpiringMilestones(user.companyId);
    const thresholdDays = query.expiringWithinDays ?? Math.max(...milestones);
    const expiringBefore = query.expiringOnly ? this.addDays(thresholdDays) : undefined;
    const offset = (query.page - 1) * query.limit;
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = {
        employeeId: query.employeeId,
        status: query.status,
        expiringBefore,
        limit: query.limit,
        offset,
      };
      const [rows, total] = await Promise.all([
        this.repo.listTx(tx, user.companyId, filter, scopeCond),
        this.repo.countTx(tx, user.companyId, filter, scopeCond),
      ]);
      return {
        data: rows.map((r) => this.toDto(r, thresholdDays)),
        meta: { total, page: query.page, limit: query.limit },
      };
    });
  }

  async listForEmployee(
    user: RequestUser,
    employeeId: string,
    query: ListContractsQuery,
  ): Promise<{
    data: EmployeeContractDto[];
    meta: { total: number; page: number; limit: number };
  }> {
    return this.list(user, { ...query, employeeId });
  }

  async getById(user: RequestUser, id: string): Promise<EmployeeContractDto> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "view",
      CONTRACT_RESOURCE,
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);

    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!row) throw new NotFoundException("Contract not found");

      // In-scope check (defense-in-depth, mirrors hr-read.service.ts): cross-tenant/out-of-scope → 404,
      // NEVER leak that the row exists outside the caller's scope (Own/Team fail closed, not 403-after-200).
      const target = await this.repo.findScopeTargetTx(tx, user.companyId, id);
      const inScope = target
        ? this.dataScope.isEmployeeInScope(scope, ctx, {
            userId: target.userId,
            companyId: target.companyId,
            orgUnitId: target.orgUnitId,
            directManagerUserId: target.directManagerUserId,
          })
        : false;
      if (!inScope) throw new NotFoundException("Contract not found");

      const milestones = await this.resolveExpiringMilestones(user.companyId);
      return this.toDto(row, Math.max(...milestones));
    });
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  async create(user: RequestUser, dto: CreateContractRequest): Promise<EmployeeContractDto> {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        // Validate employee + contract_type belong to THIS tenant (RLS → 0 row cross-tenant ⇒ 400).
        await this.assertEmployeeInTenant(tx, user.companyId, dto.employeeId);
        const contractType = await this.assertContractTypeInTenant(
          tx,
          user.companyId,
          dto.contractTypeId,
        );

        const status = dto.status ?? "Draft";
        this.assertEndDateRules(contractType.requiresEndDate, dto.startDate, dto.endDate ?? null);

        const created = await this.repo.insertTx(tx, user.companyId, user.id, {
          employeeId: dto.employeeId,
          contractTypeId: dto.contractTypeId,
          contractCode: dto.contractCode ?? null,
          title: dto.title ?? null,
          startDate: dto.startDate,
          endDate: dto.endDate ?? null,
          signedDate: dto.signedDate ?? null,
          status,
          isPrimary: dto.isPrimary ?? false,
          fileId: dto.fileId ?? null,
          note: dto.note ?? null,
        });
        if (!created) throw new Error("Failed to create contract");

        await this.audit.record(tx, {
          action: "create",
          objectType: "employee_contract",
          objectId: created.id,
          actorUserId: user.id,
          actorType: "User",
          moduleCode: HR_MODULE,
          entityType: CONTRACT_ENTITY,
          entityId: created.id,
          resultStatus: "Success",
          dataScope: "Company",
          after: this.snapshot(created),
        });

        const milestones = await this.resolveExpiringMilestones(user.companyId);
        return this.toDto(created, Math.max(...milestones));
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateContractRequest,
  ): Promise<EmployeeContractDto> {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Contract not found");

        // If contract_type is changing, validate the NEW type belongs to this tenant.
        const effectiveTypeId = dto.contractTypeId ?? before.contractTypeId;
        const contractType =
          dto.contractTypeId !== undefined
            ? await this.assertContractTypeInTenant(tx, user.companyId, dto.contractTypeId)
            : await this.assertContractTypeInTenant(tx, user.companyId, effectiveTypeId);

        const nextStart = dto.startDate ?? before.startDate;
        const nextEnd = dto.endDate !== undefined ? dto.endDate : before.endDate;
        this.assertEndDateRules(contractType.requiresEndDate, nextStart, nextEnd);

        const patch: ContractPatch = {
          contractTypeId: dto.contractTypeId,
          contractCode: dto.contractCode,
          title: dto.title,
          startDate: dto.startDate,
          endDate: dto.endDate,
          signedDate: dto.signedDate,
          status: dto.status,
          isPrimary: dto.isPrimary,
          fileId: dto.fileId,
          note: dto.note,
        };
        const after = await this.repo.updateTx(tx, user.companyId, id, user.id, patch);
        if (!after) throw new NotFoundException("Contract not found");

        const beforeSnap = this.snapshot(before);
        const afterSnap = this.snapshot(after);
        await this.audit.record(tx, {
          action: "update",
          objectType: "employee_contract",
          objectId: id,
          actorUserId: user.id,
          actorType: "User",
          moduleCode: HR_MODULE,
          entityType: CONTRACT_ENTITY,
          entityId: id,
          resultStatus: "Success",
          dataScope: "Company",
          before: beforeSnap,
          after: afterSnap,
          oldValues: beforeSnap,
          newValues: afterSnap,
        });

        const milestones = await this.resolveExpiringMilestones(user.companyId);
        return this.toDto(after, Math.max(...milestones));
      });
    } catch (err) {
      throw this.mapDbError(err);
    }
  }

  // ── Delete (soft) ────────────────────────────────────────────────────────────

  async delete(user: RequestUser, id: string): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!before) throw new NotFoundException("Contract not found");

      const affected = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
      if (affected === 0) throw new NotFoundException("Contract not found");

      await this.audit.record(tx, {
        action: "delete",
        objectType: "employee_contract",
        objectId: id,
        actorUserId: user.id,
        actorType: "User",
        moduleCode: HR_MODULE,
        entityType: CONTRACT_ENTITY,
        entityId: id,
        resultStatus: "Success",
        dataScope: "Company",
        before: this.snapshot(before),
      });
    });
  }

  // ── Link file ─────────────────────────────────────────────────────────────────

  /**
   * Link a file to a contract via FileService (entity 'contract'). FileService validates the file belongs
   * to the tenant + scan_status != Infected + writes its own file_link/audit. Then set contract.file_id
   * (primary file ref) + audit 'employee_contract'/FileLinked in a SEPARATE tenant tx. Row 0 → 404.
   */
  async linkFile(
    user: RequestUser,
    contractId: string,
    fileId: string,
  ): Promise<EmployeeContractDto> {
    // Contract must exist in this tenant (RLS → 0 row cross-tenant ⇒ 404).
    const existing = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.findByIdTx(tx, user.companyId, contractId),
    );
    if (!existing) throw new NotFoundException("Contract not found");

    // FileService.link validates file tenant + scan + writes file_links + its own audit (FileLinked).
    await this.files.link(user, {
      fileId,
      moduleCode: HR_MODULE,
      entityType: CONTRACT_ENTITY,
      entityId: contractId,
      linkType: "Contract",
      accessScope: "Company",
      isPrimary: true,
      purpose: "contract",
    });

    return this.db.withTenant(user.companyId, async (tx) => {
      const after = await this.repo.setFileTx(tx, user.companyId, contractId, user.id, fileId);
      if (!after) throw new NotFoundException("Contract not found");

      await this.audit.record(tx, {
        action: "FileLinked",
        objectType: "employee_contract",
        objectId: contractId,
        actorUserId: user.id,
        actorType: "User",
        moduleCode: HR_MODULE,
        entityType: CONTRACT_ENTITY,
        entityId: contractId,
        resultStatus: "Success",
        dataScope: "Company",
        after: { fileId },
      });

      const milestones = await this.resolveExpiringMilestones(user.companyId);
      return this.toDto(after, Math.max(...milestones));
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Company-configurable expiry-warning milestones (S1-FND-SETTING-1 precedence: company_settings →
   * system_settings → DEFAULT_EXPIRING_MILESTONES). Falls back to the hard-coded default on any
   * malformed/missing override (fail-safe, never throws — expiry warning is advisory, not a gate).
   */
  private async resolveExpiringMilestones(companyId: string): Promise<number[]> {
    const resolved = await this.settings.resolveSetting(companyId, CONTRACT_EXPIRY_SETTING_KEY);
    const value = resolved.value;
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
    ) {
      return value as number[];
    }
    return DEFAULT_EXPIRING_MILESTONES;
  }

  private async assertEmployeeInTenant(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
  ): Promise<void> {
    const [row] = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.companyId, companyId)))
      .limit(1);
    if (!row) {
      throw new BadRequestException(
        "HR-ERR-CONTRACT-EMPLOYEE: employee không thuộc công ty hiện tại",
      );
    }
  }

  private async assertContractTypeInTenant(
    tx: TenantTx,
    companyId: string,
    contractTypeId: string,
  ): Promise<{ requiresEndDate: boolean }> {
    const [row] = await tx
      .select({ requiresEndDate: contractTypes.requiresEndDate })
      .from(contractTypes)
      .where(
        and(
          eq(contractTypes.id, contractTypeId),
          eq(contractTypes.companyId, companyId),
          isNull(contractTypes.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new BadRequestException(
        "HR-ERR-CONTRACT-TYPE: contract_type không thuộc công ty hiện tại hoặc không tồn tại",
      );
    }
    return { requiresEndDate: row.requiresEndDate };
  }

  /** DB-03 §7.7 quy tắc 1+2: end_date ≥ start_date (DB CHECK cũng ép) + requires_end_date ⇒ có end_date. */
  private assertEndDateRules(
    requiresEndDate: boolean,
    startDate: string,
    endDate: string | null,
  ): void {
    if (endDate !== null && endDate < startDate) {
      throw new BadRequestException("HR-ERR-CONTRACT-DATE: end_date không được nhỏ hơn start_date");
    }
    if (requiresEndDate && endDate === null) {
      throw new BadRequestException(
        "HR-ERR-CONTRACT-END-REQUIRED: loại hợp đồng này yêu cầu end_date",
      );
    }
  }

  /** today + n days as ISO date (YYYY-MM-DD). */
  private addDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** Whether an Active contract expires within `thresholdDays` from today. */
  private isExpiringSoon(row: EmployeeContract, thresholdDays: number): boolean {
    if (row.status !== "Active" || !row.endDate) return false;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = new Date(`${row.endDate}T00:00:00.000Z`);
    const diffDays = Math.floor((end.getTime() - today.getTime()) / 86_400_000);
    return diffDays >= 0 && diffDays <= thresholdDays;
  }

  /** Audit snapshot — business fields only (no salary/PII beyond note/title; masker che if it leaks). */
  private snapshot(row: EmployeeContract): Record<string, unknown> {
    return {
      employeeId: row.employeeId,
      contractTypeId: row.contractTypeId,
      contractCode: row.contractCode,
      title: row.title,
      startDate: row.startDate,
      endDate: row.endDate,
      signedDate: row.signedDate,
      status: row.status,
      isPrimary: row.isPrimary,
      fileId: row.fileId,
      note: row.note,
    };
  }

  private toDto(row: EmployeeContract, thresholdDays: number): EmployeeContractDto {
    return {
      id: row.id,
      companyId: row.companyId,
      employeeId: row.employeeId,
      contractTypeId: row.contractTypeId,
      contractCode: row.contractCode,
      title: row.title,
      startDate: row.startDate,
      endDate: row.endDate,
      signedDate: row.signedDate,
      status: row.status as EmployeeContractDto["status"],
      isPrimary: row.isPrimary,
      fileId: row.fileId,
      note: row.note,
      expiringSoon: this.isExpiringSoon(row, thresholdDays),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDbError(err: unknown): unknown {
    if (isUniqueViolation(err)) {
      return new ConflictException("Contract code already exists");
    }
    return err;
  }
}
