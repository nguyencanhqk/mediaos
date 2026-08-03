import { Injectable } from "@nestjs/common";
import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { employeeProfiles, orgUnits, positions, users } from "../db/schema";

/**
 * S6-SEC-IDENTITYBOUND-1 (N-1d, KI-051) — cột chiếu cho hồ sơ đã xoá mềm.
 *
 * Vế NGHIỆP VỤ (mã NV · phòng ban · vị trí · ngày xoá) trả theo `read:employee`. Hai cột DANH TÍNH
 * NGƯỜI bị buộc bởi `showIdentity` — vị từ scope của cặp danh bạ `view:user`, đúng cặp mà
 * `/org/employees`, `/auth/users`, `/org/teams/:id/members` đã dùng.
 *
 * VÌ SAO khử ở tầng SQL (`case when`) chứ không chỉ xoá khoá ở service: nếu phiên sau ai đó quên
 * bước xoá khoá thì hàng ngoài scope trả `null` thay vì rò email im lặng — chọn chế độ hỏng ồn ào
 * có chủ đích (cùng lý do đã ghi ở `org.repository.listTeamMembers`).
 */
const deletedColumns = (showIdentity: SQL) =>
  ({
    id: employeeProfiles.id,
    userId: employeeProfiles.userId,
    employeeCode: employeeProfiles.employeeCode,
    identityInScope: sql<boolean>`(${showIdentity})`,
    userFullName: sql<
      string | null
    >`case when (${showIdentity}) then ${users.fullName} else null end`,
    userEmail: sql<string | null>`case when (${showIdentity}) then ${users.email} else null end`,
    orgUnitId: employeeProfiles.orgUnitId,
    orgUnitName: orgUnits.name,
    positionId: employeeProfiles.positionId,
    positionName: positions.name,
    workType: employeeProfiles.workType,
    employmentType: employeeProfiles.employmentType,
    status: employeeProfiles.status,
    deletedAt: employeeProfiles.deletedAt,
  }) as const;

@Injectable()
export class RecycleBinRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * List all soft-deleted employee profiles for the given tenant (deletedAt IS NOT NULL).
   *
   * `identityCond = null` ⇒ actor không có grant danh bạ nào ⇒ **không hàng nào** được chiếu danh tính.
   */
  async listDeletedEmployeesTx(tx: TenantTx, companyId: string, identityCond: SQL | null) {
    const showIdentity = identityCond ?? sql`false`;
    return await tx
      .select(deletedColumns(showIdentity))
      .from(employeeProfiles)
      .innerJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .leftJoin(positions, eq(employeeProfiles.positionId, positions.id))
      .where(and(eq(employeeProfiles.companyId, companyId), isNotNull(employeeProfiles.deletedAt)))
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
      // S7-CHAT-BE-5 (W13): + `user_id` để caller đồng bộ phòng chat mà không phải query lại. Thêm cột
      // vào `.returning()` KHÔNG đổi câu UPDATE; body HTTP cũng không đổi vì service chiếu lại `{id}`.
      .returning({ id: employeeProfiles.id, userId: employeeProfiles.userId });
    return row;
  }
}
