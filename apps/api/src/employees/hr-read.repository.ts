import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { HrEmployeeSortField } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import {
  contractTypes,
  employeeCodeConfigs,
  employeeProfiles,
  jobLevels,
  orgUnits,
  positions,
  users,
} from "../db/schema";

/**
 * S2-HR-BE-1 — read-only repository for the HR read core. Every method runs inside the caller's
 * tenant tx (withTenant → RLS+FORCE), and the list query ANDs an externally-supplied scope predicate
 * (from DataScopeService) so the caller only ever sees their permitted rows (BẤT BIẾN #1).
 *
 * It SELECTs only — no UPDATE/DELETE — except the salary audit INSERT which the service owns.
 */

const LIST_COLUMNS = {
  id: employeeProfiles.id,
  userId: employeeProfiles.userId,
  employeeCode: employeeProfiles.employeeCode,
  fullName: users.fullName,
  email: users.email,
  orgUnitId: employeeProfiles.orgUnitId,
  orgUnitName: orgUnits.name,
  positionId: employeeProfiles.positionId,
  positionName: positions.name,
  workType: employeeProfiles.workType,
  employmentType: employeeProfiles.employmentType,
  status: employeeProfiles.status,
  // HR-PROFILE-UI-1: directory columns (non-gated).
  avatarUrl: employeeProfiles.avatarUrl,
  startDate: employeeProfiles.startDate,
  // HR-PROFILE-UI-1b (mig 0489): directory-class.
  officialDate: employeeProfiles.officialDate,
  workLocation: employeeProfiles.workLocation,
  // HR-PROFILE-UI-1: PII columns — raw here; the SERVICE masks them per view-sensitive grant.
  gender: employeeProfiles.gender,
  dateOfBirth: employeeProfiles.dateOfBirth,
  phone: employeeProfiles.phone,
  contractType: employeeProfiles.contractType,
  baseSalary: employeeProfiles.baseSalary,
} as const;

const DETAIL_COLUMNS = {
  id: employeeProfiles.id,
  companyId: employeeProfiles.companyId,
  userId: employeeProfiles.userId,
  employeeCode: employeeProfiles.employeeCode,
  fullName: users.fullName,
  email: users.email,
  orgUnitId: employeeProfiles.orgUnitId,
  orgUnitName: orgUnits.name,
  positionId: employeeProfiles.positionId,
  positionName: positions.name,
  directManagerId: employeeProfiles.directManagerId,
  // directManagerId references users.id → this IS the manager's user id (for Team in-scope check).
  directManagerUserId: employeeProfiles.directManagerId,
  workType: employeeProfiles.workType,
  employmentType: employeeProfiles.employmentType,
  startDate: employeeProfiles.startDate,
  endDate: employeeProfiles.endDate,
  status: employeeProfiles.status,
  // HR-PROFILE-UI-1: directory column (non-gated).
  avatarUrl: employeeProfiles.avatarUrl,
  baseSalary: employeeProfiles.baseSalary,
  salaryType: employeeProfiles.salaryType,
  phone: employeeProfiles.phone,
  contractType: employeeProfiles.contractType,
  notes: employeeProfiles.notes,
  // HR-PROFILE-UI-1: personal-info PII (mig 0451) — raw here; the SERVICE masks per view-sensitive.
  // identity_* (CCCD, §14.18) is intentionally NOT selected — it must never reach a read DTO.
  gender: employeeProfiles.gender,
  dateOfBirth: employeeProfiles.dateOfBirth,
  maritalStatus: employeeProfiles.maritalStatus,
  personalEmail: employeeProfiles.personalEmail,
  currentAddress: employeeProfiles.currentAddress,
  permanentAddress: employeeProfiles.permanentAddress,
  emergencyContactName: employeeProfiles.emergencyContactName,
  emergencyContactPhone: employeeProfiles.emergencyContactPhone,
  // HR-PROFILE-UI-1b (mig 0489, hybrid): 3 directory + MST/blob nhân khẩu (PII — service masks).
  officialDate: employeeProfiles.officialDate,
  probationEndDate: employeeProfiles.probationEndDate,
  workLocation: employeeProfiles.workLocation,
  taxCode: employeeProfiles.taxCode,
  personalExtra: employeeProfiles.personalExtra,
  createdAt: employeeProfiles.createdAt,
  updatedAt: employeeProfiles.updatedAt,
} as const;

/** Raw list row (baseSalary still the DB numeric string — the service masks/parses it). */
export interface HrListRow {
  id: string;
  // S2-HR-BE-2: LEFT JOIN users → these are null for an unlinked (userId IS NULL) employee.
  userId: string | null;
  employeeCode: string | null;
  fullName: string | null;
  email: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  positionId: string | null;
  positionName: string | null;
  workType: string | null;
  employmentType: string | null;
  status: string;
  avatarUrl: string | null;
  startDate: string | null;
  officialDate: string | null;
  workLocation: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  contractType: string | null;
  baseSalary: string | null;
}

