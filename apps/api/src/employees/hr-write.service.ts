import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import type {
  ChangeEmployeeStatusRequest,
  CreateHrEmployeeRequest,
  HrEmployeeStatus,
  LinkUserRequest,
  UnlinkUserRequest,
  UpdateHrEmployeeRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PasswordService } from "../auth/password.service";
import { SecurityPolicyService } from "../security-policy/security-policy.service";
import { SequenceService } from "../foundation/sequences/sequence.service";
import {
  SequenceInactiveError,
  SequenceNotFoundError,
} from "../foundation/sequences/sequence.types";
import { isUniqueViolation } from "../common/db-error";
import { HrWriteRepository, type EmployeeUpdateData } from "./hr-write.repository";

type RequestUser = { id: string; companyId: string };

/** Sequence counter key for employee codes (scopeType defaults to "Company" in the repo). */
export const EMPLOYEE_CODE_SEQUENCE_KEY = "EMPLOYEE_CODE";

const GENERATED_PASSWORD_BYTES = 18;

/**
 * Status FSM (app-enforced — the DB CHECK validates the value set, not the transition). Resigned can
 * only escalate to Terminated; Terminated is terminal. Same→same is rejected as a no-op.
 */
const STATUS_TRANSITIONS: Record<HrEmployeeStatus, readonly HrEmployeeStatus[]> = {
  active: ["inactive", "resigned", "terminated"],
  inactive: ["active", "resigned", "terminated"],
  resigned: ["terminated"],
  terminated: [],
};

const LOCKING_STATUSES: ReadonlySet<HrEmployeeStatus> = new Set(["resigned", "terminated"]);

/**
 * S2-HR-BE-2 — HR write core (API-03 §11.2/§11.5/§11.6/§11.7/§11.8). Crown-jewel:
 *  - BẤT BIẾN #1: every mutation runs in `withTenant(caller.companyId)`; repo ANDs company_id.
 *  - BẤT BIẾN #2: no hard-delete; status changes append to employee_status_histories (INSERT-only).
 *  - BẤT BIẾN #3: audit before/after + the write DTOs carry STRUCTURAL fields ONLY — never baseSalary
 *    or PII (the audit masker does not mask those; audit_logs is append-only → a leak is permanent).
 *
 * Code generation uses SequenceService (FOR UPDATE, 0-dup) in its OWN tx, allocated BEFORE the insert
 * tx (never nested — nesting would hold two PgBouncer connections per request). The partial-unique
 * index `employee_profiles_company_code_active_uq` is the final dup backstop.
 */
@Injectable()
export class HrWriteService {
  constructor(
    private readonly repo: HrWriteRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly password: PasswordService,
    private readonly securityPolicy: SecurityPolicyService,
  ) {}

  // ── Create ───────────────────────────────────────────────────────────────────────

