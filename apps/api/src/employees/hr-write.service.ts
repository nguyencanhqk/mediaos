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
import { HR_EMPLOYEE_PII_WRITE_FIELDS } from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { LmsSyncProducer } from "../integrations/lms/lms-sync-producer.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PasswordService } from "../auth/password.service";
import { DataScopeService } from "../permission/data-scope.service";
import { PermissionService } from "../permission/permission.service";
import { SecurityPolicyService } from "../security-policy/security-policy.service";
import { SequenceService } from "../foundation/sequences/sequence.service";
import {
  SequenceInactiveError,
  SequenceNotFoundError,
} from "../foundation/sequences/sequence.types";
import { isUniqueViolation } from "../common/db-error";
// S2-INT-1: pure (non-provider) snapshot helper — guarantees the user.created audit never carries
// password_hash/normalized_email (BẤT BIẾN #3). Importing the function does NOT pull AuthUsersService
// into HR's DI graph (no module cycle).
import { authUserSnapshot } from "../users/auth-users.repository";
import type { User } from "../db/schema";
import { HrWriteRepository, type EmployeeUpdateData } from "./hr-write.repository";

type RequestUser = { id: string; companyId: string };

/**
 * S5-HR-IMPORT-BE-1 — resolved structural data for ONE bulk-import row. Reference names are already
 * resolved to ids by HrEmployeeImportService (per-tenant lookups). NO userId/email/password/fullName and
 * NO baseSalary/PII: an imported profile is UNLINKED and never provisions a login account.
 */
export interface ImportEmployeeCreateData {
  employeeCode: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  jobLevelId: string | null;
  contractTypeId: string | null;
  workType: string;
  employmentType: string;
  salaryType: string;
  startDate: string | null;
  endDate: string | null;
}

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

