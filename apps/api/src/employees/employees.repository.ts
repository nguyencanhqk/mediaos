import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import { employeeProfiles, orgUnits, positions, users } from '../db/schema';

@Injectable()
export class EmployeesRepository {
  constructor(private readonly db: DatabaseService) {}

  listEmployees(
    companyId: string,
    filters: { orgUnitId?: string; positionId?: string; status?: string },
  ) {
    return this.db.withTenant(companyId, (tx) => {
      const conditions = [eq(employeeProfiles.companyId, companyId), isNull(employeeProfiles.deletedAt)];
      if (filters.orgUnitId) conditions.push(eq(employeeProfiles.orgUnitId, filters.orgUnitId));
      if (filters.positionId) conditions.push(eq(employeeProfiles.positionId, filters.positionId));
      if (filters.status) conditions.push(eq(employeeProfiles.status, filters.status));

      return tx
        .select({
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
        })
        .from(employeeProfiles)
        .innerJoin(users, eq(employeeProfiles.userId, users.id))
        .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
        .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
        .where(and(...(conditions as [typeof conditions[0], ...typeof conditions])))
        .orderBy(users.fullName);
    });
  }

  findById(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
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
        })
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
        .limit(1),
    );
  }

  createEmployee(
    companyId: string,
    data: {
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
    },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx.insert(employeeProfiles).values({ companyId, ...data }).returning(),
    );
  }

  updateEmployee(
    companyId: string,
    id: string,
    data: Partial<{
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
    }>,
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(employeeProfiles)
        .set({ ...data, updatedAt: new Date() })
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

  findOrgUnitByName(companyId: string, name: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.companyId, companyId), eq(orgUnits.name, name), isNull(orgUnits.deletedAt)))
        .limit(1),
    );
  }

  findPositionByName(companyId: string, name: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({ id: positions.id })
        .from(positions)
        .where(and(eq(positions.companyId, companyId), eq(positions.name, name), isNull(positions.deletedAt)))
        .limit(1),
    );
  }

  findUserByEmail(companyId: string, email: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.companyId, companyId), eq(users.email, email), isNull(users.deletedAt)))
        .limit(1),
    );
  }

  bulkCreateEmployees(
    companyId: string,
    rows: Array<{
      userId: string;
      employeeCode?: string;
      orgUnitId?: string;
      positionId?: string;
      workType?: string;
      employmentType?: string;
      startDate?: string;
    }>,
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx.insert(employeeProfiles).values(rows.map((r) => ({ companyId, ...r }))).returning(),
    );
  }
}
