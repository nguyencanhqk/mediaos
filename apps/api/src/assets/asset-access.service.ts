import { Injectable } from "@nestjs/common";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { users } from "../db/schema/users";
import { DataScopeService } from "../permission/data-scope.service";
import { identityColumns, selfBound } from "../permission/identity-projection";
import type { AssetActorScope, AssetRequestUser } from "./assets.types";

interface EmployeeRefRow {
  id: string;
  status: string;
  orgUnitId: string | null;
  userId: string | null;
}

/**
 * S11-ASSET-BE-1 — AssetAccessService: TOÀN BỘ lớp phạm vi ĐỌC + masking của module ASSET (SPEC-13 §13.6/§18,
 * permission-matrix §9d). Mirror `GoalAccessService` NHƯNG:
 *
 *   • NGOÀI scope ⇒ **404** (ASSET-ERR-012/013), KHÔNG 403 như GOAL — vị từ scope đi THẲNG vào `WHERE` của
 *     câu SELECT chi tiết, nên 0 hàng đã gộp chung "không thuộc tenant" và "ngoài scope" (chống dò tồn tại).
 *   • KHÔNG có `assertWriteAllowed`/`assertWriteTarget`: 9 cặp ghi của ASSET chỉ được cấp `@Company` (0550) —
 *     copy khuôn ghi Own/Department của GOAL sang đây là dead code nguy hiểm (plan §11).
 *
 * Own/Team = tài sản có lượt (Active HOẶC Returned) của employee của tôi — "lịch sử của tôi" (DB-15 §8), nên
 * người giữ CŨ vẫn ở scope Own của tài sản đó mãi ⇒ danh tính người giữ HIỆN TẠI phải che riêng
 * (`holderVisibleCond`). Department = lượt ACTIVE của nhân viên đơn vị mình ∪ đơn vị mình làm trưởng.
 * `Team` (quản lý trực tiếp) không có định nghĩa ở §9d ⇒ FAIL-CLOSED về Own (không nới).
 *
 * ⚠️ Vị từ EXISTS viết bằng định danh chữ `assets.id`/`assets.company_id` (bảng chính KHÔNG alias) — không
 * nội suy cột typed vào subquery tương quan (memory `drizzle-sql-template-renders-columns-unqualified`).
 * BẮT BUỘC `EXISTS`, cấm JOIN `asset_assignments` vào danh sách (Own gồm cả Returned ⇒ nhân bản hàng).
 */
@Injectable()
export class AssetAccessService {
  constructor(private readonly dataScope: DataScopeService) {}

  /** Gate cặp ghi: 403 khi thiếu grant (defense-in-depth trùng PermissionGuard — service còn gọi được từ job). */
  async assertCan(user: AssetRequestUser, action: string, resourceType: string): Promise<void> {
    await this.dataScope.resolveAndAssert(user.id, user.companyId, action, resourceType);
  }

  /** `('manage','asset-category')` có hay không — KHÔNG ném (dùng cho `includeDeleted`, API-14 001). */
  async canManageCategories(user: AssetRequestUser): Promise<boolean> {
    const scope = await this.dataScope.resolveOrNull(
      user.id,
      user.companyId,
      "manage",
      "asset-category",
    );
    return scope !== null;
  }

