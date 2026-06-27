import { Injectable } from "@nestjs/common";
import { and, eq, ilike, isNull, ne, or, type SQL } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import {
  employeeManagerRelations,
  employeeProfiles,
  orgUnits,
  positions,
  users,
  type User,
} from "../db/schema";

/** Columns returned by the flat list projection. */
const LIST_COLUMNS = {
  id: employeeProfiles.id,
  userId: employeeProfiles.userId,
  employeeCode: employeeProfiles.employeeCode,
  userFullName: users.fullName,
  userEmail: users.email,
  orgUnitId: employeeProfiles.orgUnitId,
  orgUnitName: orgUnits.name,
  positionId: employeeProfiles.positionId,
  positionName: positions.name,
  workType: employeeProfiles.workType,
  employmentType: employeeProfiles.employmentType,
  status: employeeProfiles.status,
  baseSalary: employeeProfiles.baseSalary,
} as const;

/** Columns returned by the single-record detail projection. */
const DETAIL_COLUMNS = {
  id: employeeProfiles.id,
  companyId: employeeProfiles.companyId,
  userId: employeeProfiles.userId,
  employeeCode: employeeProfiles.employeeCode,
  orgUnitId: employeeProfiles.orgUnitId,
  orgUnitName: orgUnits.name,
  positionId: employeeProfiles.positionId,
  positionName: positions.name,
  directManagerId: employeeProfiles.directManagerId,
  workType: employeeProfiles.workType,
  employmentType: employeeProfiles.employmentType,
  startDate: employeeProfiles.startDate,
  endDate: employeeProfiles.endDate,
  contractType: employeeProfiles.contractType,
  baseSalary: employeeProfiles.baseSalary,
  salaryType: employeeProfiles.salaryType,
  phone: employeeProfiles.phone,
  avatarUrl: employeeProfiles.avatarUrl,
  notes: employeeProfiles.notes,
  status: employeeProfiles.status,
  userFullName: users.fullName,
  userEmail: users.email,
  createdAt: employeeProfiles.createdAt,
  updatedAt: employeeProfiles.updatedAt,
} as const;

export interface EmployeeListFilters {
  orgUnitId?: string;
  positionId?: string;
  status?: string;
  search?: string;
}

export interface EmployeeInsertData {
  userId: string;
  employeeCode?: string | null;
  orgUnitId?: string | null;
  positionId?: string | null;
  directManagerId?: string | null;
  workType?: string;
  employmentType?: string;
  startDate?: string | null;
  contractType?: string | null;
  baseSalary?: string | null;
  salaryType?: string;
  phone?: string | null;
  avatarUrl?: string | null;
  notes?: string | null;
}

export type EmployeeUpdateData = Partial<{
  employeeCode: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  directManagerId: string | null;
  workType: string;
  employmentType: string;
  startDate: string | null;
  endDate: string | null;
  contractType: string | null;
  baseSalary: string | null;
  salaryType: string;
  phone: string | null;
  avatarUrl: string | null;
  notes: string | null;
  status: string;
}>;

export interface BulkEmployeeRow {
  userId: string;
  employeeCode?: string;
  orgUnitId?: string;
  positionId?: string;
  workType?: string;
  employmentType?: string;
  startDate?: string;
}

