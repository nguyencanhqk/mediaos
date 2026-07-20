import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { employeeProfiles, orgUnits } from "../db/schema";

/**
 * S2-HR-BE-3 — HR department repository.
 * Wraps org_units table with HR-specific department semantics.
 * Every query runs inside withTenant (BẤT BIẾN #1 — company_id ở mọi query).
 */
@Injectable()
export class HrDepartmentRepository {
  constructor(private readonly db: DatabaseService) {}

  private run<T>(companyId: string, fn: (tx: TenantTx) => Promise<T>, tx?: TenantTx): Promise<T> {
    return tx ? fn(tx) : this.db.withTenant(companyId, fn);
  }

  listDepartments(companyId: string, status?: string) {
    return this.db.withTenant(companyId, (tx) => {
      const base = and(eq(orgUnits.companyId, companyId), isNull(orgUnits.deletedAt));
      const where = status ? and(base, eq(orgUnits.status, status)) : base;
      return tx
        .select({
          id: orgUnits.id,
          companyId: orgUnits.companyId,
          parentId: orgUnits.parentId,
          name: orgUnits.name,
          code: orgUnits.code,
          description: orgUnits.description,
          headUserId: orgUnits.headUserId,
          status: orgUnits.status,
          createdAt: orgUnits.createdAt,
          updatedAt: orgUnits.updatedAt,
        })
        .from(orgUnits)
        .where(where)
        .orderBy(orgUnits.name);
    });
  }

  findDepartmentById(companyId: string, id: string, tx?: TenantTx) {
    return this.run(
      companyId,
      (t) =>
        t
          .select({
            id: orgUnits.id,
            companyId: orgUnits.companyId,
            parentId: orgUnits.parentId,
            name: orgUnits.name,
            code: orgUnits.code,
            description: orgUnits.description,
            headUserId: orgUnits.headUserId,
            status: orgUnits.status,
            createdAt: orgUnits.createdAt,
            updatedAt: orgUnits.updatedAt,
          })
          .from(orgUnits)
          .where(
            and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, id), isNull(orgUnits.deletedAt)),
          )
          .limit(1),
      tx,
    );
  }

  /**
   * Ứng viên trưởng phòng — đọc employee trong CÙNG company (RLS + company_id, BẤT BIẾN #1) để
   * service validate active + resolve user liên kết (DB-03: manager_employee_id phải là employee
   * active cùng company; cột lưu hiện là org_units.head_user_id FK users nên cần user_id).
   */
  findManagerCandidate(companyId: string, employeeId: string, tx?: TenantTx) {
    return this.run(
      companyId,
      (t) =>
        t
          .select({
            id: employeeProfiles.id,
            userId: employeeProfiles.userId,
            status: employeeProfiles.status,
          })
          .from(employeeProfiles)
          .where(
            and(
              eq(employeeProfiles.companyId, companyId),
              eq(employeeProfiles.id, employeeId),
              isNull(employeeProfiles.deletedAt),
            ),
          )
          .limit(1),
      tx,
    );
  }

  createDepartment(
    companyId: string,
    data: {
      name: string;
      code?: string | null;
      parentId?: string | null;
      headUserId?: string | null;
      description?: string | null;
      status?: string;
    },
    tx?: TenantTx,
  ) {
    return this.run(
      companyId,
      (t) =>
        t
          .insert(orgUnits)
          .values({
            companyId,
            name: data.name,
            type: "department",
            code: data.code ?? null,
            parentId: data.parentId ?? null,
            headUserId: data.headUserId ?? null,
            description: data.description ?? null,
            status: data.status ?? "active",
          })
          .returning(),
      tx,
    );
  }

  updateDepartment(
    companyId: string,
    id: string,
    data: Partial<{
      name: string;
      code: string | null;
      parentId: string | null;
      headUserId: string | null;
      description: string | null;
      status: string;
    }>,
    tx?: TenantTx,
  ) {
    return this.run(
      companyId,
      (t) =>
        t
          .update(orgUnits)
          .set({ ...data, updatedAt: new Date() })
          .where(
            and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, id), isNull(orgUnits.deletedAt)),
          )
          .returning(),
      tx,
    );
  }

  softDeleteDepartment(companyId: string, id: string, tx?: TenantTx) {
    return this.run(
      companyId,
      (t) =>
        t
          .update(orgUnits)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, id), isNull(orgUnits.deletedAt)),
          )
          .returning(),
      tx,
    );
  }

  /**
   * Trả về id của tất cả org_unit nằm trên cây cha của `childId` (không tính chính nó).
   * Dùng để kiểm tra chu trình: nếu proposed parentId nằm trong ancestors của childId → cycle.
   * Thực hiện bằng cách đi theo parent_id liên tục (tối đa 50 bước để tránh vòng lặp vô hạn).
   */
  async getAncestors(companyId: string, childId: string): Promise<string[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const ancestors: string[] = [];
      let currentId: string | null = childId;
      const visited = new Set<string>();

      while (currentId) {
        if (visited.has(currentId)) break; // safety: already-broken cycle in data
        visited.add(currentId);

        const rows = await tx
          .select({ parentId: orgUnits.parentId })
          .from(orgUnits)
          .where(
            and(
              eq(orgUnits.companyId, companyId),
              eq(orgUnits.id, currentId),
              isNull(orgUnits.deletedAt),
            ),
          )
          .limit(1);

        if (!rows[0]) break;
        currentId = rows[0].parentId ?? null;
        if (currentId) ancestors.push(currentId);
        if (ancestors.length > 50) break; // guard for deeply nested trees
      }

      return ancestors;
    });
  }
}
