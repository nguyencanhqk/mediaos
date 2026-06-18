import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { DatabaseService, type TenantTx } from '../db/db.service';
import { employeeProfiles, orgUnits, positions, users } from '../db/schema';

/** Columns projected for soft-deleted employee rows in the recycle bin. */
const DELETED_COLUMNS = {
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
  deletedAt: employeeProfiles.deletedAt,
} as const;

@Injectable()
export class RecycleBinRepository {
  constructor(private readonly db: DatabaseService) {}

  /** List all soft-deleted employee profiles for the given tenant (deletedAt IS NOT NULL). */
  async listDeletedEmployeesTx(tx: TenantTx, companyId: string) {
    return await tx
      .select(DELETED_COLUMNS)
      .from(employeeProfiles)
      .innerJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          isNotNull(employeeProfiles.deletedAt),
        ),
      )
      .orderBy(employeeProfiles.deletedAt);
  }

  /** Restore a soft-deleted employee (set deletedAt = NULL). Returns the updated row or undefined. */
  async restoreEmployeeTx(tx: TenantTx, id: string, companyId: string) {
    const [row] = await tx
      .update(employeeProfiles)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, id),
          isNotNull(employeeProfiles.deletedAt),
        ),
      )
      .returning({ id: employeeProfiles.id });
    return row;
  }
}
