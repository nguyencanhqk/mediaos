import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { employeeManagerRelations, employeeProfiles, orgUnits } from "../db/schema";

/**
 * The requester's resolved HR scope context — everything the data-scope rules need to know about
 * WHO the caller is in the org (S2-INT-2). All three sets are read together so Team/Department
 * resolve from the SAME consistent snapshot.
 */
export interface RequesterScopeData {
  /** The requester's own org_unit (Department = same unit). null when they have no active profile. */
  orgUnitId: string | null;
  /**
   * users.id of every employee the requester ACTIVELY manages via employee_manager_relations —
   * the multi-manager set (direct_manager mirror + project/professional/temporary manager). Drives
   * Team scope beyond the single direct_manager_id shortcut column.
   */
  managedUserIds: string[];
  /** org_units the requester HEADS (org_units.head_user_id) — drives Department over a headed unit. */
  headedOrgUnitIds: string[];
}

/**
 * S2-AUTH-BE-2 / S2-INT-2 — read-only port the data-scope resolver uses to learn the REQUESTER's HR
 * context (own org_unit for Department, the EMR-managed set for Team, headed org_units for Department).
 *
 * GUARDRAIL (plan-review #8): imports the `employee_profiles` / `employee_manager_relations` /
 * `org_units` SCHEMA TABLES only — never an HR Nest module/service. HR-BE-1 depends_on BE-2, so
 * importing EmployeesModule would create a DI cycle; a plain Drizzle table import has no module wiring.
 */
@Injectable()
export class DataScopeRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Resolve the requester's full HR scope context. Read inside one withTenant → RLS-scoped to companyId
   * and read FRESH on every call (never cached) so a direct_manager / EMR / org-unit-head change is
   * reflected on the very next request (S2-INT-2 done_when #2: no stale scope). When the caller has no
   * active employee profile (e.g. a console/admin account) orgUnitId is null and the managed/headed sets
   * are whatever the EMR / org_units rows say — Department then fail-closes to 0 rows unless they head a unit.
   */
  async getRequesterScopeContext(userId: string, companyId: string): Promise<RequesterScopeData> {
    return this.db.withTenant(companyId, async (tx) => {
      const profileRows = await tx
        .select({ orgUnitId: employeeProfiles.orgUnitId })
        .from(employeeProfiles)
        .where(and(eq(employeeProfiles.userId, userId), isNull(employeeProfiles.deletedAt)))
        .limit(1);

      const managedRows = await tx
        .select({ employeeUserId: employeeManagerRelations.employeeUserId })
        .from(employeeManagerRelations)
        .where(
          and(
            eq(employeeManagerRelations.managerUserId, userId),
            eq(employeeManagerRelations.status, "active"),
            isNull(employeeManagerRelations.deletedAt),
          ),
        );

      const headedRows = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.headUserId, userId),
            eq(orgUnits.status, "active"),
            isNull(orgUnits.deletedAt),
          ),
        );

      // dedupe managed ids: a single employee may have >1 active relation (e.g. direct + project manager).
      const managedUserIds = [...new Set(managedRows.map((r) => r.employeeUserId))];

      return {
        orgUnitId: profileRows[0]?.orgUnitId ?? null,
        managedUserIds,
        headedOrgUnitIds: headedRows.map((r) => r.id),
      };
    });
  }
}
