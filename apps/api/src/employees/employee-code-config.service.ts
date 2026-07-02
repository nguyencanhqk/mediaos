import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type {
  EmployeeCodeConfigDto,
  EmployeeCodePreviewResponse,
  UpdateEmployeeCodeConfigRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService } from "../db/db.service";
import type { EmployeeCodeConfig } from "../db/schema";
import { SequenceService } from "../foundation/sequences/sequence.service";
import {
  SequenceInactiveError,
  SequenceNotFoundError,
} from "../foundation/sequences/sequence.types";
import { EMPLOYEE_CODE_SEQUENCE_KEY } from "./hr-write.service";
import {
  EmployeeCodeConfigRepository,
  type EmployeeCodeConfigPatch,
} from "./employee-code-config.repository";

type RequestUser = { id: string; companyId: string };

/** Effective defaults when a tenant has no persisted config row yet (mirrors the DB column defaults). */
const CONFIG_DEFAULTS = {
  prefix: null as string | null,
  pattern: null as string | null,
  numberLength: 4,
  allowManualOverride: true,
  status: "active",
} as const;

/** Audit-safe config snapshot — the code FORMAT only. NEVER current_value/counter/secret (BẤT BIẾN #3). */
interface CodeConfigSnapshot {
  prefix: string | null;
  pattern: string | null;
  numberLength: number;
  allowManualOverride: boolean;
  status: string;
}

/**
 * S2-HR-BE-7 — Employee-code CONFIG admin (API-03 §10.10 HR-API-901/902/903). Crown-jewel touch points:
 *  - BẤT BIẾN #1: every read/write runs in `withTenant(user.companyId)`; the repo ANDs company_id.
 *  - BẤT BIẾN #2: PATCH writes the audit row in the SAME tx as the config write (both commit or both roll
 *    back); audit_logs is append-only — a leak would be permanent.
 *  - BẤT BIẾN #3: the audit before/after snapshot carries the code FORMAT only (prefix/pattern/
 *    number_length/allow_manual_override/status) — never the running counter/current_value/secret.
 *
 * The controller has already authenticated + gated the pair (PermissionGuard) — this service does NOT
 * re-guard. Preview delegates to SequenceService.previewNextCode (read-only, no mutation).
 */
@Injectable()
export class EmployeeCodeConfigService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: EmployeeCodeConfigRepository,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
  ) {}

  /** GET — the tenant's config, or the effective defaults when no row exists yet (never 404). */
  async getConfig(user: RequestUser): Promise<EmployeeCodeConfigDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findConfigTx(tx, user.companyId);
      return this.toDto(user.companyId, row);
    });
  }

  /**
   * PATCH — upsert the config (insert on first write) + write ONE CONFIG_UPDATE audit row in the same tx.
   * old/new are supplied so AuditService computes changed_fields; both are config-only snapshots.
   */
  async updateConfig(
    user: RequestUser,
    dto: UpdateEmployeeCodeConfigRequest,
  ): Promise<EmployeeCodeConfigDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findConfigTx(tx, user.companyId);

      const after = before
        ? await this.repo.updateConfigTx(
            tx,
            user.companyId,
            before.id,
            dto as EmployeeCodeConfigPatch,
          )
        : await this.repo.insertConfigTx(tx, user.companyId, {
            prefix: dto.prefix ?? CONFIG_DEFAULTS.prefix,
            pattern: dto.pattern ?? CONFIG_DEFAULTS.pattern,
            numberLength: dto.numberLength ?? CONFIG_DEFAULTS.numberLength,
            allowManualOverride: dto.allowManualOverride ?? CONFIG_DEFAULTS.allowManualOverride,
            status: dto.status ?? CONFIG_DEFAULTS.status,
          });
      if (!after) throw new Error("Failed to persist employee code config");

      const beforeSnap = before ? this.snapshot(before) : null;
      const afterSnap = this.snapshot(after);

      await this.audit.record(tx, {
        action: "CONFIG_UPDATE",
        objectType: "employee_code_config",
        objectId: after.id,
        actorUserId: user.id,
        before: beforeSnap,
        after: afterSnap,
        // v2 old/new → AuditService computes changed_fields (from masked, config-only values).
        oldValues: beforeSnap,
        newValues: afterSnap,
      });

      return this.toDto(user.companyId, after);
    });
  }

  /**
   * POST /hr/employee-code/preview — the NEXT employee code WITHOUT mutating the counter. Delegates to
   * SequenceService.previewNextCode (no lock, no UPDATE). A missing/inactive counter → 422, never 500.
   */
  async preview(user: RequestUser): Promise<EmployeeCodePreviewResponse> {
    try {
      return await this.sequence.previewNextCode(user.companyId, {
        sequenceKey: EMPLOYEE_CODE_SEQUENCE_KEY,
      });
    } catch (err) {
      if (err instanceof SequenceNotFoundError || err instanceof SequenceInactiveError) {
        throw new UnprocessableEntityException(
          "HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID: no active employee-code sequence — configure the code sequence first",
        );
      }
      throw err;
    }
  }

  /** Config-only snapshot for audit (BẤT BIẾN #3 — never current_value/counter/secret/PII). */
  private snapshot(row: EmployeeCodeConfig): CodeConfigSnapshot {
    return {
      prefix: row.prefix,
      pattern: row.pattern,
      numberLength: row.numberLength,
      allowManualOverride: row.allowManualOverride,
      status: row.status,
    };
  }

  /** Map a row (or absence) to the response DTO; defaults returned when no row exists. */
  private toDto(companyId: string, row: EmployeeCodeConfig | undefined): EmployeeCodeConfigDto {
    if (!row) {
      return {
        id: null,
        companyId,
        prefix: CONFIG_DEFAULTS.prefix,
        pattern: CONFIG_DEFAULTS.pattern,
        numberLength: CONFIG_DEFAULTS.numberLength,
        allowManualOverride: CONFIG_DEFAULTS.allowManualOverride,
        status: CONFIG_DEFAULTS.status as EmployeeCodeConfigDto["status"],
        createdAt: null,
        updatedAt: null,
      };
    }
    return {
      id: row.id,
      companyId: row.companyId,
      prefix: row.prefix,
      pattern: row.pattern,
      numberLength: row.numberLength,
      allowManualOverride: row.allowManualOverride,
      status: row.status as EmployeeCodeConfigDto["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
