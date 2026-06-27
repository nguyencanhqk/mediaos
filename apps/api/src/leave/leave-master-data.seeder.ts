import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { leaveTypes } from "../db/schema/hr";
import { leavePolicies } from "../db/schema/leave";
import type {
  MasterDataSeedContext,
  ModuleMasterDataSeeder,
} from "../foundation/seed/master-data-seeder.types";

/**
 * S3-LEAVE-SEED-1 (PART B) — RUNTIME per-company master-data seeder cho LEAVE (DB-05 §7.1/§7.2 + DB-08 §8.12).
 *
 * VÌ SAO RUNTIME (không migration): leave_types + leave_policies là company-scoped — clean DB có 0 company nên
 * migration KHÔNG seed được theo company. Module LEAVE đăng ký seeder này vào MasterDataSeederRegistry (qua
 * LeaveSeedRegistrar) → MasterDataSeedRunner chạy cho MỖI company trong tenant tx (RLS+FORCE ép company_id ở
 * DB, BẤT BIẾN #1).
 *
 * PHẠM VI: 4 loại nghỉ mặc định (ANNUAL/SICK/UNPAID/OTHER) + 1 chính sách phép năm Company (DEFAULT_ANNUAL).
 * Số dư phép theo nhân viên (leave_balances per-employee) NẰM NGOÀI phạm vi WO (DEFERRED).
 *
 * IDEMPOTENT: INSERT … ON CONFLICT DO NOTHING theo PARTIAL UNIQUE (company_id, code/policy_code) WHERE
 * deleted_at IS NULL (leave_types_company_code_active_uq / uq_leave_policies_company_code_active, mig 0062/0453)
 * → chạy lại KHÔNG dup. ctx.track() payload CHỈ master/config data (KHÔNG secret — BẤT BIẾN #3; checksum ổn
 * định ⇒ lần 2 Skipped).
 */

/** Business key idempotent — loại nghỉ phép năm (deduct balance). */
export const LEAVE_TYPE_ANNUAL_CODE = "ANNUAL";
/** Business key idempotent — chính sách phép năm Company mặc định (DB-05 §7.2). */
export const LEAVE_DEFAULT_POLICY_CODE = "DEFAULT_ANNUAL";

/** Default quota của chính sách phép năm (ngày/năm). */
const DEFAULT_ANNUAL_QUOTA_DAYS = "12";

/**
 * 4 loại nghỉ mặc định (DB-05 §7.1). status='active' lowercase (leave_types_status_check = active/inactive).
 * Mọi cột khớp schema hr.ts (S3-LEAVE-DB-1 mig 0453 đã ALTER-ADD). KHÔNG set annual_quota (đặt ở policy).
 */
interface LeaveTypeSeed {
  code: string;
  name: string;
  paid: boolean;
  deductBalance: boolean;
  balanceUnit?: "Day" | "Hour";
  allowFullDay?: boolean;
  allowHalfDay?: boolean;
  allowHourly?: boolean;
  allowMultipleDays?: boolean;
  requireReason?: boolean;
  requireAttachment?: boolean;
  minNoticeDays: number;
  sortOrder: number;
}

const LEAVE_TYPE_SEEDS: readonly LeaveTypeSeed[] = [
  {
    code: LEAVE_TYPE_ANNUAL_CODE,
    name: "Nghỉ phép năm",
    paid: true,
    deductBalance: true,
    balanceUnit: "Day",
    allowFullDay: true,
    allowHalfDay: true,
    allowHourly: false,
    allowMultipleDays: true,
    requireReason: false,
    requireAttachment: false,
    minNoticeDays: 1,
    sortOrder: 1,
  },
  {
    code: "SICK",
    name: "Nghỉ ốm",
    paid: true,
    deductBalance: true,
    allowHalfDay: true,
    requireReason: true,
    minNoticeDays: 0,
    sortOrder: 2,
  },
  {
    code: "UNPAID",
    name: "Nghỉ không lương",
    paid: false,
    deductBalance: false,
    requireReason: true,
    minNoticeDays: 0,
    sortOrder: 3,
  },
  {
    code: "OTHER",
    name: "Nghỉ khác",
    paid: true,
    deductBalance: false,
    requireReason: true,
    minNoticeDays: 0,
    sortOrder: 4,
  },
];

@Injectable()
export class LeaveMasterDataSeeder implements ModuleMasterDataSeeder {
  readonly seedKey = "leave.master-data";
  readonly seedVersion = "v1";

  async seed(ctx: MasterDataSeedContext): Promise<void> {
    await this.seedLeaveTypes(ctx);
    await this.seedDefaultAnnualPolicy(ctx);
  }

