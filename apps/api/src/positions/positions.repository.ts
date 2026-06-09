import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import { orgUnits, positions, roles } from '../db/schema';

@Injectable()
export class PositionsRepository {
  constructor(private readonly db: DatabaseService) {}

  listPositions(companyId: string, orgUnitId?: string) {
    return this.db.withTenant(companyId, (tx) => {
      const where = orgUnitId
        ? and(
            eq(positions.companyId, companyId),
            eq(positions.orgUnitId, orgUnitId),
            isNull(positions.deletedAt),
          )
        : and(eq(positions.companyId, companyId), isNull(positions.deletedAt));

      return tx
        .select({
          id: positions.id,
          companyId: positions.companyId,
          orgUnitId: positions.orgUnitId,
          orgUnitName: orgUnits.name,
          name: positions.name,
          code: positions.code,
          level: positions.level,
          description: positions.description,
          defaultRoleId: positions.defaultRoleId,
          defaultRoleName: roles.name,
          status: positions.status,
          createdAt: positions.createdAt,
          updatedAt: positions.updatedAt,
        })
        .from(positions)
        .leftJoin(orgUnits, eq(positions.orgUnitId, orgUnits.id))
        .leftJoin(roles, eq(positions.defaultRoleId, roles.id))
        .where(where)
        .orderBy(positions.name);
    });
  }

  findById(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: positions.id,
          companyId: positions.companyId,
          orgUnitId: positions.orgUnitId,
          orgUnitName: orgUnits.name,
          name: positions.name,
          code: positions.code,
          level: positions.level,
          description: positions.description,
          defaultRoleId: positions.defaultRoleId,
          defaultRoleName: roles.name,
          status: positions.status,
          createdAt: positions.createdAt,
          updatedAt: positions.updatedAt,
        })
        .from(positions)
        .leftJoin(orgUnits, eq(positions.orgUnitId, orgUnits.id))
        .leftJoin(roles, eq(positions.defaultRoleId, roles.id))
        .where(and(eq(positions.companyId, companyId), eq(positions.id, id), isNull(positions.deletedAt)))
        .limit(1),
    );
  }

  createPosition(
    companyId: string,
    data: {
      name: string;
      code?: string | null;
      orgUnitId?: string | null;
      level?: number | null;
      description?: string | null;
      defaultRoleId?: string | null;
    },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(positions)
        .values({ companyId, ...data })
        .returning(),
    );
  }

  updatePosition(
    companyId: string,
    id: string,
    data: Partial<{
      name: string;
      code: string | null;
      orgUnitId: string | null;
      level: number | null;
      description: string | null;
      defaultRoleId: string | null;
      status: string;
    }>,
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(positions)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(positions.companyId, companyId), eq(positions.id, id), isNull(positions.deletedAt)))
        .returning(),
    );
  }

  softDeletePosition(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(positions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(positions.companyId, companyId), eq(positions.id, id), isNull(positions.deletedAt)))
        .returning(),
    );
  }
}