  async createEmployee(user: RequestUser, dto: CreateHrEmployeeRequest) {
    const manualCode = dto.employeeCode ?? null;
    // Auto-code is allocated in its OWN tx BEFORE the insert tx (gaps OK, dups impossible).
    const autoCode = manualCode ? null : await this.allocateEmployeeCode(user.companyId);
    const code = manualCode ?? autoCode;

    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        if (manualCode) {
          const cfg = await this.repo.getActiveEmployeeCodeConfigTx(tx, user.companyId);
          // An active config with manual override disabled forbids a client-supplied code.
          if (cfg && cfg.allowManualOverride === false) {
            throw new ForbiddenException(
              "Manual employee code is not allowed by the active config",
            );
          }
        }

        const userId = await this.resolveUserId(tx, user.companyId, dto);
        await this.assertReferencesValid(tx, user.companyId, {
          orgUnitId: dto.orgUnitId,
          positionId: dto.positionId,
          directManagerId: dto.directManagerId,
          subjectUserId: userId,
        });

        const created = await this.repo.createTx(tx, user.companyId, {
          userId,
          employeeCode: code,
          orgUnitId: dto.orgUnitId ?? null,
          positionId: dto.positionId ?? null,
          jobLevelId: dto.jobLevelId ?? null,
          contractTypeId: dto.contractTypeId ?? null,
          directManagerId: dto.directManagerId ?? null,
          workType: dto.workType,
          employmentType: dto.employmentType,
          salaryType: dto.salaryType,
          startDate: dto.startDate ?? null,
          endDate: dto.endDate ?? null,
        });
        if (!created) throw new Error("Failed to create employee profile");

        if (dto.directManagerId && userId) {
          await this.repo.insertDirectManagerEmrTx(tx, user.companyId, userId, dto.directManagerId);
        }

        await this.audit.record(tx, {
          action: "create",
          objectType: "employee",
          objectId: created.id,
          actorUserId: user.id,
          before: null,
          after: this.structuralSnapshot({
            employeeCode: created.employeeCode,
            orgUnitId: dto.orgUnitId ?? null,
            positionId: dto.positionId ?? null,
            jobLevelId: dto.jobLevelId ?? null,
            contractTypeId: dto.contractTypeId ?? null,
            directManagerId: dto.directManagerId ?? null,
            workType: dto.workType,
            employmentType: dto.employmentType,
            salaryType: dto.salaryType,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
            status: "active",
          }),
        });

        return { id: created.id, employeeCode: created.employeeCode, userId };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          "Employee code or login email already exists, or that user is already linked to an active employee",
        );
      }
      throw err;
    }
  }

  // ── Update ───────────────────────────────────────────────────────────────────────

  async updateEmployee(user: RequestUser, id: string, dto: UpdateHrEmployeeRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const before = await this.repo.findStructuralByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Employee not found");

        // Only the keys the client actually sent; refs validated when present.
        const patch = dto as EmployeeUpdateData;
        await this.assertReferencesValid(tx, user.companyId, {
          orgUnitId: dto.orgUnitId ?? undefined,
          positionId: dto.positionId ?? undefined,
          directManagerId: dto.directManagerId ?? undefined,
        });

        const updated = await this.repo.updateTx(tx, user.companyId, id, patch);
        if (!updated) throw new NotFoundException("Employee not found");

        const { changedFields, beforeDiff, afterDiff } = this.diffStructural(before, dto);
        if (changedFields.length > 0) {
          await this.audit.record(tx, {
            action: "update",
            objectType: "employee",
            objectId: id,
            actorUserId: user.id,
            before: beforeDiff,
            after: afterDiff,
            diffSummary: changedFields.join(","),
          });
        }
        return { id, changedFields };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Employee code already exists");
      }
      throw err;
    }
  }

  // ── Change status ──────────────────────────────────────────────────────────────────

  async changeStatus(user: RequestUser, id: string, dto: ChangeEmployeeStatusRequest) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findForUpdateTx(tx, user.companyId, id);
      if (!row) throw new NotFoundException("Employee not found");

      const oldStatus = row.status as HrEmployeeStatus;
      const newStatus = dto.newStatus;
      if (oldStatus === newStatus) {
        throw new ConflictException(`Employee is already '${newStatus}'`);
      }
      const allowed = STATUS_TRANSITIONS[oldStatus] ?? [];
      if (!allowed.includes(newStatus)) {
        throw new UnprocessableEntityException(
          `Illegal status transition '${oldStatus}' → '${newStatus}'`,
        );
      }

      await this.repo.setStatusTx(tx, user.companyId, id, newStatus);
      await this.repo.insertStatusHistoryTx(tx, user.companyId, {
        employeeId: id,
        oldStatus,
        newStatus,
        reason: dto.reason ?? null,
        changedBy: user.id,
      });

      // Optional account lock on resignation/termination (session/token revoke = Auth follow-up).
      if (dto.lockUser && LOCKING_STATUSES.has(newStatus) && row.userId) {
        await this.repo.lockUserTx(
          tx,
          user.companyId,
          row.userId,
          dto.reason ?? `employee ${newStatus}`,
        );
      }

      await this.audit.record(tx, {
        action: "change-status",
        objectType: "employee",
        objectId: id,
        actorUserId: user.id,
        before: { status: oldStatus },
        after: { status: newStatus },
      });
      return { id, status: newStatus };
    });
  }

  // ── Link / unlink user ───────────────────────────────────────────────────────────

  async linkUser(user: RequestUser, id: string, dto: LinkUserRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const row = await this.repo.findForUpdateTx(tx, user.companyId, id);
        if (!row) throw new NotFoundException("Employee not found");
        if (row.userId) throw new ConflictException("Employee already has a linked user");

        const target = await this.repo.findLinkableUserTx(tx, user.companyId, dto.userId);
        if (!target) throw new NotFoundException("User not found in this company");

        const clash = await this.repo.findActiveByUserIdTx(tx, user.companyId, dto.userId, id);
        if (clash) {
          throw new ConflictException("User is already linked to another active employee");
        }

        await this.repo.setUserIdTx(tx, user.companyId, id, dto.userId);
        await this.audit.record(tx, {
          action: "link-user",
          objectType: "employee",
          objectId: id,
          actorUserId: user.id,
          before: { userId: null },
          after: { userId: dto.userId },
        });
        return { id, userId: dto.userId };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("User is already linked to another active employee");
      }
      throw err;
    }
  }

  async unlinkUser(user: RequestUser, id: string, dto: UnlinkUserRequest) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findForUpdateTx(tx, user.companyId, id);
      if (!row) throw new NotFoundException("Employee not found");
      if (!row.userId) throw new ConflictException("Employee has no linked user");
      // A user cannot detach their own account (locks themselves out); reserved for elevated flows.
      if (row.userId === user.id) {
        throw new ForbiddenException("You cannot unlink your own account");
      }

      const detachedUserId = row.userId;
      await this.repo.setUserIdTx(tx, user.companyId, id, null);
      await this.repo.softDeleteDirectManagerEmrTx(tx, user.companyId, detachedUserId);

      if (dto.lockUser) {
        await this.repo.lockUserTx(
          tx,
          user.companyId,
          detachedUserId,
          dto.reason ?? "employee user unlinked",
        );
      }

      await this.audit.record(tx, {
        action: "unlink-user",
        objectType: "employee",
        objectId: id,
        actorUserId: user.id,
        before: { userId: detachedUserId },
        after: { userId: null },
      });
      return { id, userId: null };
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────────

  /**
   * Allocate the next employee code via SequenceService in its OWN tx. A missing/inactive counter
   * (the counter is provisioned by a seed; see plan) maps to 422 — never a 500.
   */
  private async allocateEmployeeCode(companyId: string): Promise<string> {
    try {
      const { code } = await this.sequence.nextCode(companyId, {
        sequenceKey: EMPLOYEE_CODE_SEQUENCE_KEY,
      });
      return code;
    } catch (err) {
      if (err instanceof SequenceNotFoundError || err instanceof SequenceInactiveError) {
        throw new UnprocessableEntityException(
          "HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID: cannot generate an employee code — provide one manually or configure the code sequence",
        );
      }
      throw err;
    }
  }

  /** Resolve an existing user or provision a login account (mirrors the legacy create path). */
  private async resolveUserId(
    tx: TenantTx,
    companyId: string,
    dto: CreateHrEmployeeRequest,
  ): Promise<string> {
    if (dto.userId) {
      const existing = await this.repo.findLinkableUserTx(tx, companyId, dto.userId);
      if (!existing) throw new NotFoundException("User not found in this company");
      return dto.userId;
    }
    if (!dto.email) {
      throw new BadRequestException("Provide userId, or email to create a login account");
    }
    // Company email-domain policy (fail-open on read error) — same as the legacy create path.
    const domainOk = await this.securityPolicy.assertEmailDomainAllowedTx(tx, companyId, dto.email);
    if (!domainOk) {
      throw new BadRequestException(
        "Email address is not in an allowed domain per the company security policy",
      );
    }
    const plain = dto.password ?? randomBytes(GENERATED_PASSWORD_BYTES).toString("base64url");
    const passwordHash = await this.password.hash(plain);
    const created = await this.repo.createUserTx(tx, companyId, {
      email: dto.email,
      fullName: dto.fullName ?? null,
      passwordHash,
    });
    if (!created) throw new Error("Failed to create login account");
    return created.id;
  }

  /** Validate referenced org_unit/position are active in-tenant; a manager cannot be the subject. */
  private async assertReferencesValid(
    tx: TenantTx,
    companyId: string,
    refs: {
      orgUnitId?: string;
      positionId?: string;
      directManagerId?: string;
      subjectUserId?: string | null;
    },
  ): Promise<void> {
    if (refs.orgUnitId && !(await this.repo.orgUnitActiveTx(tx, companyId, refs.orgUnitId))) {
      throw new UnprocessableEntityException("HR-ERR-DEPARTMENT-INACTIVE");
    }
    if (refs.positionId && !(await this.repo.positionActiveTx(tx, companyId, refs.positionId))) {
      throw new UnprocessableEntityException("HR-ERR-POSITION-INACTIVE");
    }
    if (refs.directManagerId && refs.subjectUserId && refs.directManagerId === refs.subjectUserId) {
      throw new BadRequestException("An employee cannot be their own direct manager");
    }
  }

  /** Build an audit-safe snapshot — STRUCTURAL keys only (never baseSalary/PII). */
  private structuralSnapshot(values: Record<string, unknown>): Record<string, unknown> {
    const ALLOW = [
      "employeeCode",
      "orgUnitId",
      "positionId",
      "jobLevelId",
      "contractTypeId",
      "directManagerId",
      "workType",
      "employmentType",
      "salaryType",
      "startDate",
      "endDate",
      "status",
    ];
    const out: Record<string, unknown> = {};
    for (const k of ALLOW) {
      if (k in values) out[k] = values[k];
    }
    return out;
  }

  /** Compute changed structural fields + before/after diffs (allowlist-bounded). */
  private diffStructural(
    before: Record<string, unknown>,
    dto: UpdateHrEmployeeRequest,
  ): {
    changedFields: string[];
    beforeDiff: Record<string, unknown>;
    afterDiff: Record<string, unknown>;
  } {
    const snapshotBefore = this.structuralSnapshot(before);
    const incoming = this.structuralSnapshot(dto as Record<string, unknown>);
    const changedFields: string[] = [];
    const beforeDiff: Record<string, unknown> = {};
    const afterDiff: Record<string, unknown> = {};
    for (const key of Object.keys(incoming)) {
      const next = incoming[key] ?? null;
      const prev = snapshotBefore[key] ?? null;
      if (next !== prev) {
        changedFields.push(key);
        beforeDiff[key] = prev;
        afterDiff[key] = next;
      }
    }
    return { changedFields, beforeDiff, afterDiff };
  }
}
