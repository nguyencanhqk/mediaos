import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import {
  companySecurityPolicies,
  type CompanySecurityPolicy,
} from "../db/schema/security-policy";

/** Subset cột ghi được qua PATCH (mọi field optional — partial upsert). */
export type SecurityPolicyPatch = Partial<{
  autoLogoutMinutes: number | null;
  ipRestrictionEnabled: boolean;
  allowlistCidrs: string[];
  timeRestrictionEnabled: boolean;
  timeWindows: { day: number; start: string; end: string }[];
  applyScope: "all" | "selected";
  applyAppKeys: string[];
  exemptUserIds: string[];
  emailDomainRestrictionEnabled: boolean;
  allowedEmailDomains: string[];
  twoFactorEnforced: boolean | null;
}>;

@Injectable()
export class SecurityPolicyRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Đọc hàng policy của công ty (1 hàng/tenant). null = chưa cấu hình. */
  findByCompanyTx(tx: TenantTx, companyId: string): Promise<CompanySecurityPolicy | undefined> {
    return tx
      .select()
      .from(companySecurityPolicies)
      .where(eq(companySecurityPolicies.companyId, companyId))
      .limit(1)
      .then((rows) => rows[0]);
  }

  findByCompany(companyId: string): Promise<CompanySecurityPolicy | undefined> {
    return this.db.withTenant(companyId, (tx) => this.findByCompanyTx(tx, companyId));
  }

  /**
   * UPSERT 1 hàng/công ty (UNIQUE company_id). INSERT giá trị mặc định cho cột không patch; nếu đã tồn tại
   * → UPDATE chỉ cột có trong patch (giữ nguyên cột khác). company_id ép qua RLS WITH CHECK (DEFAULT GUC).
   * Chạy TRONG tx của caller để cùng commit với audit (BẤT BIẾN #2).
   */
  async upsertTx(
    tx: TenantTx,
    companyId: string,
    patch: SecurityPolicyPatch,
  ): Promise<CompanySecurityPolicy> {
    // SET clause cho ON CONFLICT — chỉ cột có trong patch (undefined bị Drizzle bỏ qua khi insert; với
    // update ta build tường minh để không ghi đè cột vắng).
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) updateSet[k] = v;
    }

    const [row] = await tx
      .insert(companySecurityPolicies)
      .values({ companyId, ...patch })
      .onConflictDoUpdate({
        target: companySecurityPolicies.companyId,
        set: updateSet,
      })
      .returning();
    return row;
  }
}