  /** 4 loại nghỉ mặc định (DB-05 §7.1). Upsert qua partial unique (company_id, code) WHERE deleted_at IS NULL. */
  private async seedLeaveTypes(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    for (const t of LEAVE_TYPE_SEEDS) {
      await tx
        .insert(leaveTypes)
        .values({
          companyId,
          code: t.code,
          name: t.name,
          paid: t.paid,
          status: "active",
          deductBalance: t.deductBalance,
          balanceUnit: t.balanceUnit ?? null,
          allowFullDay: t.allowFullDay ?? null,
          allowHalfDay: t.allowHalfDay ?? null,
          allowHourly: t.allowHourly ?? null,
          allowMultipleDays: t.allowMultipleDays ?? null,
          requireReason: t.requireReason ?? null,
          requireAttachment: t.requireAttachment ?? null,
          minNoticeDays: t.minNoticeDays,
          isSystemDefault: true,
          sortOrder: t.sortOrder,
        })
        // ON CONFLICT phải khớp PARTIAL unique index (predicate deleted_at IS NULL) → `where` = index arbiter.
        .onConflictDoNothing({
          target: [leaveTypes.companyId, leaveTypes.code],
          where: sql`deleted_at IS NULL`,
        });

      const [row] = await tx
        .select({ id: leaveTypes.id })
        .from(leaveTypes)
        .where(
          and(
            eq(leaveTypes.companyId, companyId),
            eq(leaveTypes.code, t.code),
            isNull(leaveTypes.deletedAt),
          ),
        )
        .limit(1);

      await ctx.track({
        targetTable: "leave_types",
        targetKey: t.code,
        operation: "Upsert",
        targetId: row?.id ?? null,
        // Config-only payload (KHÔNG secret) — ổn định giữa các lần ⇒ checksum không đổi ⇒ lần 2 Skipped.
        payload: {
          code: t.code,
          paid: t.paid,
          deductBalance: t.deductBalance,
          balanceUnit: t.balanceUnit ?? null,
          minNoticeDays: t.minNoticeDays,
          isSystemDefault: true,
          sortOrder: t.sortOrder,
          status: "active",
        },
      });
    }
  }

  /**
   * Chính sách phép năm Company mặc định (DB-05 §7.2): DEFAULT_ANNUAL, scope Company, leave_type=ANNUAL,
   * quota 12 ngày/năm, requires_manager_approval. policy_scope='Company' ⇒ KHÔNG set department/employee/
   * job_level/contract_type (chk_leave_policies_target). status='Active' TitleCase (chk_leave_policies_status).
   */
  private async seedDefaultAnnualPolicy(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    // Resolve loại nghỉ ANNUAL (đã seed ở bước trên) — policy bắt buộc leave_type_id NOT NULL.
    const [annual] = await tx
      .select({ id: leaveTypes.id })
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.companyId, companyId),
          eq(leaveTypes.code, LEAVE_TYPE_ANNUAL_CODE),
          isNull(leaveTypes.deletedAt),
        ),
      )
      .limit(1);

    if (!annual) {
      throw new Error(
        `[leave.master-data] loại nghỉ ${LEAVE_TYPE_ANNUAL_CODE} không tồn tại sau seed leave_types — không thể tạo ${LEAVE_DEFAULT_POLICY_CODE}`,
      );
    }

    await tx
      .insert(leavePolicies)
      .values({
        companyId,
        leaveTypeId: annual.id,
        policyCode: LEAVE_DEFAULT_POLICY_CODE,
        name: "Chính sách nghỉ phép năm mặc định",
        policyScope: "Company",
        yearlyQuotaDays: DEFAULT_ANNUAL_QUOTA_DAYS,
        accrualMethod: "None",
        reserveBalanceOnPending: true,
        allowNegativeBalance: false,
        requiresManagerApproval: true,
        requiresHrApproval: false,
        effectiveFrom: "2020-01-01",
        status: "Active",
      })
      .onConflictDoNothing({
        target: [leavePolicies.companyId, leavePolicies.policyCode],
        where: sql`deleted_at IS NULL`,
      });

    const [row] = await tx
      .select({ id: leavePolicies.id })
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.companyId, companyId),
          eq(leavePolicies.policyCode, LEAVE_DEFAULT_POLICY_CODE),
          isNull(leavePolicies.deletedAt),
        ),
      )
      .limit(1);

    await ctx.track({
      targetTable: "leave_policies",
      targetKey: LEAVE_DEFAULT_POLICY_CODE,
      operation: "Upsert",
      targetId: row?.id ?? null,
      payload: {
        policyCode: LEAVE_DEFAULT_POLICY_CODE,
        policyScope: "Company",
        leaveTypeCode: LEAVE_TYPE_ANNUAL_CODE,
        yearlyQuotaDays: DEFAULT_ANNUAL_QUOTA_DAYS,
        accrualMethod: "None",
        reserveBalanceOnPending: true,
        allowNegativeBalance: false,
        requiresManagerApproval: true,
        requiresHrApproval: false,
        status: "Active",
      },
    });
  }
}
