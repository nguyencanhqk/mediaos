import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import type {
  CreateEmployeeProfileRequest,
  EmployeeListQuery,
  UpdateEmployeeProfileRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { User } from "../db/schema";
import { PasswordService } from "../auth/password.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { CanInput, PermissionDecision } from "../permission/permission.types";
import { SecurityPolicyService } from "../security-policy/security-policy.service";
// S2-INT-1: same pure snapshot helper the HR write core uses — guarantees the user.created audit
// never carries password_hash/normalized_email (BẤT BIẾN #3). Pure function → no DI/module cycle.
import { authUserSnapshot } from "../users/auth-users.repository";
import { EmployeesRepository } from "./employees.repository";
import { isUniqueViolation } from "../common/db-error";

const GENERATED_PASSWORD_BYTES = 18;

type SalaryMaskable = { baseSalary: unknown };

/**
 * Project base_salary onto the DTO: the raw numeric (as number) when the caller is allowed,
 * otherwise `null`. BẤT BIẾN #3 — base_salary never leaves the server for an unauthorized role.
 */
function maskSalary<T extends SalaryMaskable>(
  item: T,
  allow: boolean,
): Omit<T, "baseSalary"> & { baseSalary: number | null } {
  const salary = allow && item.baseSalary != null ? Number(item.baseSalary) : null;
  return { ...item, baseSalary: salary };
}

type RequestUser = { id: string; companyId: string };

@Injectable()
export class EmployeesService {
  constructor(
    private readonly repo: EmployeesRepository,
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
    private readonly password: PasswordService,
    private readonly securityPolicy: SecurityPolicyService,
    // S2-HR-EMP-LEGACY-LOCK-1: same resolver the HR read core uses — added LAST (DI is by type; the
    // unit spec constructs positionally, so new deps go at the end to keep existing arg order stable).
    private readonly dataScope: DataScopeService,
  ) {}

  /**
   * Salary is sensitive (ADR-0010): wildcard (*:*) grants do NOT satisfy view-salary/update-salary.
   * resourceId = the employee profile id so per-object grants (object_permissions) are honored.
   */
  private salaryDecision(
    user: RequestUser,
    action: "view-salary" | "update-salary",
    targetId: string,
  ): Promise<PermissionDecision> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action,
      resourceType: "employee",
      resourceId: targetId,
      isSensitive: true,
    };
    return this.permissionService.can(input);
  }

  async listEmployees(user: RequestUser, filters: EmployeeListQuery) {
    // S2-HR-EMP-LEGACY-LOCK-1: gate + SCOPE the legacy list (was unscoped → tenant-wide IDOR). The
    // controller already requires read:employee; resolveAndAssert re-asserts and returns the caller's
    // strongest read scope, then buildEmployeeScopeCondition narrows the query to the permitted rows
    // (Own/Team/Department/Company/System) — same layer GET /hr/employees uses.
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "read",
      "employee",
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    // Read + per-item salary audit share ONE tenant tx (same atomic guarantee as getEmployee):
    // a failed audit INSERT rolls back and no salary is revealed. Salary scope can be per-employee
    // (object_permissions), so each row is decided/masked individually — no all-or-nothing shortcut.
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.listEmployeesTx(tx, user.companyId, filters, scopeCond);
      // Sequential (not Promise.all): audit INSERTs share the tx connection and must not interleave.
      const reveals: boolean[] = [];
      for (const row of rows) {
        reveals.push(await this.revealSalary(tx, user, row.id));
      }
      // List projection carries no salaryType/PII (LIST_COLUMNS) — only baseSalary needs masking here.
      return rows.map((row, i) => maskSalary(row, reveals[i]));
    });
  }

  async getEmployee(user: RequestUser, id: string) {
    // S2-HR-EMP-LEGACY-LOCK-1: gate + SCOPE the legacy detail (was read:employee + RLS only → any
    // grantee could read ANY employee's salaryType + PII, tenant-wide IDOR). resolveAndAssert returns
    // the caller's read scope; an out-of-scope or cross-tenant row 404s (never leaks existence).
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "read",
      "employee",
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);

    // Read + audit share one tenant tx: a failed audit INSERT rolls back and the salary is not
    // revealed (mirrors platform-accounts reveal). A missing row throws before any audit is written.
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!row) throw new NotFoundException("Employee not found");

      // directManagerId references users.id → it IS the manager's user id (for Team in-scope checks).
      const inScope = this.dataScope.isEmployeeInScope(scope, ctx, {
        userId: row.userId,
        companyId: row.companyId,
        orgUnitId: row.orgUnitId,
        directManagerUserId: row.directManagerId,
      });
      if (!inScope) throw new NotFoundException("Employee not found");

      const revealSalary = await this.revealSalary(tx, user, id);
      const revealPii = await this.canViewSensitive(user, id);
      return this.maskEmployeeDetail(row, revealSalary, revealPii);
    });
  }

  /**
   * view-sensitive:employee gate for PII (phone/contractType/notes) — mirrors HrReadService. Sensitive
   * catalog pair → a wildcard *:* grant does NOT satisfy it. PII reveal is read-only, not separately
   * audited (no salary-class trail). avatarUrl is non-sensitive (SPEC-03 §18.8) and stays unmasked.
   */
  private async canViewSensitive(user: RequestUser, targetId: string): Promise<boolean> {
    const decision = await this.permissionService.can({
      userId: user.id,
      companyId: user.companyId,
      action: "view-sensitive",
      resourceType: "employee",
      resourceId: targetId,
      isSensitive: true,
    });
    return decision.allow;
  }

  /**
   * Detail masking (BẤT BIẾN #3): baseSalary + salaryType behind view-salary (salaryType is salary-class
   * per SPEC-03 §18.8 / S2-HR-MASK-1); phone/contractType/notes behind view-sensitive. Mirrors the
   * HrReadService masking layer; the two converge on salaryType once S2-HR-MASK-1 (PR #49) lands —
   * until then this legacy route is the stricter (fail-closed) of the two, which is the safe direction.
   */
  private maskEmployeeDetail<
    T extends {
      baseSalary: unknown;
      salaryType: unknown;
      phone: unknown;
      contractType: unknown;
      notes: unknown;
    },
  >(row: T, revealSalary: boolean, revealPii: boolean) {
    return {
      ...row,
      baseSalary: revealSalary && row.baseSalary != null ? Number(row.baseSalary) : null,
      salaryType: revealSalary ? row.salaryType : null,
      phone: revealPii ? row.phone : null,
      contractType: revealPii ? row.contractType : null,
      notes: revealPii ? row.notes : null,
    };
  }

  /**
   * Decide whether to reveal salary AND write the view-salary audit atomically.
   * reveal ⟹ audit: we only return base_salary when `allow && auditRequired`, and in that case we
   * record the view inside the caller's tx. If the engine ever returned `allow && !auditRequired`
   * (a misconfiguration for a sensitive action), we fail SAFE — mask the salary, write nothing.
   *
   * NOTE: permissionService.can() resolves on its own connection/cache (Valkey, 5-min TTL), so the
   * permission snapshot is independent of `tx` — same established pattern as platform-accounts reveal.
   * The audit INSERT IS in `tx`, so the salary is never returned unless the audit commits.
   */
  private async revealSalary(tx: TenantTx, user: RequestUser, targetId: string): Promise<boolean> {
    const decision = await this.salaryDecision(user, "view-salary", targetId);
    const reveal = decision.allow && decision.auditRequired;
    if (reveal) {
      await this.auditService.record(tx, {
        action: "view-salary",
        objectType: "employee",
        objectId: targetId,
        actorUserId: user.id,
      });
    }
    return reveal;
  }

  async createEmployee(user: RequestUser, dto: CreateEmployeeProfileRequest) {
    // BẤT BIẾN #3: setting base_salary at creation is the SAME sensitive write as a PATCH —
    // it must require update-salary and be audited, otherwise create is a back door around the
    // PATCH guard. A null/absent salary is not a sensitive write (no salary is being set).
    const settingSalary = dto.baseSalary != null;

    // S2-INT-1: provisioning a NEW login account here is an AUTH write — the controller only gated
    // create:employee, so this legacy path must ALSO require create:user (parity with /hr/employees;
    // otherwise it is a bypass of that gate). Linking an existing userId mints no account → no gate.
    // Checked BEFORE the tx so a deny writes nothing.
    const willProvisionUser = !dto.userId && Boolean(dto.email) && Boolean(dto.fullName);
    if (willProvisionUser) {
      await this.assertCanProvisionUser(user);
    }

    try {
      const created = await this.db.withTenant(user.companyId, async (tx) => {
        const { userId, provisioned } = await this.resolveUserId(tx, user.companyId, dto, user.id);
        const rows = await this.repo.createEmployeeTx(tx, user.companyId, {
          userId,
          employeeCode: dto.employeeCode ?? null,
          orgUnitId: dto.orgUnitId ?? null,
          positionId: dto.positionId ?? null,
          directManagerId: dto.directManagerId ?? null,
          workType: dto.workType,
          employmentType: dto.employmentType,
          startDate: dto.startDate ?? null,
          contractType: dto.contractType ?? null,
          baseSalary: settingSalary ? String(dto.baseSalary) : null,
          salaryType: dto.salaryType,
          phone: dto.phone ?? null,
          avatarUrl: dto.avatarUrl ?? null,
          notes: dto.notes ?? null,
        });
        const profile = rows[0];
        if (!profile) throw new Error("Failed to create employee profile");

        // S2-INT-1: audit the AUTH side when a brand-new account was minted — same tx as the employee
        // write (atomic, BẤT BIẾN #2); authUserSnapshot strips password_hash (BẤT BIẾN #3).
        if (provisioned) {
          await this.auditService.record(tx, {
            action: "user.created",
            objectType: "user",
            objectId: provisioned.id,
            actorUserId: user.id,
            after: authUserSnapshot(provisioned),
          });
        }

        // F5: keep employee_manager_relations consistent with the direct_manager_id shortcut.
        if (dto.directManagerId != null) {
          await this.syncDirectManagerEmr(tx, user.companyId, userId, dto.directManagerId);
        }

        // F1 (MEDIUM-fix): gate + audit the initial salary. The row exists now so resourceId is the
        // real profile id (per-object grants honored); a deny throws → the whole create rolls back.
        if (settingSalary) {
          const decision = await this.salaryDecision(user, "update-salary", profile.id);
          if (!decision.allow) {
            throw new ForbiddenException("Insufficient permission to set salary");
          }
          await this.auditService.record(tx, {
            action: "update-salary",
            objectType: "employee",
            objectId: profile.id,
            actorUserId: user.id,
            before: { base_salary: null },
            after: { base_salary: dto.baseSalary ?? null },
          });
        }
        return profile;
      });

      // Mutation responses mask salary by default — view it via the audited GET /employees/:id.
      return maskSalary(created, false);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          "Email or employee code already exists, or the user already has a profile in this company",
        );
      }
      throw err;
    }
  }

  async updateEmployee(user: RequestUser, id: string, dto: UpdateEmployeeProfileRequest) {
    const changingSalary = dto.baseSalary !== undefined;

    try {
      const updated = await this.db.withTenant(user.companyId, async (tx) => {
        // FULL gate: updating base_salary requires the sensitive update-salary permission. Checked
        // INSIDE the tx (right before the write) to minimize the TOCTOU window — a deny rolls back
        // before anything is written. (permissionService.can() resolves on its own connection/cache.)
        if (changingSalary) {
          const decision = await this.salaryDecision(user, "update-salary", id);
          if (!decision.allow) {
            throw new ForbiddenException("Insufficient permission to update salary");
          }
        }

        // Read the prior salary inside the tx so the audit before/after is consistent with the write.
        const before = changingSalary
          ? await this.repo.findByIdTx(tx, user.companyId, id)
          : undefined;

        const rows = await this.repo.updateEmployeeTx(tx, user.companyId, id, {
          employeeCode: dto.employeeCode,
          orgUnitId: dto.orgUnitId,
          positionId: dto.positionId,
          directManagerId: dto.directManagerId,
          workType: dto.workType,
          employmentType: dto.employmentType,
          startDate: dto.startDate,
          endDate: dto.endDate,
          contractType: dto.contractType,
          baseSalary: changingSalary
            ? dto.baseSalary != null
              ? String(dto.baseSalary)
              : null
            : undefined,
          salaryType: dto.salaryType,
          phone: dto.phone,
          avatarUrl: dto.avatarUrl,
          notes: dto.notes,
          status: dto.status,
        });
        const row = rows[0];
        if (!row) throw new NotFoundException("Employee not found");

        // F5: set/clear direct_manager_id → upsert/soft-delete the EMR direct_manager row.
        // S2-HR-BE-2: an unlinked employee (userId NULL) has no user to key an EMR on → skip.
        if (dto.directManagerId !== undefined && row.userId) {
          await this.syncDirectManagerEmr(tx, user.companyId, row.userId, dto.directManagerId);
        }

        // F1: record the salary change. before/after live ONLY in the controlled audit trail
        // (append-only, RLS) — plan §6 mandates capturing old/new for update-salary.
        if (changingSalary) {
          await this.auditService.record(tx, {
            action: "update-salary",
            objectType: "employee",
            objectId: id,
            actorUserId: user.id,
            before: { base_salary: before?.baseSalary != null ? Number(before.baseSalary) : null },
            after: { base_salary: dto.baseSalary ?? null },
          });
        }
        return row;
      });

      // Mutation responses mask salary by default — view it via the audited GET /employees/:id.
      return maskSalary(updated, false);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Employee code already exists");
      }
      throw err;
    }
  }

  async deleteEmployee(companyId: string, id: string) {
    const rows = await this.repo.softDeleteEmployee(companyId, id);
    if (rows.length === 0) throw new NotFoundException("Employee not found");
  }

  // ── F7: resolve an existing user or create a login account ──────────────────────

  /**
   * S2-INT-1 — gate the AUTH-create arm. The controller only gated create:employee; minting a login
   * account additionally requires create:user (fail-closed). Mirrors HrWriteService.assertCanProvisionUser.
   */
  private async assertCanProvisionUser(user: RequestUser): Promise<void> {
    const decision = await this.permissionService.can({
      userId: user.id,
      companyId: user.companyId,
      action: "create",
      resourceType: "user",
    });
    if (!decision.allow) {
      throw new ForbiddenException(
        "AUTH-ERR-USER-PROVISION-DENIED: creating a login account requires the create:user permission",
      );
    }
  }

  /**
   * Resolve an existing user or provision a login account. Returns the resolved `userId` plus
   * `provisioned` (the freshly-minted row, only when an account was created) so the caller can emit a
   * `user.created` audit (S2-INT-1). Keep `provisioned` confined to authUserSnapshot — it carries
   * password_hash and must never reach the client or a log.
   */
  private async resolveUserId(
    tx: TenantTx,
    companyId: string,
    dto: CreateEmployeeProfileRequest,
    actorUserId: string,
  ): Promise<{ userId: string; provisioned: User | null }> {
    if (dto.userId) {
      // S2-INT-1: validate the user is IN-TENANT before linking — a raw FK does not check company_id,
      // so without this a cross-tenant userId would link into this company's employee (acceptance #3).
      const existing = await this.repo.findLinkableUserTx(tx, companyId, dto.userId);
      if (!existing) throw new NotFoundException("User not found in this company");
      const clash = await this.repo.findActiveByUserIdTx(tx, companyId, dto.userId, null);
      if (clash) {
        throw new ConflictException("User is already linked to another active employee");
      }
      return { userId: dto.userId, provisioned: null };
    }
    if (!dto.email || !dto.fullName) {
      throw new BadRequestException(
        "Provide userId, or email + fullName to create a login account",
      );
    }
    // CS-9 (BẤT BIẾN #6): chính sách email-domain công ty — tài khoản MỚI phải thuộc tên miền allowlist
    // (rỗng/tắt/kill-switch ⇒ cho qua; lỗi đọc ⇒ fail-open). Check TRONG tx tạo user, TRƯỚC createUserTx.
    // (Hook CS-10 accept-invite sẽ tái dùng SecurityPolicyService.assertEmailDomainAllowedTx tương tự.)
    const domainOk = await this.securityPolicy.assertEmailDomainAllowedTx(tx, companyId, dto.email);
    if (!domainOk) {
      throw new BadRequestException(
        "Địa chỉ email không thuộc tên miền được phép theo chính sách bảo mật của công ty.",
      );
    }
    const plain = dto.password ?? randomBytes(GENERATED_PASSWORD_BYTES).toString("base64url");
    const passwordHash = await this.password.hash(plain);
    const newUser = await this.repo.createUserTx(tx, companyId, {
      email: dto.email,
      fullName: dto.fullName,
      passwordHash,
      createdBy: actorUserId,
    });
    if (!newUser) throw new Error("Failed to create login account");
    return { userId: newUser.id, provisioned: newUser };
  }

  // ── F5: direct_manager_id ↔ employee_manager_relations consistency ──────────────

  private async syncDirectManagerEmr(
    tx: TenantTx,
    companyId: string,
    employeeUserId: string,
    managerId: string | null,
  ): Promise<void> {
    // A single direct manager: retire any existing active relation, then add the new one (if any).
    await this.repo.softDeleteDirectManagerEmrTx(tx, companyId, employeeUserId);
    if (managerId != null) {
      if (managerId === employeeUserId) {
        throw new BadRequestException("An employee cannot be their own direct manager");
      }
      await this.repo.insertDirectManagerEmrTx(tx, companyId, employeeUserId, managerId);
    }
  }
}
