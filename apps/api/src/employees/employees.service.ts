import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "crypto";
import type {
  CreateEmployeeProfileRequest,
  EmployeeListQuery,
  ImportEmployeeRow,
  UpdateEmployeeProfileRequest,
} from "@mediaos/contracts";
import { importEmployeeRowSchema } from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PasswordService } from "../auth/password.service";
import { PermissionService } from "../permission/permission.service";
import { ValkeyService } from "../permission/valkey.service";
import type { CanInput, PermissionDecision } from "../permission/permission.types";
import { SecurityPolicyService } from "../security-policy/security-policy.service";
import { EmployeesRepository, type BulkEmployeeRow } from "./employees.repository";
import { isUniqueViolation } from "../common/db-error";

const IMPORT_SESSION_TTL_SEC = 5 * 60; // plan §7: 5 minutes
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const GENERATED_PASSWORD_BYTES = 18;

/** Mimetypes browsers/curl commonly attach to a `.csv` upload. */
const CSV_MIME_TYPES = new Set(["text/csv", "application/csv", "application/vnd.ms-excel"]);

function isCsvMime(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return CSV_MIME_TYPES.has(contentType.split(";")[0].trim().toLowerCase());
}

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

function importSessionKey(companyId: string, userId: string, sessionId: string): string {
  return `import:${companyId}:${userId}:${sessionId}`;
}

