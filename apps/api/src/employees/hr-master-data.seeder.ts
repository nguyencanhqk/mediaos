import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { contractTypes, employeeCodeConfigs, jobLevels } from "../db/schema/hr-master";
import type {
  MasterDataSeedContext,
  ModuleMasterDataSeeder,
} from "../foundation/seed/master-data-seeder.types";

/**
 * S2-FND-SEED-2 — RUNTIME per-company master-data seeder cho HR (DB-10 §14.1 + DB-03 §15.1).
 *
 * VÌ SAO RUNTIME (không migration): job_levels/contract_types/employee_code_configs là company-scoped —
 * clean DB có 0 company nên migration KHÔNG seed được theo company (mirror AttMasterDataSeeder/
 * LeaveMasterDataSeeder). Module HR (employees) đăng ký seeder này vào MasterDataSeederRegistry (qua
 * HrSeedRegistrar) → MasterDataSeedRunner chạy cho MỖI company trong tenant tx (RLS+FORCE ép company_id ở
 * DB, BẤT BIẾN #1).
 *
 * PHẠM VI: 8 job_levels + 5 contract_types + 1 employee_code_config (prefix EMP, padding 4). KHÔNG chạm
 * `sequence_counters` — counter được cấp lười (ensure-on-miss) tại HrWriteService.allocateEmployeeCode
 * lần tạo employee ĐẦU TIÊN của company (đọc employee_code_config seeded ở đây — S2-FND-SEED-2 OWNER
 * CHỐT 2026-07-03), KHÔNG hard-code EMP/4 ở bất kỳ đâu ngoài seed data bên dưới.
 *
 * IDEMPOTENT: INSERT … ON CONFLICT DO NOTHING theo PARTIAL UNIQUE (company_id, code) WHERE deleted_at IS
 * NULL AND code IS NOT NULL (job_levels_company_code_active_uq / contract_types_company_code_active_uq,
 * mig 0442) và (company_id) WHERE deleted_at IS NULL cho employee_code_configs (employee_code_configs_
 * company_active_uq, mig 0442) → chạy lại KHÔNG dup, KHÔNG ghi đè admin đã sửa (ON CONFLICT DO NOTHING
 * bỏ qua HOÀN TOÀN khi row đã tồn tại — kể cả khi nội dung khác seed default). ctx.track() payload CHỈ
 * master/config data (KHÔNG secret — BẤT BIẾN #3; checksum ổn định ⇒ lần 2 Skipped).
 */

/** DB-10 §14.1 / DB-03 §15.1 — 8 cấp bậc nhân sự mặc định (code = business key, giống job levels 2 spec). */
interface JobLevelSeed {
  code: string;
  name: string;
  rankOrder: number;
}

const JOB_LEVEL_SEEDS: readonly JobLevelSeed[] = [
  { code: "INTERN", name: "Intern", rankOrder: 10 },
  { code: "FRESHER", name: "Fresher", rankOrder: 20 },
  { code: "JUNIOR", name: "Junior", rankOrder: 30 },
  { code: "MIDDLE", name: "Middle", rankOrder: 40 },
  { code: "SENIOR", name: "Senior", rankOrder: 50 },
  { code: "LEAD", name: "Lead", rankOrder: 60 },
  { code: "MANAGER", name: "Manager", rankOrder: 70 },
  { code: "DIRECTOR", name: "Director", rankOrder: 80 },
];

/**
 * DB-10 §14.1 — 5 loại hợp đồng mặc định. PIN: DB-10 §14.1 dùng mã khác DB-03 §15.2 (PROBATION/
 * DEFINITE_TERM/INDEFINITE_TERM/SERVICE/INTERN vs PROBATION/FIXED_TERM/INDEFINITE/PART_TIME/INTERNSHIP —
 * spec drift 2 tài liệu) — WO này chỉ định rõ "theo DB-10 §14.1" nên dùng bộ mã DB-10. `requiresEndDate`
 * KHÔNG có trong bảng DB-10 (chỉ DB-03 §15.2 liệt kê) — suy theo quy tắc song song DB-03 §7.7 rule 2
 * ("requires_end_date=true ⇒ hợp đồng phải có end_date"): mọi loại CÓ thời hạn xác định = true, riêng
 * INDEFINITE_TERM (không xác định thời hạn) = false.
 */
interface ContractTypeSeed {
  code: string;
  name: string;
  requiresEndDate: boolean;
}

const CONTRACT_TYPE_SEEDS: readonly ContractTypeSeed[] = [
  { code: "PROBATION", name: "Hợp đồng thử việc", requiresEndDate: true },
  { code: "DEFINITE_TERM", name: "Hợp đồng xác định thời hạn", requiresEndDate: true },
  { code: "INDEFINITE_TERM", name: "Hợp đồng không xác định thời hạn", requiresEndDate: false },
  { code: "SERVICE", name: "Hợp đồng dịch vụ/cộng tác", requiresEndDate: true },
  { code: "INTERN", name: "Thực tập", requiresEndDate: true },
];

