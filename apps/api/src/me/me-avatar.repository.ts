import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema";

/**
 * S5-ME-BE-2 — self-scope ownership check dùng bởi `MeAvatarFileResolver` (đăng ký vào FilePolicyService)
 * + `MeAvatarService`. CHỈ 1 query: "employeeId có PHẢI là employee active liên kết CHÍNH userId?" — Own-scope
 * thuần (KHÔNG Team/Department escalation, khớp thiết kế `update:avatar` chỉ seed Own — mig 0495).
 */
@Injectable()
export class MeAvatarRepository {
  async isOwnEmployeeTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    userId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, employeeId),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return !!row;
  }
}