type RequestUser = { id: string; companyId: string };

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly repo: EmployeesRepository,
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
    private readonly valkey: ValkeyService,
    private readonly password: PasswordService,
    private readonly securityPolicy: SecurityPolicyService,
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
    // Read + per-item salary audit share ONE tenant tx (same atomic guarantee as getEmployee):
    // a failed audit INSERT rolls back and no salary is revealed. Salary scope can be per-employee
    // (object_permissions), so each row is decided/masked individually — no all-or-nothing shortcut.
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.listEmployeesTx(tx, user.companyId, filters);
      // Sequential (not Promise.all): audit INSERTs share the tx connection and must not interleave.
      const reveals: boolean[] = [];
      for (const row of rows) {
        reveals.push(await this.revealSalary(tx, user, row.id));
      }
      return rows.map((row, i) => maskSalary(row, reveals[i]));
    });
  }

  async getEmployee(user: RequestUser, id: string) {
    // Read + audit share one tenant tx: a failed audit INSERT rolls back and the salary is not
    // revealed (mirrors platform-accounts reveal). A missing row throws before any audit is written.
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!row) throw new NotFoundException("Employee not found");
      const reveal = await this.revealSalary(tx, user, id);
      return maskSalary(row, reveal);
    });
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

    try {
      const created = await this.db.withTenant(user.companyId, async (tx) => {
        const userId = await this.resolveUserId(tx, user.companyId, dto);
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
        if (dto.directManagerId !== undefined) {
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

  private async resolveUserId(
    tx: TenantTx,
    companyId: string,
    dto: CreateEmployeeProfileRequest,
  ): Promise<string> {
    if (dto.userId) return dto.userId;
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
    });
    if (!newUser) throw new Error("Failed to create login account");
    return newUser.id;
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

  // ── F6: Import CSV Phase 1 — parse + validate → stage in Valkey ─────────────────

  async parseImportPreview(
    companyId: string,
    userId: string,
    fileBuffer: Buffer,
    contentType: string,
  ) {
    if (!isCsvMime(contentType)) {
      throw new BadRequestException("Invalid file type — expected a CSV (text/csv)");
    }
    if (fileBuffer.length > MAX_IMPORT_BYTES) {
      throw new BadRequestException("File too large (max 5MB)");
    }

    // Lazy-load csv-parse to avoid top-level import issues in test environments.
    const { parse } = await import("csv-parse/sync");
    let records: unknown[];
    try {
      records = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as unknown[];
    } catch (err) {
      // Log the parser detail server-side (a malformed file and a parser bug look identical to the client).
      this.logger.warn("CSV parse failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new BadRequestException("Invalid CSV format");
    }

    const valid: ImportEmployeeRow[] = [];
    const invalid: { row: number; errors: string[] }[] = [];

    for (let i = 0; i < records.length; i++) {
      const result = importEmployeeRowSchema.safeParse(records[i]);
      if (result.success) {
        valid.push(result.data);
      } else {
        invalid.push({
          row: i + 2, // 1-based, +1 for header row
          errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
        });
      }
    }

    const sessionId = randomUUID();
    // Surface a staging failure instead of returning a sessionId the client can't confirm with
    // (which would later 409 misleadingly). set() returns false only on a real Valkey error.
    const staged = await this.valkey.set(
      importSessionKey(companyId, userId, sessionId),
      JSON.stringify(valid),
      IMPORT_SESSION_TTL_SEC,
    );
    if (!staged) {
      throw new ServiceUnavailableException(
        "Import staging is temporarily unavailable — please retry",
      );
    }
    return { valid, invalid, sessionId };
  }

  // ── F6: Import CSV Phase 2 — confirm + bulk insert (single tenant tx) ───────────

  async confirmImport(companyId: string, userId: string, sessionId: string) {
    const key = importSessionKey(companyId, userId, sessionId);

    // Consume the staged batch BEFORE inserting → a concurrent/duplicate confirm sees a missing key
    // and 409s (idempotent confirm). When Valkey is unreachable get() returns null (fail-closed for
    // import) → 409 rather than inserting an unvalidated batch.
    const raw = await this.valkey.get(key);
    if (raw == null) {
      throw new ConflictException("Import session not found, expired, or already consumed");
    }
    // NOTE: get()+del() is not a single atomic compare-and-delete; a fully atomic GETDEL belongs in
    // ValkeyService (owned by another lane). The DB unique index (company_id, user_id) is the real
    // backstop — a racing second confirm hits 23505 below and is rejected. Refuse if we can't consume.
    const consumed = await this.valkey.del(key);
    if (!consumed) {
      throw new ServiceUnavailableException("Could not consume import session — please retry");
    }

    let rows: ImportEmployeeRow[];
    try {
      // Re-validate the deserialized payload — never trust the cache shape (tamper / cross-version).
      const parsed = importEmployeeRowSchema.array().safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) throw new Error("schema mismatch");
      rows = parsed.data;
    } catch (err) {
      this.logger.error("Corrupt import session payload", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new BadRequestException("Corrupt import session payload");
    }

    // Re-validate lookups + bulk insert inside ONE withTenant: any failed row rolls back the batch.
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const insertData: BulkEmployeeRow[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const matchedUser = await this.repo.findUserByEmailTx(tx, companyId, row.email);
          if (!matchedUser) {
            throw new BadRequestException(`Row ${i + 2}: user not found in company`);
          }

          let orgUnitId: string | undefined;
          if (row.orgUnitName) {
            const ou = await this.repo.findOrgUnitByNameTx(tx, companyId, row.orgUnitName);
            if (!ou) {
              throw new BadRequestException(
                `Row ${i + 2}: org unit not found (name may have changed since preview)`,
              );
            }
            orgUnitId = ou.id;
          }

          let positionId: string | undefined;
          if (row.positionName) {
            const pos = await this.repo.findPositionByNameTx(tx, companyId, row.positionName);
            if (!pos) {
              throw new BadRequestException(
                `Row ${i + 2}: position not found (name may have changed since preview)`,
              );
            }
            positionId = pos.id;
          }

          insertData.push({
            userId: matchedUser.id,
            employeeCode: row.employeeCode,
            orgUnitId,
            positionId,
            workType: row.workType,
            employmentType: row.employmentType,
            startDate: row.startDate,
          });
        }

        if (insertData.length === 0) {
          return { inserted: 0, failed: 0 };
        }

        const inserted = await this.repo.bulkCreateEmployeesTx(tx, companyId, insertData);
        return { inserted: inserted.length, failed: 0 };
      });
    } catch (err) {
      // A racing duplicate confirm (or re-import) collides on the (company_id, user_id) unique index.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          "One or more employees already have a profile (possible duplicate import)",
        );
      }
      throw err;
    }
  }
}