/** Raw detail row (sensitive fields still raw — the service masks them per permission). */
export interface HrDetailRow {
  id: string;
  companyId: string;
  // S2-HR-BE-2: LEFT JOIN users → null for an unlinked employee.
  userId: string | null;
  employeeCode: string | null;
  fullName: string | null;
  email: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  positionId: string | null;
  positionName: string | null;
  directManagerId: string | null;
  directManagerUserId: string | null;
  workType: string | null;
  employmentType: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  avatarUrl: string | null;
  baseSalary: string | null;
  salaryType: string | null;
  phone: string | null;
  contractType: string | null;
  notes: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  maritalStatus: string | null;
  personalEmail: string | null;
  currentAddress: string | null;
  permanentAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  officialDate: string | null;
  probationEndDate: string | null;
  workLocation: string | null;
  taxCode: string | null;
  personalExtra: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

/** HR-PROFILE-UI-1 — raw aggregate rows for GET /hr/employees/summary (service maps to records). */
export interface HrSummaryRows {
  byStatus: { status: string; count: number }[];
  byEmploymentType: { employmentType: string | null; count: number }[];
  byGender: { gender: string | null; count: number }[];
}

export interface HrListFilters {
  search?: string;
  orgUnitId?: string;
  positionId?: string;
  status?: string;
  sort: HrEmployeeSortField;
  order: "asc" | "desc";
  /** 1-based page number (already clamped by the DTO). */
  page: number;
  pageSize: number;
}

/**
 * HR-PROFILE-UI-2 — export filter shape (same FILTER fields as the list, but NO page/pageSize: the export
 * is a single capped pull, not a page). sort/order are resolved to a concrete default by the service.
 */
export interface HrExportFilters {
  search?: string;
  orgUnitId?: string;
  positionId?: string;
  status?: string;
  sort: HrEmployeeSortField;
  order: "asc" | "desc";
}

/**
 * Allowlist mapping the DTO sort key → the concrete column (blocks ORDER BY injection). Keys MUST match
 * HR_EMPLOYEE_SORT_FIELDS 1-1 (the contract enum is the guard; this map is the concrete binding). A
 * `Record<HrEmployeeSortField, …>` type-fails at build if a new sort field lacks a column here.
 * HR-PROFILE-UI-2: +startDate/+officialDate (directory-class join-date columns, mig 0489).
 */
const SORT_COLUMNS: Record<HrEmployeeSortField, PgColumn> = {
  fullName: users.fullName,
  employeeCode: employeeProfiles.employeeCode,
  status: employeeProfiles.status,
  createdAt: employeeProfiles.createdAt,
  startDate: employeeProfiles.startDate,
  officialDate: employeeProfiles.officialDate,
} as const;

@Injectable()
export class HrReadRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Scoped + paginated list. `scopeCond` is the DataScopeService predicate (Own/Team/Department/…);
   * it is ANDed with the tenant guard + soft-delete + filters so a row outside the caller's scope is
   * never returned. Returns the page rows + the total matching count (for pagination meta).
   */
  /**
   * Build the shared WHERE for the scoped list/export: tenant guard + soft-delete + the caller's scope
   * predicate + the optional filters (org/position/status/search). ONE source of truth so the export
   * returns exactly the rows the list would, minus pagination (BẤT BIẾN #1: company_id is always ANDed).
   */
  private buildScopedWhere(
    companyId: string,
    scopeCond: SQL,
    filters: { search?: string; orgUnitId?: string; positionId?: string; status?: string },
  ): SQL {
    const conditions: SQL[] = [
      eq(employeeProfiles.companyId, companyId),
      isNull(employeeProfiles.deletedAt),
      scopeCond,
    ];
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
    return and(...conditions) as SQL;
  }

  async listScopedTx(
    tx: TenantTx,
    companyId: string,
    scopeCond: SQL,
    filters: HrListFilters,
  ): Promise<{ rows: HrListRow[]; total: number }> {
    const where = this.buildScopedWhere(companyId, scopeCond, filters);
    const sortCol = SORT_COLUMNS[filters.sort];
    const direction = filters.order === "desc" ? desc : asc;
    const offset = (filters.page - 1) * filters.pageSize;

    const rows = await tx
      .select(LIST_COLUMNS)
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
      .where(where)
      .orderBy(direction(sortCol))
      .limit(filters.pageSize)
      .offset(offset);

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .where(where);

    return { rows: rows as HrListRow[], total: Number(count) };
  }

