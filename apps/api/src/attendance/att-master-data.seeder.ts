import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { attendanceRules, shifts } from "../db/schema/attendance";
import type {
  MasterDataSeedContext,
  ModuleMasterDataSeeder,
} from "../foundation/seed/master-data-seeder.types";

/**
 * S3-ATT-SEED-1 (PART B) — RUNTIME per-company master-data seeder cho ATT (DB-08 §8.12 + DB-10 §14.2).
 *
 * VÌ SAO RUNTIME (không migration): default shift/rule là company-scoped — clean DB có 0 company nên
 * migration KHÔNG seed được theo company. Module ATT đăng ký seeder này vào MasterDataSeederRegistry
 * (qua AttSeedRegistrar) → MasterDataSeedRunner chạy cho MỖI company trong tenant tx (RLS+FORCE ép
 * company_id ở DB, BẤT BIẾN #1).
 *
 * IDEMPOTENT: INSERT … ON CONFLICT DO NOTHING theo PARTIAL UNIQUE (company_id, code) WHERE deleted_at IS NULL
 * (uq_shifts_company_code_active / uq_attendance_rules_company_code_active, mig 0452) → chạy lại KHÔNG dup.
 * ctx.track() payload CHỈ master/config data (KHÔNG secret — BẤT BIẾN #3; checksum ổn định ⇒ lần 2 Skipped).
 */

/** Business key idempotent — shift mặc định (DB-10 §14.2). */
export const ATT_DEFAULT_SHIFT_CODE = "OFFICE_8H";
/** Business key idempotent — rule chấm công mặc định (DB-10 §14.2). */
export const ATT_DEFAULT_RULE_CODE = "DEFAULT_OFFICE_RULE";

@Injectable()
export class AttMasterDataSeeder implements ModuleMasterDataSeeder {
  readonly seedKey = "att.master-data";
  readonly seedVersion = "v1";

  async seed(ctx: MasterDataSeedContext): Promise<void> {
    await this.seedDefaultShift(ctx);
    await this.seedDefaultRule(ctx);
  }

  /** Shift OFFICE_8H (DB-10 §14.2): 08:00–17:00, nghỉ 12:00–13:00 (60'), đủ 480', grace 5/5, is_default. */
  private async seedDefaultShift(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    await tx
      .insert(shifts)
      .values({
        companyId,
        shiftCode: ATT_DEFAULT_SHIFT_CODE,
        name: "Ca hành chính 8 giờ",
        shiftType: "Fixed",
        startTime: "08:00:00",
        endTime: "17:00:00",
        breakStartTime: "12:00:00",
        breakEndTime: "13:00:00",
        breakMinutes: 60,
        requiredWorkingMinutes: 480,
        graceLateMinutes: 5,
        graceEarlyLeaveMinutes: 5,
        isDefault: true,
        status: "Active",
        metadata: { timezone: "Asia/Ho_Chi_Minh" },
      })
      // ON CONFLICT phải khớp PARTIAL unique index (predicate deleted_at IS NULL) → `where` = index arbiter.
      .onConflictDoNothing({
        target: [shifts.companyId, shifts.shiftCode],
        where: sql`deleted_at IS NULL`,
      });

    const [row] = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.companyId, companyId),
          eq(shifts.shiftCode, ATT_DEFAULT_SHIFT_CODE),
          isNull(shifts.deletedAt),
        ),
      )
      .limit(1);

    await ctx.track({
      targetTable: "shifts",
      targetKey: ATT_DEFAULT_SHIFT_CODE,
      operation: "Upsert",
      targetId: row?.id ?? null,
      // Config-only payload (KHÔNG secret) — ổn định giữa các lần ⇒ checksum không đổi ⇒ lần 2 Skipped.
      payload: {
        shiftCode: ATT_DEFAULT_SHIFT_CODE,
        startTime: "08:00:00",
        endTime: "17:00:00",
        breakMinutes: 60,
        requiredWorkingMinutes: 480,
        graceLateMinutes: 5,
        graceEarlyLeaveMinutes: 5,
        isDefault: true,
        timezone: "Asia/Ho_Chi_Minh",
      },
    });
  }

  /** Rule DEFAULT_OFFICE_RULE (DB-10 §14.2): Company-scope, require check-in/out, chặn khi nghỉ Approved. */
  private async seedDefaultRule(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    await tx
      .insert(attendanceRules)
      .values({
        companyId,
        ruleCode: ATT_DEFAULT_RULE_CODE,
        name: "Rule chấm công văn phòng mặc định",
        ruleScope: "Company",
        effectiveFrom: "2020-01-01",
        requireCheckIn: true,
        requireCheckOut: true,
        allowWebCheckIn: true,
        allowMobileCheckIn: true,
        allowRemoteCheckIn: true,
        requireGps: false,
        ruleConfig: {
          missing_checkout_policy: "MarkMissingCheckout",
          block_when_leave_approved: true,
        },
        status: "Active",
      })
      .onConflictDoNothing({
        target: [attendanceRules.companyId, attendanceRules.ruleCode],
        where: sql`deleted_at IS NULL`,
      });

    const [row] = await tx
      .select({ id: attendanceRules.id })
      .from(attendanceRules)
      .where(
        and(
          eq(attendanceRules.companyId, companyId),
          eq(attendanceRules.ruleCode, ATT_DEFAULT_RULE_CODE),
          isNull(attendanceRules.deletedAt),
        ),
      )
      .limit(1);

    await ctx.track({
      targetTable: "attendance_rules",
      targetKey: ATT_DEFAULT_RULE_CODE,
      operation: "Upsert",
      targetId: row?.id ?? null,
      payload: {
        ruleCode: ATT_DEFAULT_RULE_CODE,
        ruleScope: "Company",
        requireCheckIn: true,
        requireCheckOut: true,
        allowWebCheckIn: true,
        allowMobileCheckIn: true,
        allowRemoteCheckIn: true,
        requireGps: false,
        missingCheckoutPolicy: "MarkMissingCheckout",
        blockWhenLeaveApproved: true,
      },
    });
  }
}
