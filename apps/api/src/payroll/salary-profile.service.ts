import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  Allowance,
  CreateSalaryProfileRequest,
  SalaryProfileListQuery,
  UpdateSalaryProfileRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import type { CanInput, PermissionDecision } from "../permission/permission.types";
import { SalaryProfileRepository } from "./salary-profile.repository";

const PG_UNIQUE_VIOLATION = "23505";

type RequestUser = { id: string; companyId: string };

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === PG_UNIQUE_VIOLATION
  );
}

/** A DB row whose salary fields are sensitive and must be projected through the permission gate. */
type SalaryMaskable = { baseSalary: unknown; allowances: unknown };

/**
 * Project base_salary + allowances onto the DTO: the real values when `allow`, otherwise `null`.
 * BẤT BIẾN #3 — lương không bao giờ rời server cho role không có view-salary-profile.
 */
function maskSalary<T extends SalaryMaskable>(
  item: T,
  allow: boolean,
): Omit<T, "baseSalary" | "allowances"> & {
  baseSalary: number | null;
  allowances: Allowance[] | null;
} {
  if (!allow) {
    return { ...item, baseSalary: null, allowances: null };
  }
  const baseSalary = item.baseSalary != null ? Number(item.baseSalary) : null;
  const allowances = (item.allowances ?? null) as Allowance[] | null;
  return { ...item, baseSalary, allowances };
}

/**
 * SalaryProfileService — CROWN JEWEL. Lương nhạy cảm (ADR-0010, BẤT BIẾN #3):
 *  - permission.can với isSensitive=TRUE + resourceId (object_permissions honored; wildcard KHÔNG đủ).
 *  - mask mặc định; reveal ⟹ audit-in-tx (đọc lương ghi 1 audit 'salary_profile_viewed').
 *  - sửa lương ghi 1 audit before/after trong cùng tx (atomic) — audit fail ⇒ rollback ⇒ lương không lộ.
 *  - mapError: lỗi PG/infra → 500 generic, KHÔNG leak schema/constraint.
 * Mirror employees.service (view-salary / update-salary) — đây là sự thật của G5-FIX.
 */
@Injectable()
export class SalaryProfileService {
  private readonly logger = new Logger(SalaryProfileService.name);