/** DB-10 §14.1 — employee_code_configs seed đề xuất (prefix EMP, padding 4, allow_manual_override false). */
const EMPLOYEE_CODE_CONFIG_SEED = {
  prefix: "EMP",
  pattern: null as string | null,
  numberLength: 4,
  allowManualOverride: false,
  status: "active",
} as const;

@Injectable()
export class HrMasterDataSeeder implements ModuleMasterDataSeeder {
  readonly seedKey = "hr.master-data";
  readonly seedVersion = "v1";

  async seed(ctx: MasterDataSeedContext): Promise<void> {
    await this.seedJobLevels(ctx);
    await this.seedContractTypes(ctx);
    await this.seedEmployeeCodeConfig(ctx);
  }

  /** 8 job_levels mặc định (DB-10 §14.1). Upsert qua partial unique (company_id, code) WHERE deleted_at IS NULL. */
  private async seedJobLevels(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    for (const level of JOB_LEVEL_SEEDS) {
      await tx
        .insert(jobLevels)
        .values({
          companyId,
          code: level.code,
          name: level.name,
          rankOrder: level.rankOrder,
          status: "active",
        })
        // ON CONFLICT phải khớp NGUYÊN VĂN partial unique index (mig 0442) → target + where = index arbiter.
        .onConflictDoNothing({
          target: [jobLevels.companyId, jobLevels.code],
          where: sql`deleted_at IS NULL AND code IS NOT NULL`,
        });

      const [row] = await tx
        .select({ id: jobLevels.id })
        .from(jobLevels)
        .where(
          and(
            eq(jobLevels.companyId, companyId),
            eq(jobLevels.code, level.code),
            isNull(jobLevels.deletedAt),
          ),
        )
        .limit(1);

      await ctx.track({
        targetTable: "job_levels",
        targetKey: level.code,
        operation: "Upsert",
        targetId: row?.id ?? null,
        // Config-only payload (KHÔNG secret) — ổn định giữa các lần ⇒ checksum không đổi ⇒ lần 2 Skipped.
        payload: {
          code: level.code,
          name: level.name,
          rankOrder: level.rankOrder,
          status: "active",
        },
      });
    }
  }

  /** 5 contract_types mặc định (DB-10 §14.1). Upsert qua partial unique (company_id, code) WHERE deleted_at IS NULL. */
  private async seedContractTypes(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    for (const t of CONTRACT_TYPE_SEEDS) {
      await tx
        .insert(contractTypes)
        .values({
          companyId,
          code: t.code,
          name: t.name,
          requiresEndDate: t.requiresEndDate,
          status: "active",
        })
        .onConflictDoNothing({
          target: [contractTypes.companyId, contractTypes.code],
          where: sql`deleted_at IS NULL AND code IS NOT NULL`,
        });

      const [row] = await tx
        .select({ id: contractTypes.id })
        .from(contractTypes)
        .where(
          and(
            eq(contractTypes.companyId, companyId),
            eq(contractTypes.code, t.code),
            isNull(contractTypes.deletedAt),
          ),
        )
        .limit(1);

      await ctx.track({
        targetTable: "contract_types",
        targetKey: t.code,
        operation: "Upsert",
        targetId: row?.id ?? null,
        payload: {
          code: t.code,
          name: t.name,
          requiresEndDate: t.requiresEndDate,
          status: "active",
        },
      });
    }
  }

  /**
   * 1 employee_code_config mặc định/company (DB-10 §14.1). Upsert qua partial unique (company_id) WHERE
   * deleted_at IS NULL — TỐI ĐA 1 row active/company (mig 0442). Business key idempotent = 'EMPLOYEE_CODE'
   * (hằng số, KHÔNG phải cột thật trên bảng này — targetKey chỉ để track/checksum phân biệt item).
   */
  private async seedEmployeeCodeConfig(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;
    const targetKey = "EMPLOYEE_CODE";

    await tx
      .insert(employeeCodeConfigs)
      .values({ companyId, ...EMPLOYEE_CODE_CONFIG_SEED })
      .onConflictDoNothing({
        target: [employeeCodeConfigs.companyId],
        where: sql`deleted_at IS NULL`,
      });

    const [row] = await tx
      .select({ id: employeeCodeConfigs.id })
      .from(employeeCodeConfigs)
      .where(
        and(eq(employeeCodeConfigs.companyId, companyId), isNull(employeeCodeConfigs.deletedAt)),
      )
      .limit(1);

    await ctx.track({
      targetTable: "employee_code_configs",
      targetKey,
      operation: "Upsert",
      targetId: row?.id ?? null,
      payload: { ...EMPLOYEE_CODE_CONFIG_SEED },
    });
  }
}
