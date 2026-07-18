import { Injectable } from "@nestjs/common";
import { and, eq, isNull, ne } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import {
  contractTypes,
  employeeCodeConfigs,
  employeeManagerRelations,
  employeeProfiles,
  employeeStatusHistories,
  jobLevels,
  orgUnits,
  positions,
  users,
  type User,
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

/**
 * HR-PROFILE-UI-1b — PATCH-only fields. DIRECTORY = audit giá trị bình thường; PERSONAL/PII = service
 * gate view-sensitive per-row + audit CHỈ tên field (giá trị mask). identity_* / bank_* vẫn cấm.
 */
export interface EmployeeDirectoryPatch {
  officialDate?: string | null;
  probationEndDate?: string | null;
  workLocation?: string | null;
}

export interface EmployeePersonalPatch {
  gender?: string | null;
  dateOfBirth?: string | null;
  maritalStatus?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  currentAddress?: string | null;
  permanentAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  taxCode?: string | null;
  personalExtra?: Record<string, string> | null;
}

export type EmployeeUpdateData = Partial<Omit<EmployeeWriteData, "userId">> &
  EmployeeDirectoryPatch &
  EmployeePersonalPatch;

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
        // HR-PROFILE-UI-1b: directory patch fields (giá trị vào audit bình thường).
        officialDate: employeeProfiles.officialDate,
        probationEndDate: employeeProfiles.probationEndDate,
        workLocation: employeeProfiles.workLocation,
        // HR-PROFILE-UI-1b: PII before-values — CHỈ để diff phát hiện thay đổi trong service;
        // TUYỆT ĐỐI không vào audit (diffPii mask giá trị, structuralSnapshot không allowlist chúng).
        gender: employeeProfiles.gender,
        dateOfBirth: employeeProfiles.dateOfBirth,
        maritalStatus: employeeProfiles.maritalStatus,
        personalEmail: employeeProfiles.personalEmail,
        phone: employeeProfiles.phone,
        currentAddress: employeeProfiles.currentAddress,
        permanentAddress: employeeProfiles.permanentAddress,
        emergencyContactName: employeeProfiles.emergencyContactName,
        emergencyContactPhone: employeeProfiles.emergencyContactPhone,
        taxCode: employeeProfiles.taxCode,
        personalExtra: employeeProfiles.personalExtra,
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

  /**
   * S2-FND-SEED-2 — the tenant's non-deleted employee_code_config row (prefix/numberLength/status),
   * REGARDLESS of status (allocateEmployeeCode's ensure-on-miss needs the REAL row to mirror status too —
   * an Inactive config must produce an Inactive counter, never silently Active). undefined ⇒ genuinely
   * unconfigured — the caller MUST NOT fabricate defaults (CẤM hard-code EMP/4, see HR-BE-2 note).
   */
  async findEmployeeCodeConfigTx(tx: TenantTx, companyId: string) {
    const [row] = await tx
      .select({
        prefix: employeeCodeConfigs.prefix,
        numberLength: employeeCodeConfigs.numberLength,
        status: employeeCodeConfigs.status,
      })
      .from(employeeCodeConfigs)
      .where(
        and(eq(employeeCodeConfigs.companyId, companyId), isNull(employeeCodeConfigs.deletedAt)),
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

  /**
   * S5-ME-BE-2 — self-service avatar (mirror `findForUpdateTx` nhưng AND thêm `userId` = token-resolved
   * ngay trong WHERE, own-scope thuần chống IDOR — CHỈ employee liên kết CHÍNH user mới match). `.for("update")`
   * khoá row để tránh race 2 request PATCH avatar song song cùng user.
   */
  async findOwnAvatarForUpdateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    userId: string,
  ): Promise<{ id: string; avatarUrl: string | null } | undefined> {
    const [row] = await tx
      .select({ id: employeeProfiles.id, avatarUrl: employeeProfiles.avatarUrl })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, id),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * S5-HR-AVATAR-1 — HR-managed avatar (mirror `findOwnAvatarForUpdateTx` NHƯNG KHÔNG AND `userId`: HR đổi
   * avatar của NV BẤT KỲ trong tenant — authorize ĐÃ ép ở `HrEmployeeAvatarService.assertWriteScope`
   * (Company/System fail-closed, mirror HrWriteService) TRƯỚC khi gọi). `.for("update")` khoá row — chống
   * race employee tự đổi ‖ HR đổi đồng thời (plan-review #1/#2: NGUYÊN TỬ 1 tx). company + isNull(deletedAt)
   * guard tenant + soft-delete (BẤT BIẾN #1/#2). undefined → 404 (employee không tồn tại/cross-tenant/xoá).
   */
  async findForAvatarUpdateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<{ id: string; avatarUrl: string | null } | undefined> {
    const [row] = await tx
      .select({ id: employeeProfiles.id, avatarUrl: employeeProfiles.avatarUrl })
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

  /** S5-ME-BE-2 — ghi `avatar_url` (lưu `fileId` — xem me-avatar.service.ts docstring). Own-scope ép ở caller. */
  async updateAvatarUrlTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    avatarUrl: string | null,
  ): Promise<void> {
    await tx
      .update(employeeProfiles)
      .set({ avatarUrl, updatedAt: new Date() })
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
   * "1 user ↔ ≤1 active employee" before a link. `exceptId=null` (create path: no existing row to
   * exclude) checks ALL active links. The partial unique index is the DB backstop either way.
   */
  async findActiveByUserIdTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    exceptId: string | null,
  ): Promise<{ id: string } | undefined> {
    const conds = [
      eq(employeeProfiles.companyId, companyId),
      eq(employeeProfiles.userId, userId),
      isNull(employeeProfiles.deletedAt),
    ];
    if (exceptId !== null) conds.push(ne(employeeProfiles.id, exceptId));
    const [row] = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(and(...conds))
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

  /**
   * Provision a login account for a new employee. Returns the FULL row so the caller can write a
   * `user.created` audit via `authUserSnapshot` (S2-INT-1) — keep the returned row OUT of any response
   * or log (it carries password_hash); only `authUserSnapshot` is allowed to read it.
   */
  async createUserTx(
    tx: TenantTx,
    companyId: string,
    data: { email: string; fullName: string | null; passwordHash: string; createdBy: string },
  ): Promise<User> {
    const [row] = await tx
      .insert(users)
      .values({
        companyId,
        email: data.email,
        fullName: data.fullName,
        passwordHash: data.passwordHash,
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
      })
      .returning();
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

  async jobLevelActiveTx(tx: TenantTx, companyId: string, id: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: jobLevels.id })
      .from(jobLevels)
      .where(
        and(
          eq(jobLevels.companyId, companyId),
          eq(jobLevels.id, id),
          eq(jobLevels.status, "active"),
          isNull(jobLevels.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async contractTypeActiveTx(tx: TenantTx, companyId: string, id: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: contractTypes.id })
      .from(contractTypes)
      .where(
        and(
          eq(contractTypes.companyId, companyId),
          eq(contractTypes.id, id),
          eq(contractTypes.status, "active"),
          isNull(contractTypes.deletedAt),
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
