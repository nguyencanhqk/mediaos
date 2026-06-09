import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService, type TenantTx } from '../db/db.service';
import { orgUnits, positions, roles } from '../db/schema';

@Injectable()
export class PositionsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Chạy `fn` trong tenant tx: dùng `tx` có sẵn (do Service mở để gói write + audit nguyên tử),
   * hoặc tự mở `withTenant` khi gọi lẻ. Tránh nested transaction.
   */
  private run<T>(companyId: string, fn: (tx: TenantTx) => Promise<T>, tx?: TenantTx): Promise<T> {
    return tx ? fn(tx) : this.db.withTenant(companyId, fn);
  }

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

  findById(companyId: string, id: string, tx?: TenantTx) {
    return this.run(companyId, (t) =>
      t
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
      tx,
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
    tx?: TenantTx,
  ) {
    return this.run(
      companyId,
      (t) =>
        t
          .insert(positions)
          .values({ companyId, ...data })
          .returning(),
      tx,
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
    tx?: TenantTx,
  ) {
    return this.run(
      companyId,
      (t) =>
        t
          .update(positions)
          .set({ ...data, updatedAt: new Date() })
          .where(and(eq(positions.companyId, companyId), eq(positions.id, id), isNull(positions.deletedAt)))
          .returning(),
      tx,
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