/** Employee writes are company-wide operations — only a Company/System data_scope may perform them. */
const WRITE_SCOPES: ReadonlySet<string> = new Set(["Company", "System"]);

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
    private readonly dataScope: DataScopeService,
    private readonly permissions: PermissionService,
    // S4-INT-5 (STORY-098) — transactional outbox for the activation/welcome producer.
    // From the @Global EventsModule (same source as AuditService) → no employees.module.ts import change.
    private readonly outbox: OutboxService,
    // S5-LMS-BE-1 — auto-sync tài khoản MediaOS→LMS. Enqueue outbox (cùng tx) khi đổi status của employee
    // có linked user. ZERO HTTP (fail-soft cấu trúc); company-gated bên trong producer. LmsSyncModule imported.
    private readonly lmsSync: LmsSyncProducer,
  ) {}

  /**
   * Defense-in-depth (mirrors the read core's resolveAndAssert): the PermissionGuard already gated the
   * pair, but resolve the caller's strongest write scope and FAIL-CLOSED unless it is Company/System.
   * Every seeded employee-write grant is Company today; this prevents a future sub-Company grant from
   * silently turning a write endpoint into a company-wide IDOR.
   */
  private async assertWriteScope(user: RequestUser, action: string): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      action,
      "employee",
    );
    if (!WRITE_SCOPES.has(scope)) {
      throw new ForbiddenException("AUTH-ERR-SCOPE-DENIED: employee write requires Company scope");
    }
  }

  /**
   * S2-INT-1 — gate the AUTH-create arm of employee creation. The PermissionGuard only gated
   * create:employee; minting a brand-new login account additionally requires create:user (fail-closed).
   * Called BEFORE any write/sequence allocation so a deny leaves zero side effects (acceptance #3).
   */
  private async assertCanProvisionUser(user: RequestUser): Promise<void> {
    const decision = await this.permissions.can({
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

  // ── Create ───────────────────────────────────────────────────────────────────────

  async createEmployee(user: RequestUser, dto: CreateHrEmployeeRequest) {
    await this.assertWriteScope(user, "create");
    // S2-INT-1: provisioning a NEW login account is an AUTH write — an actor with create:employee alone
    // must not be able to mint accounts. Linking an EXISTING user (dto.userId) creates no AUTH row, so
    // only create:employee is required there. Gate runs before code allocation → deny = 0 side effects.
    const willProvisionUser = !dto.userId && Boolean(dto.email);
    if (willProvisionUser) {
      await this.assertCanProvisionUser(user);
    }
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

        const { userId, provisioned } = await this.resolveUserId(tx, user.companyId, dto, user.id);
        await this.assertReferencesValid(tx, user.companyId, {
          orgUnitId: dto.orgUnitId,
          positionId: dto.positionId,
          jobLevelId: dto.jobLevelId,
          contractTypeId: dto.contractTypeId,
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

        // S2-INT-1: audit the AUTH side too when a brand-new account was minted — same tx as the HR
        // audit (BẤT BIẾN #2: both commit or both roll back). authUserSnapshot strips password_hash (#3).
        if (provisioned) {
          await this.audit.record(tx, {
            action: "user.created",
            objectType: "user",
            objectId: provisioned.id,
            actorUserId: user.id,
            after: authUserSnapshot(provisioned),
          });
          // S4-INT-5 (STORY-098) — activation/welcome producer. ONLY on a brand-new account (provisioned):
          // linking an EXISTING user mints no login row, so no "account created" welcome fires. Enqueued in
          // THIS tx (rollback ⇒ no ghost event). Recipient = the new user (payload.userId → NOTI-EVENT-001,
          // SPEC-08 §15). actorUserId is intentionally OMITTED: the new user is always ≠ the HR actor, so
          // actor-exclusion is a no-op — omitting it guarantees the welcome even in any edge case. Payload
          // carries NO secret (userId/employeeId/eventCode only); the bridge maps eventType→eventCode.
          await this.outbox.enqueue(tx, {
            eventType: "auth.user_created",
            payload: {
              eventCode: "AUTH_USER_CREATED",
              userId,
              employeeId: created.id,
            },
          });
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

  /**
   * S5-HR-IMPORT-BE-1 — thin create for a SINGLE bulk-import row. Reuses the create-core (code allocation
   * via SequenceService + reference validity + STRUCTURAL-only audit) but DELIBERATELY BYPASSES
   * resolveUserId and the provision branch: an imported profile is UNLINKED (user_id = NULL), no login
   * account is created or linked, and NO activation/welcome outbox event is emitted (createHrEmployeeSchema
   * + resolveUserId require userId|email — import must never mint accounts). Each call wraps its OWN
   * withTenant tx so the import service creates one row per transaction (partial-success: a failing row does
   * NOT roll back the others). Permission is enforced by the caller (import:employee, Company scope) BEFORE
   * the loop — this Tx helper is not a public entrypoint.
   */
  async createFromImportTx(user: RequestUser, data: ImportEmployeeCreateData) {
    const manualCode = data.employeeCode ?? null;
    // Auto-code allocated in its OWN tx BEFORE the insert tx (gaps OK, dups impossible) — mirrors create.
    const autoCode = manualCode ? null : await this.allocateEmployeeCode(user.companyId);
    const code = manualCode ?? autoCode;
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        if (manualCode) {
          const cfg = await this.repo.getActiveEmployeeCodeConfigTx(tx, user.companyId);
          if (cfg && cfg.allowManualOverride === false) {
            throw new ForbiddenException(
              "Manual employee code is not allowed by the active config",
            );
          }
        }
        // UNLINKED: subjectUserId is null — no resolveUserId, no account provisioning, no outbox event.
        await this.assertReferencesValid(tx, user.companyId, {
          orgUnitId: data.orgUnitId ?? undefined,
          positionId: data.positionId ?? undefined,
          jobLevelId: data.jobLevelId ?? undefined,
          contractTypeId: data.contractTypeId ?? undefined,
          subjectUserId: null,
        });

        const created = await this.repo.createTx(tx, user.companyId, {
          userId: null,
          employeeCode: code,
          orgUnitId: data.orgUnitId ?? null,
          positionId: data.positionId ?? null,
          jobLevelId: data.jobLevelId ?? null,
          contractTypeId: data.contractTypeId ?? null,
          directManagerId: null,
          workType: data.workType,
          employmentType: data.employmentType,
          salaryType: data.salaryType,
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
        });
        if (!created) throw new Error("Failed to create employee profile");

        await this.audit.record(tx, {
          action: "create",
          objectType: "employee",
          objectId: created.id,
          actorUserId: user.id,
          before: null,
          after: this.structuralSnapshot({
            employeeCode: created.employeeCode,
            orgUnitId: data.orgUnitId ?? null,
            positionId: data.positionId ?? null,
            jobLevelId: data.jobLevelId ?? null,
            contractTypeId: data.contractTypeId ?? null,
            directManagerId: null,
            workType: data.workType,
            employmentType: data.employmentType,
            salaryType: data.salaryType,
            startDate: data.startDate ?? null,
            endDate: data.endDate ?? null,
            status: "active",
          }),
        });

        return { id: created.id, employeeCode: created.employeeCode };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Employee code already exists (duplicate import row)");
      }
      throw err;
    }
  }

  // ── Update ───────────────────────────────────────────────────────────────────────

  async updateEmployee(user: RequestUser, id: string, dto: UpdateHrEmployeeRequest) {
    await this.assertWriteScope(user, "update");
    // HR-PROFILE-UI-1b — PII write gate (fail-closed, TRƯỚC mọi side effect): body chạm field cá nhân
    // ⇒ caller phải có view-sensitive:employee trên CHÍNH row này ("không thấy thì không được sửa";
    // sensitive pair → wildcard *:* không mở). Field directory/cấu trúc không đòi thêm gì.
    const piiTouched = HR_EMPLOYEE_PII_WRITE_FIELDS.filter((k) => dto[k] !== undefined);
    if (piiTouched.length > 0) {
      const decision = await this.permissions.can({
        userId: user.id,
        companyId: user.companyId,
        action: "view-sensitive",
        resourceType: "employee",
        resourceId: id,
        isSensitive: true,
      });
      if (!decision.allow) {
        throw new ForbiddenException(
          "HR-ERR-PII-WRITE-DENIED: updating personal fields requires the view-sensitive:employee permission",
        );
      }
    }
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const before = await this.repo.findStructuralByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Employee not found");
        const subjectUserId = (before["userId"] as string | null | undefined) ?? null;

        // Only the keys the client actually sent; refs validated when present (incl. manager ≠ self).
        // personalExtra là FULL-REPLACE: {} chuẩn hoá thành null (xóa blob).
        const patch = { ...dto } as EmployeeUpdateData;
        if (patch.personalExtra && Object.keys(patch.personalExtra).length === 0) {
          patch.personalExtra = null;
        }
        await this.assertReferencesValid(tx, user.companyId, {
          orgUnitId: dto.orgUnitId ?? undefined,
          positionId: dto.positionId ?? undefined,
          jobLevelId: dto.jobLevelId ?? undefined,
          contractTypeId: dto.contractTypeId ?? undefined,
          directManagerId: dto.directManagerId ?? undefined,
          subjectUserId,
        });

        const updated = await this.repo.updateTx(tx, user.companyId, id, patch);
        if (!updated) throw new NotFoundException("Employee not found");

        // Keep employee_manager_relations consistent with the direct_manager_id shortcut (mirror create).
        if (dto.directManagerId !== undefined && subjectUserId) {
          await this.repo.softDeleteDirectManagerEmrTx(tx, user.companyId, subjectUserId);
          if (dto.directManagerId) {
            await this.repo.insertDirectManagerEmrTx(
              tx,
              user.companyId,
              subjectUserId,
              dto.directManagerId,
            );
          }
        }

        const structural = this.diffStructural(before, dto);
        // HR-PROFILE-UI-1b: PII thay đổi chỉ được audit bằng TÊN field trong diffSummary/changedFields.
        // before/after KHÔNG chứa key PII nào — kể cả giá trị đã mask (audit_logs append-only,
        // BẤT BIẾN #3; suite hiện hành ép: FORBIDDEN_AUDIT_KEYS cấm key PII trong payload).
        const piiChangedFields = this.diffPiiFieldNames(before, patch);
        const changedFields = [...structural.changedFields, ...piiChangedFields];
        if (changedFields.length > 0) {
          await this.audit.record(tx, {
            action: "update",
            objectType: "employee",
            objectId: id,
            actorUserId: user.id,
            before: structural.beforeDiff,
            after: structural.afterDiff,
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
    await this.assertWriteScope(user, "change-status");
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
      // Never let an actor lock their OWN account via a status change (self-lockout / last-admin DoS).
      if (dto.lockUser && LOCKING_STATUSES.has(newStatus) && row.userId && row.userId !== user.id) {
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
      // S5-LMS-BE-1: enqueue LMS auto-sync CÙNG tx SAU mutation (đọc state post-change). Employee có linked
      // user (row.userId) → producer resolve {email,active} + enqueue; userId null / ngoài LMS-company → no-op.
      await this.lmsSync.enqueueSync(tx, user.companyId, row.userId);
      return { id, status: newStatus };
    });
  }

  // ── S5-ME-BE-2: self-service avatar (own-scope, KHÔNG cần Company/System write-scope) ──────────────

  /**
   * ME avatar self-service: ghi `employee_profiles.avatar_url` của CHÍNH employee liên kết `user` (own-scope
   * thuần — KHÔNG gọi `assertWriteScope`/`view-sensitive` như `updateEmployee`: avatar KHÔNG phải field
   * PII/company-wide-write, đây là mutation CHÍNH MÌNH trên CHÍNH MÌNH, gate thật ở caller là
   * `update:avatar` Own — mig 0495). `findOwnAvatarForUpdateTx` AND `userId` ngay trong WHERE ⇒ employee
   * KHÔNG thuộc actor (cross-user/cross-tenant) → 0 row → 404 (chống IDOR, KHÔNG oracle).
   *
   * Idempotent: giá trị mới === giá trị cũ → KHÔNG UPDATE, KHÔNG audit (no-op thật, tránh audit rác khi
   * client retry). audit `objectType:'employee'` (ĐÃ có trong CHECK — KHÔNG cần migration UNION-add) action
   * `avatar-update`/`avatar-remove`; before/after CHỈ `{avatarUrl}` (fileId reference — KHÔNG PII/secret).
   */
  async updateOwnAvatar(
    user: RequestUser,
    employeeId: string,
    avatarUrl: string | null,
  ): Promise<{ id: string; avatarUrl: string | null }> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findOwnAvatarForUpdateTx(tx, user.companyId, employeeId, user.id);
      if (!row) throw new NotFoundException("Employee not found");

      const before = row.avatarUrl;
      if (before === avatarUrl) return { id: row.id, avatarUrl: before };

      await this.repo.updateAvatarUrlTx(tx, user.companyId, employeeId, avatarUrl);
      await this.audit.record(tx, {
        action: avatarUrl ? "avatar-update" : "avatar-remove",
        objectType: "employee",
        objectId: employeeId,
        actorUserId: user.id,
        before: { avatarUrl: before },
        after: { avatarUrl },
      });
      return { id: row.id, avatarUrl };
    });
  }

  // ── Link / unlink user ───────────────────────────────────────────────────────────

  async linkUser(user: RequestUser, id: string, dto: LinkUserRequest) {
    await this.assertWriteScope(user, "update");
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
    await this.assertWriteScope(user, "update");
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
   * Allocate the next employee code via SequenceService in its OWN tx. A missing counter triggers
   * ensure-on-miss (S2-FND-SEED-2, OWNER CHỐT 2026-07-03) EXACTLY ONCE: read the tenant's REAL
   * employee_code_config (seeded by HrMasterDataSeeder at reconcile-time, or set by admin PATCH) and, only
   * when that row exists, provision the counter from it and retry once. An Inactive counter
   * (SequenceInactiveError) is NEVER auto-re-enabled — it 422s immediately, same as a genuinely
   * unconfigured tenant (no config row at all — CẤM hard-code EMP/4 as a fallback).
   */
  private async allocateEmployeeCode(companyId: string): Promise<string> {
    try {
      return await this.requestNextEmployeeCode(companyId);
    } catch (err) {
      if (err instanceof SequenceNotFoundError) {
        const ensured = await this.ensureEmployeeCodeCounterFromConfig(companyId);
        if (ensured) {
          try {
            return await this.requestNextEmployeeCode(companyId);
          } catch (retryErr) {
            throw this.toCodeAllocationError(retryErr);
          }
        }
      }
      throw this.toCodeAllocationError(err);
    }
  }

  private async requestNextEmployeeCode(companyId: string): Promise<string> {
    const { code } = await this.sequence.nextCode(companyId, {
      sequenceKey: EMPLOYEE_CODE_SEQUENCE_KEY,
    });
    return code;
  }

  private toCodeAllocationError(err: unknown): Error {
    if (err instanceof SequenceNotFoundError || err instanceof SequenceInactiveError) {
      return new UnprocessableEntityException(
        "HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID: cannot generate an employee code — provide one manually or configure the code sequence",
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  /**
   * Ensure-on-miss: reads employee_code_configs (the ONLY source of prefix/padding/status here — never
   * hard-coded) and, ONLY when a row exists, provisions the sequence_counters row to match it
   * (module_code='HR', reset_policy='Never', current_value starts at 0 ⇒ first code renders correctly).
   * Returns false (no side effect) when no config row exists — the caller keeps the original 422.
   */
  private async ensureEmployeeCodeCounterFromConfig(companyId: string): Promise<boolean> {
    return this.db.withTenant(companyId, async (tx) => {
      const config = await this.repo.findEmployeeCodeConfigTx(tx, companyId);
      if (!config) return false;

      await this.sequence.ensureCounterTx(
        tx,
        companyId,
        { sequenceKey: EMPLOYEE_CODE_SEQUENCE_KEY },
        {
          sequenceKey: EMPLOYEE_CODE_SEQUENCE_KEY,
          moduleCode: "HR",
          prefix: config.prefix,
          paddingLength: config.numberLength,
          resetPolicy: "Never",
          status: config.status === "active" ? "Active" : "Inactive",
        },
      );
      return true;
    });
  }

  /**
   * Resolve an existing user or provision a login account (mirrors the legacy create path).
   * Returns the resolved `userId` plus `provisioned` — the freshly-minted row when (and only when) a
   * new account was created, so the caller can emit a `user.created` audit (S2-INT-1). Keep
   * `provisioned` confined to `authUserSnapshot`; it carries password_hash and must never be returned
   * to the client or logged.
   */
  private async resolveUserId(
    tx: TenantTx,
    companyId: string,
    dto: CreateHrEmployeeRequest,
    actorUserId: string,
  ): Promise<{ userId: string; provisioned: User | null }> {
    if (dto.userId) {
      const existing = await this.repo.findLinkableUserTx(tx, companyId, dto.userId);
      if (!existing) throw new NotFoundException("User not found in this company");
      // Enforce "1 user ↔ ≤1 active employee" up-front (exceptId=null: no existing row on create).
      // The partial-unique index remains the authoritative DB backstop against a race.
      const clash = await this.repo.findActiveByUserIdTx(tx, companyId, dto.userId, null);
      if (clash) {
        throw new ConflictException("User is already linked to another active employee");
      }
      return { userId: dto.userId, provisioned: null };
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
      createdBy: actorUserId,
    });
    if (!created) throw new Error("Failed to create login account");
    return { userId: created.id, provisioned: created };
  }

  /**
   * Validate referenced master data (org_unit/position/job_level/contract_type) is active in-tenant,
   * and that a manager is a valid in-tenant user who is not the subject. Without these checks a stale or
   * cross-tenant FK id surfaces as a raw PG FK violation (23503) → generic 500; here it maps to 422.
   */
  private async assertReferencesValid(
    tx: TenantTx,
    companyId: string,
    refs: {
      orgUnitId?: string;
      positionId?: string;
      jobLevelId?: string;
      contractTypeId?: string;
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
    if (refs.jobLevelId && !(await this.repo.jobLevelActiveTx(tx, companyId, refs.jobLevelId))) {
      throw new UnprocessableEntityException("HR-ERR-JOB-LEVEL-INACTIVE");
    }
    if (
      refs.contractTypeId &&
      !(await this.repo.contractTypeActiveTx(tx, companyId, refs.contractTypeId))
    ) {
      throw new UnprocessableEntityException("HR-ERR-CONTRACT-TYPE-INACTIVE");
    }
    if (refs.directManagerId) {
      if (refs.subjectUserId && refs.directManagerId === refs.subjectUserId) {
        throw new BadRequestException("An employee cannot be their own direct manager");
      }
      // Validate the manager exists in-tenant (else the FK violation would surface as a raw 500).
      if (!(await this.repo.findLinkableUserTx(tx, companyId, refs.directManagerId))) {
        throw new UnprocessableEntityException("HR-ERR-MANAGER-INVALID");
      }
    }
  }

  /** Build an audit-safe snapshot — STRUCTURAL + DIRECTORY keys only (never baseSalary/PII). */
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
      // HR-PROFILE-UI-1b — directory-class (không PII): giá trị vào audit bình thường.
      "officialDate",
      "probationEndDate",
      "workLocation",
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

  /**
   * HR-PROFILE-UI-1b — diff nhóm PII của PATCH: so sánh với before-values (CHỈ trong bộ nhớ request)
   * để phát hiện thay đổi thật; trả về DANH SÁCH TÊN field — không bao giờ trả giá trị. Tên field đi
   * vào changedFields/diffSummary; giá trị PII không được chạm audit_logs (BẤT BIẾN #3).
   */
  private diffPiiFieldNames(before: Record<string, unknown>, patch: EmployeeUpdateData): string[] {
    const changedFields: string[] = [];
    for (const key of HR_EMPLOYEE_PII_WRITE_FIELDS) {
      const next = patch[key];
      if (next === undefined) continue;
      const prev = before[key] ?? null;
      const changed =
        key === "personalExtra"
          ? JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)
          : (next ?? null) !== prev;
      if (changed) changedFields.push(key);
    }
    return changedFields;
  }
}