  async resolveActorScope(tx: TenantTx, user: AssetRequestUser): Promise<AssetActorScope> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "view", "asset");
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const actorEmp = await this.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    const deptOrgUnitIds =
      scope === "Department"
        ? [...new Set([...(ctx.orgUnitId ? [ctx.orgUnitId] : []), ...(ctx.headedOrgUnitIds ?? [])])]
        : [];
    const isCompany = scope === "Company" || scope === "System";
    const base: AssetActorScope = {
      scope,
      actorUserId: user.id,
      actorEmployeeId: actorEmp?.id ?? null,
      deptOrgUnitIds,
      holderVisibleCond: this.buildHolderVisibleCond(scope, user.id, deptOrgUnitIds),
      showFinancial: isCompany,
      isCompanyScope: isCompany,
    };
    if (isCompany) return base;
    return { ...base, readScopeExists: this.buildReadScopeExists(scope, user, deptOrgUnitIds) };
  }

  /**
   * Vị từ EXISTS trên `assets` (không alias). Own/Team: có BẤT KỲ lượt của employee của caller; Department: có
   * lượt ACTIVE mà employee thuộc `deptOrgUnitIds` (rỗng ⇒ `false`, không bao giờ match-all).
   */
  buildReadScopeExists(scope: string, user: AssetRequestUser, deptOrgUnitIds: string[]): SQL {
    const companyId = user.companyId;
    if (scope === "Department") {
      if (deptOrgUnitIds.length === 0) return sql`false`;
      return sql`exists (
        select 1 from asset_assignments aa
          join employee_profiles ep
            on ep.id = aa.employee_id and ep.company_id = ${companyId} and ep.deleted_at is null
         where aa.company_id = ${companyId}
           and aa.asset_id = assets.id
           and aa.status = 'Active'
           and ep.org_unit_id in ${deptOrgUnitIds}
      )`;
    }
    // Own (và Team fail-closed về Own)
    return sql`exists (
      select 1 from asset_assignments aa
        join employee_profiles ep
          on ep.id = aa.employee_id and ep.company_id = ${companyId} and ep.deleted_at is null
       where aa.company_id = ${companyId}
         and aa.asset_id = assets.id
         and ep.user_id = ${user.id}
    )`;
  }

  /**
   * Vị từ cho `identityColumns` trên JOIN `users` (người giữ hiện tại): Company ⇒ true; Department ⇒ employee
   * thuộc đơn vị; Own/Team ⇒ chính caller. Dùng CHUNG cho cả cờ `holderVisible` lẫn cột `holderFullName`.
   */
  buildHolderVisibleCond(scope: string, actorUserId: string, deptOrgUnitIds: string[]): SQL {
    if (scope === "Company" || scope === "System") return sql`true`;
    if (scope === "Department") {
      return deptOrgUnitIds.length > 0
        ? inArray(employeeProfiles.orgUnitId, deptOrgUnitIds)
        : sql`false`;
    }
    return eq(users.id, actorUserId);
  }

  /** Hồ sơ nhân viên ACTIVE của user trong company (chuẩn GOAL `findActiveEmployeeByUserTx`). */
  async findActiveEmployeeByUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<EmployeeRefRow | undefined> {
    const res = await tx.execute(sql`
      select id, user_id as "userId", status, org_unit_id as "orgUnitId"
        from employee_profiles
       where company_id = ${companyId} and user_id = ${userId}
         and status = 'active' and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as EmployeeRefRow[])[0];
  }

  /** Hồ sơ nhân viên (mọi status, chưa xoá) — cho `/me/assets` (nghỉ việc vẫn xem được lịch sử của mình). */
  async findEmployeeByUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<EmployeeRefRow | undefined> {
    const res = await tx.execute(sql`
      select id, user_id as "userId", status, org_unit_id as "orgUnitId"
        from employee_profiles
       where company_id = ${companyId} and user_id = ${userId} and deleted_at is null
       order by (status = 'active') desc, created_at desc
       limit 1
    `);
    return (res.rows as unknown as EmployeeRefRow[])[0];
  }

  /** Employee theo id trong company (cho cấp phát — ASSET-ERR-002: 404 không có · 422 không active). */
  async findEmployeeByIdTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeRefRow | undefined> {
    const res = await tx.execute(sql`
      select id, user_id as "userId", status, org_unit_id as "orgUnitId"
        from employee_profiles
       where company_id = ${companyId} and id = ${employeeId} and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as EmployeeRefRow[])[0];
  }

  /**
   * Tên hiển thị của CHÍNH actor cho payload NOTI. Chiếu `users.fullName` qua `identityColumns` với căn cứ
   * `selfBound(actor)` (hàng = chính chủ) — KHÔNG raw SQL (vùng mù `rawSqlIdentity` đã pin, không nới).
   */
  async findUserDisplayNameTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<string | null> {
    const grant = selfBound(
      userId,
      users.id,
      "S11-ASSET-BE-1 — tên actor cho payload NOTI: hàng = chính chủ.",
    );
    const [row] = await tx
      .select({ ...identityColumns(grant, { fullName: users.fullName }) })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .limit(1);
    return row?.fullName ?? null;
  }
}
