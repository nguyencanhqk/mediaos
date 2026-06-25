import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { employeeProfiles } from "../db/schema";

/**
 * S2-AUTH-BE-2 — read-only port the data-scope resolver uses to learn the REQUESTER's HR context
 * (currently just their org_unit for Department scope).
 *
 * GUARDRAIL (plan-review #8): imports the `employee_profiles` SCHEMA TABLE only — never an HR Nest
 * module/service. HR-BE-1 depends_on BE-2, so importing EmployeesModule would create a DI cycle.
 * A plain Drizzle table import has no module wiring → no cycle. The richer manager tree
 * (employee_manager_relations / org-unit head / multi-level) is wired later by S2-INT-2.
 */
@Injectable()
export class DataScopeRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The requester's own org_unit (for Department scope). Read inside withTenant → RLS-scoped to companyId.
   * Returns null when the user has no active employee profile (e.g. a console/admin account) → Department
   * scope then resolves fail-closed to 0 rows.
   */
  async getRequesterOrgUnitId(userId: string, companyId: string): Promise<string | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({ orgUnitId: employeeProfiles.orgUnitId })
        .from(employeeProfiles)
        .where(and(eq(employeeProfiles.userId, userId), isNull(employeeProfiles.deletedAt)))
        .limit(1);
      return rows[0]?.orgUnitId ?? null;
    });
  }
}
