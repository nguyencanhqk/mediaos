import { Injectable } from "@nestjs/common";
import { and, desc, eq, getTableColumns, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import {
  assetAssignments,
  assetCategories,
  assets,
  type AssetAssignment,
} from "../db/schema/assets";
import { employeeProfiles } from "../db/schema/employees";
import { users } from "../db/schema/users";
import { fromScope, identityColumns } from "../permission/identity-projection";
import type { AssetActorScope, PageInput } from "./assets.types";
import { toOffset } from "./assets.types";

export type AssetAssignmentRow = AssetAssignment & {
  employeeCode: string | null;
  employeeFullName: string | null;
  holderVisible: boolean;
};

/** Hàng `/me/assets` — lượt của CHÍNH employee + tài sản + loại. CỐ Ý KHÔNG SELECT trường tài chính (SPEC-13 §18). */
export interface MeAssetRow {
  assignmentId: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  assetStatus: string;
  serialNumber: string | null;
  assignedAt: Date;
  issueCondition: string | null;
  expectedReturnDate: string | null;
  assignmentStatus: string;
  returnedAt: Date | null;
  returnCondition: string | null;
}

/**
 * S11-ASSET-BE-1 — persistence `asset_assignments` (DB-15 §6.3 — SỔ: app SELECT/INSERT + UPDATE cấp cột
 * `status·returned_*·return_*·updated_*`, KHÔNG DELETE, KHÔNG deleted_at).
 *
 * `returnActiveTx` là câu quyết định ASSET-ERR-003 (review B6): `UPDATE … WHERE status='Active' RETURNING` —
 * 0 hàng ⇒ không có lượt Active. Chốt cuối "1 Active/tài sản" = `uq_asset_assignments_active` (23505 → 001).
 *
 * ĐIỂM CHIẾU DANH TÍNH: `listByAssetTx` chiếu `users.fullName` của người nhận qua `identityColumns` với CÙNG
 * `holderVisibleCond` của actor, đồng thời LỌC HÀNG bằng chính vị từ đó (Own: chỉ hàng của caller · Department:
 * chỉ nhân viên trong đơn vị) — basis "scoped-predicate", 1 dòng ở `identity-projection-verdicts.ts`.
 */
@Injectable()
export class AssetAssignmentsRepository {
  async findActiveTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
  ): Promise<AssetAssignment | undefined> {
    const [row] = await tx
      .select()
      .from(assetAssignments)
      .where(
        and(
          eq(assetAssignments.companyId, companyId),
          eq(assetAssignments.assetId, assetId),
          eq(assetAssignments.status, "Active"),
        ),
      )
      .limit(1);
    return row;
  }

  async insertActiveTx(
    tx: TenantTx,
    companyId: string,
    v: {
      assetId: string;
      employeeId: string;
      assignedBy: string;
      issueCondition: string | null;
      issueNote: string | null;
      expectedReturnDate: string | null;
    },
  ): Promise<AssetAssignment> {
    const [row] = await tx
      .insert(assetAssignments)
      .values({
        companyId,
        assetId: v.assetId,
        employeeId: v.employeeId,
        assignedBy: v.assignedBy,
        issueCondition: v.issueCondition,
        issueNote: v.issueNote,
        expectedReturnDate: v.expectedReturnDate,
        status: "Active",
        updatedBy: v.assignedBy,
      })
      .returning();
    if (!row) throw new Error("insertActiveTx: INSERT asset_assignments trả về 0 row");
    return row;
  }

  /** MỘT câu UPDATE đủ cột `chk_asset_assignments_return_pair`; 0 hàng ⇒ ASSET-ERR-003. */
  async returnActiveTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
    v: { returnCondition: string; returnNote: string | null; userId: string },
  ): Promise<AssetAssignment | undefined> {
    const [row] = await tx
      .update(assetAssignments)
      .set({
        status: "Returned",
        returnedAt: sql`now()`,
        returnedBy: v.userId,
        returnCondition: v.returnCondition,
        returnNote: v.returnNote,
        updatedAt: sql`now()`,
        updatedBy: v.userId,
      })
      .where(
        and(
          eq(assetAssignments.companyId, companyId),
          eq(assetAssignments.assetId, assetId),
          eq(assetAssignments.status, "Active"),
        ),
      )
      .returning();
    return row;
  }

  private rowScope(companyId: string, actor: AssetActorScope): SQL[] {
    if (actor.scope === "Company" || actor.scope === "System") return [];
    if (actor.scope === "Department") {
      return actor.deptOrgUnitIds.length > 0
        ? [inArray(employeeProfiles.orgUnitId, actor.deptOrgUnitIds)]
        : [sql`false`];
    }
    return [eq(employeeProfiles.userId, actor.actorUserId)];
  }

  /** Lịch sử cấp phát của 1 tài sản (012) — lọc HÀNG theo scope + chiếu tên qua identityColumns. */
  async listByAssetTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
    page: PageInput,
    actor: AssetActorScope,
  ): Promise<{ rows: AssetAssignmentRow[]; total: number }> {
    const grant = fromScope(
      actor.holderVisibleCond,
      "scoped-predicate",
      "S11-ASSET-BE-1 §13.6 — lịch sử cấp phát: Own chỉ hàng của caller · Department chỉ nhân viên trong đơn vị.",
      users.id,
    );
    const conds = [
      eq(assetAssignments.companyId, companyId),
      eq(assetAssignments.assetId, assetId),
      ...this.rowScope(companyId, actor),
    ];
    const base = () =>
      tx
        .select({
          ...getTableColumns(assetAssignments),
          employeeCode: employeeProfiles.employeeCode,
          ...identityColumns(grant, { employeeFullName: users.fullName }, "holderVisible"),
        })
        .from(assetAssignments)
        .innerJoin(
          employeeProfiles,
          and(
            eq(employeeProfiles.id, assetAssignments.employeeId),
            eq(employeeProfiles.companyId, companyId),
            isNull(employeeProfiles.deletedAt),
          ),
        )
        .leftJoin(
          users,
          and(eq(users.id, employeeProfiles.userId), eq(users.companyId, companyId)),
        );
    const rows = await base()
      .where(and(...conds))
      .orderBy(desc(assetAssignments.assignedAt), desc(assetAssignments.id))
      .limit(page.perPage)
      .offset(toOffset(page));
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assetAssignments)
      .innerJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, assetAssignments.employeeId),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(and(...conds));
    return { rows: rows as AssetAssignmentRow[], total: cnt?.n ?? 0 };
  }

  /** `counts.assignments` của chi tiết — đếm trên tập ĐÃ LỌC scope (API-14 §7.1). */
  async countByAssetScopedTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
    actor: AssetActorScope,
  ): Promise<number> {
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assetAssignments)
      .innerJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, assetAssignments.employeeId),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(
        and(
          eq(assetAssignments.companyId, companyId),
          eq(assetAssignments.assetId, assetId),
          ...this.rowScope(companyId, actor),
        ),
      );
    return cnt?.n ?? 0;
  }

  /** `/me/assets` (023) — employee LUÔN từ token. KHÔNG SELECT purchase_price/supplier. */
  async listMineTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    includeReturned: boolean,
    page: PageInput,
  ): Promise<{ rows: MeAssetRow[]; total: number }> {
    const conds = [
      eq(assetAssignments.companyId, companyId),
      eq(assetAssignments.employeeId, employeeId),
    ];
    if (!includeReturned) conds.push(eq(assetAssignments.status, "Active"));
    const rows = await tx
      .select({
        assignmentId: assetAssignments.id,
        assetId: assets.id,
        assetCode: assets.assetCode,
        assetName: assets.name,
        categoryId: assetCategories.id,
        categoryCode: assetCategories.code,
        categoryName: assetCategories.name,
        assetStatus: assets.status,
        serialNumber: assets.serialNumber,
        assignedAt: assetAssignments.assignedAt,
        issueCondition: assetAssignments.issueCondition,
        expectedReturnDate: assetAssignments.expectedReturnDate,
        assignmentStatus: assetAssignments.status,
        returnedAt: assetAssignments.returnedAt,
        returnCondition: assetAssignments.returnCondition,
      })
      .from(assetAssignments)
      .innerJoin(
        assets,
        and(eq(assets.id, assetAssignments.assetId), eq(assets.companyId, companyId)),
      )
      .innerJoin(
        assetCategories,
        and(eq(assetCategories.id, assets.categoryId), eq(assetCategories.companyId, companyId)),
      )
      .where(and(...conds))
      .orderBy(desc(assetAssignments.assignedAt), desc(assetAssignments.id))
      .limit(page.perPage)
      .offset(toOffset(page));
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assetAssignments)
      .where(and(...conds));
    return { rows, total: cnt?.n ?? 0 };
  }

  /** user_id của người giữ lượt (cho NOTI) — KHÔNG lọc scope (đường máy). */
  async holderUserIdOfAssignmentTx(
    tx: TenantTx,
    companyId: string,
    assignmentId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ userId: employeeProfiles.userId })
      .from(assetAssignments)
      .innerJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, assetAssignments.employeeId),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(and(eq(assetAssignments.companyId, companyId), eq(assetAssignments.id, assignmentId)))
      .limit(1);
    return row?.userId ?? null;
  }
}