  constructor(
    private readonly repo: SalaryProfileRepository,
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  private decision(
    user: RequestUser,
    action: "view-salary-profile" | "manage-salary-profile",
    targetId: string | null,
  ): Promise<PermissionDecision> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action,
      resourceType: "salary_profile",
      resourceId: targetId,
      isSensitive: true,
    };
    return this.permissionService.can(input);
  }

  async list(user: RequestUser, filters: SalaryProfileListQuery) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.listTx(tx, user.companyId, filters);
        // Sequential (not Promise.all): audit INSERTs share the tx connection and must not interleave.
        const reveals: boolean[] = [];
        for (const row of rows) {
          reveals.push(await this.revealSalary(tx, user, row.id));
        }
        return rows.map((row, i) => maskSalary(row, reveals[i]));
      });
    } catch (err) {
      throw this.mapError(err, "Failed to list salary profiles");
    }
  }

  async getOne(user: RequestUser, id: string) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const row = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!row) throw new NotFoundException("Salary profile not found");
        const reveal = await this.revealSalary(tx, user, id);
        return maskSalary(row, reveal);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to read salary profile");
    }
  }

  /**
   * Decide whether to reveal salary AND write the view audit atomically (mirror revealSalary).
   * reveal ⟹ audit: only return base_salary/allowances when `allow && auditRequired`, and in that case
   * record the view inside the caller's tx. allow && !auditRequired (misconfig for a sensitive action)
   * → fail SAFE: mask, write nothing.
   */
  private async revealSalary(tx: TenantTx, user: RequestUser, targetId: string): Promise<boolean> {
    const decision = await this.decision(user, "view-salary-profile", targetId);
    const reveal = decision.allow && decision.auditRequired;
    if (reveal) {
      await this.auditService.record(tx, {
        action: "salary_profile_viewed",
        objectType: "salary_profile",
        objectId: targetId,
        actorUserId: user.id,
      });
    }
    return reveal;
  }

  async create(user: RequestUser, dto: CreateSalaryProfileRequest) {
    try {
      const created = await this.db.withTenant(user.companyId, async (tx) => {
        // manage-salary-profile is sensitive (resourceId=null → type-level check; per-object on update).
        const decision = await this.decision(user, "manage-salary-profile", null);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage salary profile");
        }
        const rows = await this.repo.createTx(tx, user.companyId, {
          userId: dto.userId,
          salaryType: dto.salaryType,
          payCycle: dto.payCycle,
          effectiveDate: dto.effectiveDate,
          baseSalary: String(dto.baseSalary),
          allowances: dto.allowances,
          currency: dto.currency,
          note: dto.note ?? null,
        });
        const profile = rows[0];
        if (!profile) throw new Error("Failed to create salary profile");

        await this.auditService.record(tx, {
          action: "salary_profile_created",
          objectType: "salary_profile",
          objectId: profile.id,
          actorUserId: user.id,
          after: this.auditPayload(profile),
        });
        return profile;
      });
      // Mutation responses mask salary by default — view via the audited GET /salary-profiles/:id.
      return maskSalary(created, false);
    } catch (err) {
      throw this.mapError(err, "Failed to create salary profile");
    }
  }

  async update(user: RequestUser, id: string, dto: UpdateSalaryProfileRequest) {
    try {
      const updated = await this.db.withTenant(user.companyId, async (tx) => {
        // Checked INSIDE the tx, right before the write, to minimize the TOCTOU window.
        const decision = await this.decision(user, "manage-salary-profile", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage salary profile");
        }

        // Read prior values inside the tx so before/after is consistent with the write.
        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Salary profile not found");

        const rows = await this.repo.updateTx(tx, user.companyId, id, {
          salaryType: dto.salaryType,
          payCycle: dto.payCycle,
          effectiveDate: dto.effectiveDate,
          baseSalary: dto.baseSalary != null ? String(dto.baseSalary) : undefined,
          allowances: dto.allowances,
          currency: dto.currency,
          status: dto.status,
          note: dto.note === undefined ? undefined : dto.note,
        });
        const row = rows[0];
        if (!row) throw new NotFoundException("Salary profile not found");

        // before/after live ONLY in the controlled audit trail (append-only, RLS). reveal⟹audit atomic:
        // a failed audit INSERT rolls back the whole update → the salary change is not persisted.
        await this.auditService.record(tx, {
          action: "salary_profile_updated",
          objectType: "salary_profile",
          objectId: id,
          actorUserId: user.id,
          before: this.auditPayload(before),
          after: this.auditPayload(row),
        });
        return row;
      });
      return maskSalary(updated, false);
    } catch (err) {
      throw this.mapError(err, "Failed to update salary profile");
    }
  }

  async remove(user: RequestUser, id: string) {
    try {
      await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "manage-salary-profile", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage salary profile");
        }
        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Salary profile not found");

        const rows = await this.repo.softDeleteTx(tx, user.companyId, id);
        if (rows.length === 0) throw new NotFoundException("Salary profile not found");

        await this.auditService.record(tx, {
          action: "salary_profile_deleted",
          objectType: "salary_profile",
          objectId: id,
          actorUserId: user.id,
          before: this.auditPayload(before),
        });
      });
    } catch (err) {
      throw this.mapError(err, "Failed to delete salary profile");
    }
  }

  /** Snapshot the salary fields for the audit trail (numbers normalized; never logged elsewhere). */
  private auditPayload(row: { baseSalary: unknown; allowances: unknown; status?: unknown }) {
    return {
      base_salary: row.baseSalary != null ? Number(row.baseSalary) : null,
      allowances: row.allowances ?? null,
      ...(row.status !== undefined ? { status: row.status } : {}),
    };
  }

  /**
   * Map low-level errors to safe HTTP errors. Domain HttpExceptions pass through; a unique-violation
   * becomes a 409 (active profile already exists); everything else is a generic 500 with the PG detail
   * logged server-side ONLY — never leak schema/constraint/code to the client (silent-failure-hunter:
   * we still log, we just don't expose).
   */
  private mapError(err: unknown, context: string): Error {
    if (err instanceof ForbiddenException || err instanceof NotFoundException) {
      return err;
    }
    if (isUniqueViolation(err)) {
      return new ConflictException("An active salary profile already exists for this user");
    }
    this.logger.error(context, {
      error: err instanceof Error ? err.message : String(err),
      code: (err as { code?: unknown } | null)?.code,
    });
    return new InternalServerErrorException("Internal server error");
  }
}
