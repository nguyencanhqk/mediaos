import { Injectable } from "@nestjs/common";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles, jobLevels, orgUnits, positions, users } from "../db/schema";
import type { OrgChartRow } from "./hr-org-chart.service";

/**
 * S5-HR-ORGCHART-BE-1 — read-only repo for the employee org-chart. SELECTs ONLY directory-class columns
 * (BẤT BIẾN #3): no salary/PII/identity/contact ever enters memory via this path. Runs inside the caller's
 * tenant tx (withTenant → RLS+FORCE); ANDs the externally-supplied scope predicate + company_id + soft-delete
 * + status='active' so the tree is exactly the active subset of what the scoped list would return.
 */
@Injectable()
export class HrOrgChartRepository {
  async listScopedActiveTx(
    tx: TenantTx,
    companyId: string,
    scopeCond: SQL,
  ): Promise<OrgChartRow[]> {
    const rows = await tx
      .select({
        employeeId: employeeProfiles.id,
        userId: employeeProfiles.userId,
        // direct_manager_id references users.id — the tree link only (NEVER emitted in the node DTO).
        directManagerId: employeeProfiles.directManagerId,
        displayName: users.fullName,
        positionName: positions.name,
        orgUnitName: orgUnits.name,
        jobLevelName: jobLevels.name,
        avatarUrl: employeeProfiles.avatarUrl,
        employeeCode: employeeProfiles.employeeCode,
      })
      .from(employeeProfiles)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(jobLevels, eq(employeeProfiles.jobLevelId, jobLevels.id))
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
          eq(employeeProfiles.status, "active"),
          scopeCond,
        ),
      );
    return rows as OrgChartRow[];
  }
}