  /**
   * HR-PROFILE-UI-2 — scoped rows for the CSV export. Same WHERE as the list (tenant + soft-delete +
   * scope + filters), NO pagination — the service asks for `limit` = MAX+1 rows so it can detect over-cap
   * without a second COUNT and reject (422) BEFORE serialize (never a truncated file). The sort is fully
   * DETERMINISTIC: the allowlisted column then `id` as a stable tiebreaker (identical inputs → identical
   * byte order across runs). SORT_COLUMNS is an allowlist keyed by the contract enum — no raw ORDER BY.
   */
  async listScopedForExportTx(
    tx: TenantTx,
    companyId: string,
    scopeCond: SQL,
    filters: HrExportFilters,
    limit: number,
  ): Promise<HrListRow[]> {
    const where = this.buildScopedWhere(companyId, scopeCond, filters);
    const sortCol = SORT_COLUMNS[filters.sort];
    const direction = filters.order === "desc" ? desc : asc;

    const rows = await tx
      .select(LIST_COLUMNS)
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
      .where(where)
      .orderBy(direction(sortCol), asc(employeeProfiles.id))
      .limit(limit);

    return rows as HrListRow[];
  }

  /** Single employee by profile id (tenant-scoped). companyId/directManagerUserId surfaced for in-scope. */
  async findByIdTx(tx: TenantTx, companyId: string, id: string): Promise<HrDetailRow | undefined> {
    const [row] = await tx
      .select(DETAIL_COLUMNS)
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
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
    return row as HrDetailRow | undefined;
  }

  /** The profile linked to a specific login user (for GET /hr/me/profile). Self lookup, NOT scope-based. */
  async findByUserIdTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<HrDetailRow | undefined> {
    const [row] = await tx
      .select(DETAIL_COLUMNS)
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row as HrDetailRow | undefined;
  }

  /**
   * HR-PROFILE-UI-1 — aggregate headcount for the overview strip. Same predicate shape as the list
   * (tenant + soft-delete + the caller's scope condition), so the numbers NEVER exceed what the list
   * itself would return. LEFT JOIN users mirrors the list count query (the scope predicate may
   * reference users columns). Raw group-by rows out; the service buckets/masks them.
   */
  async summaryScopedTx(tx: TenantTx, companyId: string, scopeCond: SQL): Promise<HrSummaryRows> {
    const where = and(
      eq(employeeProfiles.companyId, companyId),
      isNull(employeeProfiles.deletedAt),
      scopeCond,
    );
    const activeWhere = and(where, eq(employeeProfiles.status, "active"));
    const count = sql<number>`cast(count(*) as int)`;

    const byStatus = await tx
      .select({ status: employeeProfiles.status, count })
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .where(where)
      .groupBy(employeeProfiles.status);

    const byEmploymentType = await tx
      .select({ employmentType: employeeProfiles.employmentType, count })
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .where(activeWhere)
      .groupBy(employeeProfiles.employmentType);

    const byGender = await tx
      .select({ gender: employeeProfiles.gender, count })
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .where(activeWhere)
      .groupBy(employeeProfiles.gender);

    return { byStatus, byEmploymentType, byGender };
  }

  // ── Lookups (active reference data; never carry sensitive fields) ───────────────

  listDepartmentsTx(tx: TenantTx, companyId: string) {
    return tx
      .select({
        id: orgUnits.id,
        name: orgUnits.name,
        code: orgUnits.code,
        parentId: orgUnits.parentId,
      })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.companyId, companyId),
          eq(orgUnits.status, "active"),
          isNull(orgUnits.deletedAt),
        ),
      )
      .orderBy(asc(orgUnits.name));
  }

  listPositionsTx(tx: TenantTx, companyId: string) {
    return tx
      .select({ id: positions.id, name: positions.name, code: positions.code })
      .from(positions)
      .where(
        and(
          eq(positions.companyId, companyId),
          eq(positions.status, "active"),
          isNull(positions.deletedAt),
        ),
      )
      .orderBy(asc(positions.name));
  }

  listJobLevelsTx(tx: TenantTx, companyId: string) {
    return tx
      .select({
        id: jobLevels.id,
        name: jobLevels.name,
        code: jobLevels.code,
        rankOrder: jobLevels.rankOrder,
      })
      .from(jobLevels)
      .where(
        and(
          eq(jobLevels.companyId, companyId),
          eq(jobLevels.status, "active"),
          isNull(jobLevels.deletedAt),
        ),
      )
      .orderBy(asc(jobLevels.rankOrder), asc(jobLevels.name));
  }

  listContractTypesTx(tx: TenantTx, companyId: string) {
    return tx
      .select({
        id: contractTypes.id,
        name: contractTypes.name,
        code: contractTypes.code,
        requiresEndDate: contractTypes.requiresEndDate,
      })
      .from(contractTypes)
      .where(
        and(
          eq(contractTypes.companyId, companyId),
          eq(contractTypes.status, "active"),
          isNull(contractTypes.deletedAt),
        ),
      )
      .orderBy(asc(contractTypes.name));
  }

  /** The active employee-code config (format only — allocation is a separate write path). */
  async getEmployeeCodeConfigTx(tx: TenantTx, companyId: string) {
    const [row] = await tx
      .select({
        prefix: employeeCodeConfigs.prefix,
        pattern: employeeCodeConfigs.pattern,
        numberLength: employeeCodeConfigs.numberLength,
      })
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
}