@Injectable()
export class EmployeesRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── List (tx core — read + per-item salary audit share one tenant tx) ──────────

  // async + awaited so the Promise boundary is explicit: a dropped `await` at the call site would
  // otherwise yield a query-builder object, and the service's reveal loop would silently mask all rows.
  //
  // S2-HR-EMP-LEGACY-LOCK-1: `scopeCond` is the DataScopeService predicate (Own/Team/Department/…),
  // ANDed with the tenant guard + soft-delete + filters so a caller never lists rows outside their
  // scope (closes the legacy unscoped-read IDOR). null = no extra scope (kept for back-compat callers).
  async listEmployeesTx(
    tx: TenantTx,
    companyId: string,
    filters: EmployeeListFilters,
    scopeCond?: SQL | null,
  ) {
    const conditions = [
      eq(employeeProfiles.companyId, companyId),
      isNull(employeeProfiles.deletedAt),
    ];
    if (scopeCond) conditions.push(scopeCond);
    if (filters.orgUnitId) conditions.push(eq(employeeProfiles.orgUnitId, filters.orgUnitId));
    if (filters.positionId) conditions.push(eq(employeeProfiles.positionId, filters.positionId));
    if (filters.status) conditions.push(eq(employeeProfiles.status, filters.status));
    if (filters.search) {
      const term = `%${filters.search}%`;
      const fuzzy = or(
        ilike(users.fullName, term),
        ilike(users.email, term),
        ilike(employeeProfiles.employeeCode, term),
      );
      if (fuzzy) conditions.push(fuzzy);
    }

    return await tx
      .select(LIST_COLUMNS)
      .from(employeeProfiles)
      .innerJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
      .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
      .orderBy(users.fullName);
  }

  // ── Detail (tx core — read inside the caller's tenant tx for atomic audit) ─────

  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select(DETAIL_COLUMNS)
      .from(employeeProfiles)
      .innerJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
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

  // ── Create / update (tx cores) ─────────────────────────────────────────────────

  createEmployeeTx(tx: TenantTx, companyId: string, data: EmployeeInsertData) {
    return tx
      .insert(employeeProfiles)
      .values({ companyId, ...data })
      .returning();
  }

  updateEmployeeTx(tx: TenantTx, companyId: string, id: string, data: EmployeeUpdateData) {
    return tx
      .update(employeeProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, id),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .returning();
  }

  softDeleteEmployee(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(employeeProfiles)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(employeeProfiles.companyId, companyId),
            eq(employeeProfiles.id, id),
            isNull(employeeProfiles.deletedAt),
          ),
        )
        .returning(),
    );
  }

  // ── Login account (F7 — create users row when none supplied) ───────────────────

  /**
   * S2-INT-1 — a linkable user: exists in THIS tenant and is not soft-deleted. A cross-tenant userId
   * resolves to undefined (RLS + explicit company_id) so the caller 404s instead of FK-linking across
   * tenants (the FK alone does not check company_id).
   */
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
   * S2-INT-1 — the ACTIVE employee profile linked to `userId` (excluding `exceptId` when given) to
   * enforce "1 user ↔ ≤1 active employee" before a link. The partial unique index is the DB backstop.
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

  async createUserTx(
    tx: TenantTx,
    companyId: string,
    data: { email: string; fullName: string; passwordHash: string; createdBy: string },
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

  // ── Employee ↔ manager relations (F5 — keep EMR consistent) ────────────────────

  /** Soft-delete every active direct_manager relation for an employee (singular relation). */
  softDeleteDirectManagerEmrTx(tx: TenantTx, companyId: string, employeeUserId: string) {
    return tx
      .update(employeeManagerRelations)
      .set({ deletedAt: new Date(), status: "inactive", updatedAt: new Date() })
      .where(
        and(
          eq(employeeManagerRelations.companyId, companyId),
          eq(employeeManagerRelations.employeeUserId, employeeUserId),
          eq(employeeManagerRelations.relationType, "direct_manager"),
          isNull(employeeManagerRelations.deletedAt),
        ),
      )
      .returning();
  }

  insertDirectManagerEmrTx(
    tx: TenantTx,
    companyId: string,
    employeeUserId: string,
    managerUserId: string,
  ) {
    return tx
      .insert(employeeManagerRelations)
      .values({
        companyId,
        employeeUserId,
        managerUserId,
        relationType: "direct_manager",
        status: "active",
      })
      .returning();
  }

  // ── Import lookups (tx cores — re-validate at confirm time inside one tx) ───────

  async findUserByEmailTx(tx: TenantTx, companyId: string, email: string) {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  async findOrgUnitByNameTx(tx: TenantTx, companyId: string, name: string) {
    const [row] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(eq(orgUnits.companyId, companyId), eq(orgUnits.name, name), isNull(orgUnits.deletedAt)),
      )
      .limit(1);
    return row;
  }

  async findPositionByNameTx(tx: TenantTx, companyId: string, name: string) {
    const [row] = await tx
      .select({ id: positions.id })
      .from(positions)
      .where(
        and(
          eq(positions.companyId, companyId),
          eq(positions.name, name),
          isNull(positions.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  bulkCreateEmployeesTx(tx: TenantTx, companyId: string, rows: BulkEmployeeRow[]) {
    // Defence-in-depth: Drizzle `.values([])` throws. The service guards too, but guard here as well
    // so a future direct caller gets an empty result, not an opaque builder error.
    if (rows.length === 0) return Promise.resolve([] as { id: string }[]);
    return tx
      .insert(employeeProfiles)
      .values(rows.map((r) => ({ companyId, ...r })))
      .returning({ id: employeeProfiles.id });
  }
}
