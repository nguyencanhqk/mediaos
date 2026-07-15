import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import {
  auditLogs,
  contractTypes,
  employeeProfiles,
  jobLevels,
  orgUnits,
  positions,
  users,
} from "../db/schema";

/**
 * S5-HR-IMPORT-BE-1 — read/lookup + session-audit repository for HR bulk import. Every method runs inside
 * the caller's tenant tx (`withTenant` → RLS+FORCE); each WHERE also ANDs `company_id` (belt+suspenders,
 * BẤT BIẾN #1). Reference lookups resolve a human-typed NAME → id (active + non-deleted only), mirroring
 * the reference validity the create path enforces. Deliberately separate from the legacy EmployeesRepository
 * import lookups so the new unlinked-import path does not couple to the media-era code.
 */
@Injectable()
export class HrEmployeeImportRepository {
  async findOrgUnitIdByNameTx(
    tx: TenantTx,
    companyId: string,
    name: string,
  ): Promise<string | undefined> {
    const [row] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.companyId, companyId),
          eq(orgUnits.name, name),
          eq(orgUnits.status, "active"),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1);
    return row?.id;
  }

  async findPositionIdByNameTx(
    tx: TenantTx,
    companyId: string,
    name: string,
  ): Promise<string | undefined> {
    const [row] = await tx
      .select({ id: positions.id })
      .from(positions)
      .where(
        and(
          eq(positions.companyId, companyId),
          eq(positions.name, name),
          eq(positions.status, "active"),
          isNull(positions.deletedAt),
        ),
      )
      .limit(1);
    return row?.id;
  }

  async findJobLevelIdByNameTx(
    tx: TenantTx,
    companyId: string,
    name: string,
  ): Promise<string | undefined> {
    const [row] = await tx
      .select({ id: jobLevels.id })
      .from(jobLevels)
      .where(
        and(
          eq(jobLevels.companyId, companyId),
          eq(jobLevels.name, name),
          eq(jobLevels.status, "active"),
          isNull(jobLevels.deletedAt),
        ),
      )
      .limit(1);
    return row?.id;
  }

  async findContractTypeIdByNameTx(
    tx: TenantTx,
    companyId: string,
    name: string,
  ): Promise<string | undefined> {
    const [row] = await tx
      .select({ id: contractTypes.id })
      .from(contractTypes)
      .where(
        and(
          eq(contractTypes.companyId, companyId),
          eq(contractTypes.name, name),
          eq(contractTypes.status, "active"),
          isNull(contractTypes.deletedAt),
        ),
      )
      .limit(1);
    return row?.id;
  }

  /**
   * True when a NON-soft-deleted employee already carries this code — matching the scope of the partial
   * unique index `employee_profiles_company_code_active_uq` (WHERE deleted_at IS NULL AND employee_code IS
   * NOT NULL), the DB backstop. Includes resigned/terminated (they are not soft-deleted).
   */
  async employeeCodeInUseTx(tx: TenantTx, companyId: string, code: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.employeeCode, code),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** True when the email already belongs to a non-deleted user (dup-check only — import never provisions). */
  async userEmailExistsTx(tx: TenantTx, companyId: string, email: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * APPEND-ONLY (BẤT BIẾN #2) session-summary audit for an apply run. Written directly (not via
   * AuditService) ONLY because the caller needs the generated id back for the response, and the payload is
   * pure run metadata — {fileName, ok, fail} carries NO salary/identity/PII/secret (BẤT BIẾN #3). company_id
   * is filled by the column DEFAULT current_setting under withTenant. object_type must be 'employee_import'
   * (mig 0496 UNION-added it to audit_logs_object_type_chk + AUDIT_OBJECT_TYPES).
   */
  async insertSessionAuditTx(
    tx: TenantTx,
    entry: { actorUserId: string; fileName: string; ok: number; fail: number },
  ): Promise<string> {
    const [row] = await tx
      .insert(auditLogs)
      .values({
        action: "import",
        objectType: "employee_import",
        actorUserId: entry.actorUserId,
        before: null,
        after: { fileName: entry.fileName, ok: entry.ok, fail: entry.fail },
        moduleCode: "HR",
        entityType: "employee_import",
        actionGroup: "IMPORT",
        resultStatus: "Success",
        permissionCode: "HR.EMPLOYEE.IMPORT",
      })
      .returning({ id: auditLogs.id });
    return row.id;
  }
}
