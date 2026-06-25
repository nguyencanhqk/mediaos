import { Injectable } from "@nestjs/common";
import { and, eq, isNull, ne } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import {
  employeeCodeConfigs,
  employeeManagerRelations,
  employeeProfiles,
  employeeStatusHistories,
  orgUnits,
  positions,
  users,
} from "../db/schema";

/**
 * S2-HR-BE-2 — write-core repository for the HR employee surface. Every method runs inside the caller's
 * tenant tx (`withTenant` → RLS+FORCE); each WHERE also ANDs `eq(company_id)` (belt+suspenders, BẤT BIẾN #1).
 * No hard-delete (BẤT BIẾN #2): status history is INSERT-only; profiles soft-delete elsewhere.
 *
 * Structural fields only — baseSalary/PII are NOT written here (handled by the sensitive/legacy path).
 */

export interface EmployeeWriteData {
  userId: string | null;
  employeeCode: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  jobLevelId: string | null;
  contractTypeId: string | null;
  directManagerId: string | null;
  workType: string;
  employmentType: string;
  salaryType: string;
  startDate: string | null;
  endDate: string | null;
}

export type EmployeeUpdateData = Partial<Omit<EmployeeWriteData, "userId">>;

/** Minimal row the service needs to gate status/link transitions (read under FOR UPDATE). */
export interface EmployeeStateRow {
  id: string;
  companyId: string;
  userId: string | null;
  status: string;
}

@Injectable()
export class HrWriteRepository {
  /** Lock the employee row FOR UPDATE so concurrent status/link changes serialize. */
  async findForUpdateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<EmployeeStateRow | undefined> {
    const [row] = await tx
      .select({
        id: employeeProfiles.id,
        companyId: employeeProfiles.companyId,
        userId: employeeProfiles.userId,
        status: employeeProfiles.status,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, id),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    return row;
  }

  /** Current structural (allowlist) values — for building the update audit before/changed_fields. */
  async findStructuralByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    const [row] = await tx
      .select({
        userId: employeeProfiles.userId,
        employeeCode: employeeProfiles.employeeCode,
        orgUnitId: employeeProfiles.orgUnitId,
        positionId: employeeProfiles.positionId,
        jobLevelId: employeeProfiles.jobLevelId,
        contractTypeId: employeeProfiles.contractTypeId,
        directManagerId: employeeProfiles.directManagerId,
        workType: employeeProfiles.workType,
        employmentType: employeeProfiles.employmentType,
        salaryType: employeeProfiles.salaryType,
        startDate: employeeProfiles.startDate,
        endDate: employeeProfiles.endDate,
        status: employeeProfiles.status,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, id),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** The active employee-code config (format only). null → no config → manual override permissive. */
  async getActiveEmployeeCodeConfigTx(tx: TenantTx, companyId: string) {
    const [row] = await tx
      .select({ allowManualOverride: employeeCodeConfigs.allowManualOverride })
      .from(employeeCodeConfigs)
      .where(
        and(
          eq(employeeCodeConfigs.companyId, companyId),
          eq(employeeCodeConfigs.status, "active"),
          isNull(employeeCodeConfigs.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  async createTx(tx: TenantTx, companyId: string, data: EmployeeWriteData) {
    const [row] = await tx
      .insert(employeeProfiles)
      .values({ companyId, ...data })
      .returning({ id: employeeProfiles.id, employeeCode: employeeProfiles.employeeCode });
    return row;
  }

  async updateTx(tx: TenantTx, companyId: string, id: string, data: EmployeeUpdateData) {
    const [row] = await tx
      .update(employeeProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, id),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .returning({ id: employeeProfiles.id });
    return row;
  }

  async setStatusTx(tx: TenantTx, companyId: string, id: string, status: string) {
    await tx
      .update(employeeProfiles)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(employeeProfiles.companyId, companyId), eq(employeeProfiles.id, id)));
  }

  async setUserIdTx(tx: TenantTx, companyId: string, id: string, userId: string | null) {
    await tx
      .update(employeeProfiles)
      .set({ userId, updatedAt: new Date() })
      .where(and(eq(employeeProfiles.companyId, companyId), eq(employeeProfiles.id, id)));
  }

  /** APPEND-ONLY (BẤT BIẾN #2) — one row per status change, same tx as the status UPDATE. */
  async insertStatusHistoryTx(
    tx: TenantTx,
    companyId: string,
    entry: {
      employeeId: string;
      oldStatus: string | null;
      newStatus: string;
      reason: string | null;
      changedBy: string;
    },
  ) {
    await tx.insert(employeeStatusHistories).values({ companyId, ...entry });
  }

  /**
   * The ACTIVE employee profile linked to `userId`, excluding `exceptId` — used to enforce
   * "1 user ↔ ≤1 active employee" before a link. The partial unique index is the DB backstop.
   */
  async findActiveByUserIdTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    exceptId: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          ne(employeeProfiles.id, exceptId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** A linkable user: exists in this tenant and is not soft-deleted. */
  async findLinkableUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  async createUserTx(
    tx: TenantTx,
    companyId: string,
    data: { email: string; fullName: string | null; passwordHash: string },
  ) {
    const [row] = await tx
      .insert(users)
      .values({
        companyId,
        email: data.email,
        fullName: data.fullName,
        passwordHash: data.passwordHash,
      })
      .returning({ id: users.id });
    return row;
  }

  /** Lock a user account: status='suspended' (users_status_chk) + lockedAt/Reason. No session revoke here. */
  async lockUserTx(tx: TenantTx, companyId: string, userId: string, reason: string) {
    await tx
      .update(users)
      .set({
        status: "suspended",
        lockedAt: new Date(),
        lockedReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(users.companyId, companyId), eq(users.id, userId), isNull(users.deletedAt)));
  }

  // ── Reference validation (active + same tenant) ────────────────────────────────

  async orgUnitActiveTx(tx: TenantTx, companyId: string, id: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.companyId, companyId),
          eq(orgUnits.id, id),
          eq(orgUnits.status, "active"),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async positionActiveTx(tx: TenantTx, companyId: string, id: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: positions.id })
      .from(positions)
      .where(
        and(
          eq(positions.companyId, companyId),
          eq(positions.id, id),
          eq(positions.status, "active"),
          isNull(positions.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  // ── direct_manager ↔ employee_manager_relations (mirror legacy F5) ──────────────

  async softDeleteDirectManagerEmrTx(tx: TenantTx, companyId: string, employeeUserId: string) {
    await tx
      .update(employeeManagerRelations)
      .set({ deletedAt: new Date(), status: "inactive", updatedAt: new Date() })
      .where(
        and(
          eq(employeeManagerRelations.companyId, companyId),
          eq(employeeManagerRelations.employeeUserId, employeeUserId),
          eq(employeeManagerRelations.relationType, "direct_manager"),
          isNull(employeeManagerRelations.deletedAt),
        ),
      );
  }

  async insertDirectManagerEmrTx(
    tx: TenantTx,
    companyId: string,
    employeeUserId: string,
    managerUserId: string,
  ) {
    await tx.insert(employeeManagerRelations).values({
      companyId,
      employeeUserId,
      managerUserId,
      relationType: "direct_manager",
      status: "active",
    });
  }
}
