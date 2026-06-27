import { Injectable, Logger } from "@nestjs/common";
import { isNull } from "drizzle-orm";
import { DatabaseService } from "../../db/db.service";
import { companies } from "../../db/schema/companies";
import { MasterDataSeederRegistry } from "./master-data-seeder.registry";
import type { ModuleMasterDataSeeder } from "./master-data-seeder.types";
import { SeedTrackingService } from "./seed-tracking.service";
import type { SeedBatchStatus } from "./seed-tracking.types";

/** Kết quả reconcile 1 (company, seeder). */
export interface SeederRunOutcome {
  companyId: string;
  seedKey: string;
  /** true = batch chạy xong (Success/Skipped); false = lỗi đã bắt (batch mark Failed). */
  ok: boolean;
  status?: SeedBatchStatus;
  error?: string;
}

/** Tổng hợp reconcile toàn hệ — KHÔNG bao giờ throw (boot không được sập vì seed lỗi). */
export interface SeedRunSummary {
  companiesScanned: number;
  seedersRegistered: number;
  succeeded: number;
  failed: number;
  outcomes: SeederRunOutcome[];
}

const SENTINEL_TABLE = "(seeder)";

/**
 * S3-FND-SEEDRUN-1 — RUNTIME per-company master-data seed runner (DB-08 §8.12/8.13).
 *
 * `reconcileAllCompanies()`: enumerate mọi company chưa xoá (SYSTEM read qua withPlatformContext — nới RLS
 * `companies` chéo tenant, mig 0230) → MỖI company × MỖI seeder đã đăng ký:
 *   startBatch(company, seedKey, seedVersion)  [tx riêng — idempotent uq company+key+version]
 *   → withTenant(company): seeder.seed({ companyId, tx, track })  [tenant tx cho INSERT master-data]
 *   → finishBatch(company, batchId)            [tx riêng — suy status từ items]
 *
 * FAIL-SAFE: MỖI (company, seeder) bọc try/catch — lỗi ⇒ log có cấu trúc + markItemFailed + finishBatch
 * (batch=Failed) rồi TIẾP TỤC seeder/company khác. reconcile KHÔNG BAO GIỜ throw (gọi từ
 * OnApplicationBootstrap — throw sẽ sập boot). Enumerate lỗi (DB down) cũng bắt + trả summary rỗng.
 *
 * IDEMPOTENT: startBatch dedup theo (company, seedKey, version) ⇒ reused; markItem dedup theo checksum ⇒
 * Skipped; seeder tự dùng INSERT … ON CONFLICT ⇒ chạy lại = không nhân bản row.
 *
 * BẤT BIẾN: mọi data-access qua DatabaseService (withTenant / withPlatformContext) — KHÔNG query trần (#1).
 */
@Injectable()
export class MasterDataSeedRunner {
  private readonly logger = new Logger(MasterDataSeedRunner.name);
  /**
   * Ghi vào seed_batches.environment để truy vết. Đọc process.env.NODE_ENV TRỰC TIẾP (KHÔNG là constructor
   * param) — Nest DI sẽ cố resolve token `String` nếu để ở constructor (UnknownDependencies). Mặc định 'development'.
   */
  private readonly environment: string = process.env.NODE_ENV ?? "development";

  constructor(
    private readonly db: DatabaseService,
    private readonly seedTracking: SeedTrackingService,
    private readonly registry: MasterDataSeederRegistry,
  ) {}

  /** Reconcile mọi company × mọi seeder. KHÔNG throw — trả summary. */
  async reconcileAllCompanies(): Promise<SeedRunSummary> {
    const seeders = this.registry.list();
    if (seeders.length === 0) {
      this.logger.log("KHÔNG có seeder master-data nào đăng ký — bỏ qua reconcile.");
      return { companiesScanned: 0, seedersRegistered: 0, succeeded: 0, failed: 0, outcomes: [] };
    }

    let companyIds: string[];
    try {
      companyIds = await this.listActiveCompanyIds();
    } catch (err) {
      // Enumerate lỗi (DB chưa lên / RLS) — KHÔNG sập boot. Lần boot sau retry.
      this.logger.error(
        `Liệt kê company THẤT BẠI — bỏ qua reconcile lần này: ${this.errMsg(err)}`,
        this.errStack(err),
      );
      return {
        companiesScanned: 0,
        seedersRegistered: seeders.length,
        succeeded: 0,
        failed: 0,
        outcomes: [],
      };
    }

    const outcomes: SeederRunOutcome[] = [];
    for (const companyId of companyIds) {
      const companyOutcomes = await this.reconcileCompany(companyId, seeders);
      outcomes.push(...companyOutcomes);
    }

    const succeeded = outcomes.filter((o) => o.ok).length;
    const failed = outcomes.length - succeeded;
    this.logger.log(
      `reconcile xong: ${companyIds.length} company × ${seeders.length} seeder → ` +
        `${succeeded} ok, ${failed} lỗi.`,
    );
    return {
      companiesScanned: companyIds.length,
      seedersRegistered: seeders.length,
      succeeded,
      failed,
      outcomes,
    };
  }

  /**
   * Reconcile MỌI seeder đã đăng ký cho ĐÚNG 1 company (dùng cho company tạo mới ở runtime). KHÔNG throw.
   * `seeders` cho phép truyền tập đã đọc sẵn (reconcileAllCompanies tái dùng); mặc định đọc từ registry.
   */
  async reconcileCompany(
    companyId: string,
    seeders: readonly ModuleMasterDataSeeder[] = this.registry.list(),
  ): Promise<SeederRunOutcome[]> {
    const outcomes: SeederRunOutcome[] = [];
    for (const seeder of seeders) {
      outcomes.push(await this.runOne(companyId, seeder));
    }
    return outcomes;
  }

  /** Chạy 1 seeder cho 1 company — bọc try/catch toàn phần (fail-safe). */
  private async runOne(
    companyId: string,
    seeder: ModuleMasterDataSeeder,
  ): Promise<SeederRunOutcome> {
    let batchId: string | null = null;
    try {
      const batch = await this.seedTracking.startBatch({
        companyId,
        seedKey: seeder.seedKey,
        seedVersion: seeder.seedVersion,
        environment: this.environment,
        description: `master-data seed ${seeder.seedKey}@${seeder.seedVersion}`,
      });
      batchId = batch.id;

      await this.db.withTenant(companyId, async (tx) => {
        await seeder.seed({
          companyId,
          tx,
          // track bọc markItem cho batch hiện tại (tx riêng — idempotent theo checksum).
          track: (item) =>
            this.seedTracking.markItem({
              companyId,
              batchId: batch.id,
              targetTable: item.targetTable,
              targetKey: item.targetKey,
              operation: item.operation,
              payload: item.payload,
              targetId: item.targetId,
            }),
        });
      });

      const finished = await this.seedTracking.finishBatch(companyId, batch.id);
      this.logger.debug(
        `seeded company=${companyId} seedKey=${seeder.seedKey} → batch ${finished.status}`,
      );
      return { companyId, seedKey: seeder.seedKey, ok: true, status: finished.status };
    } catch (err) {
      // Lỗi 1 seeder KHÔNG chặn seeder/company khác. Log có cấu trúc (KHÔNG nuốt im lặng).
      this.logger.error(
        `seed THẤT BẠI company=${companyId} seedKey=${seeder.seedKey}: ${this.errMsg(err)}`,
        this.errStack(err),
      );
      await this.markBatchFailed(companyId, batchId, seeder.seedKey, this.errMsg(err));
      return { companyId, seedKey: seeder.seedKey, ok: false, error: this.errMsg(err) };
    }
  }

  /**
   * Đánh dấu batch Failed khi seeder lỗi (best-effort — KHÔNG để lỗi ghi-status che lỗi gốc). Ghi 1 item
   * sentinel Failed (targetTable='(seeder)') rồi finishBatch ⇒ batch suy ra Failed (giữ lịch sử để chẩn đoán).
   */
  private async markBatchFailed(
    companyId: string,
    batchId: string | null,
    seedKey: string,
    errorMessage: string,
  ): Promise<void> {
    if (!batchId) return; // startBatch lỗi ⇒ chưa có batch nào để mark.
    try {
      await this.seedTracking.markItemFailed({
        companyId,
        batchId,
        targetTable: SENTINEL_TABLE,
        targetKey: seedKey,
        errorMessage: errorMessage.slice(0, 1000),
      });
      await this.seedTracking.finishBatch(companyId, batchId);
    } catch (inner) {
      this.logger.error(
        `Không ghi được trạng thái Failed cho batch=${batchId} company=${companyId}: ` +
          this.errMsg(inner),
      );
    }
  }

  /**
   * SYSTEM read: liệt kê id mọi company chưa soft-delete. Qua withPlatformContext (set app.platform_admin=on)
   * — KHÔNG set tenant GUC nên CHỈ `companies` thấy chéo tenant (mig 0230); bảng khác vẫn 0 row (fail-closed).
   */
  private async listActiveCompanyIds(): Promise<string[]> {
    return this.db.withPlatformContext(async (tx) => {
      const rows = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(isNull(companies.deletedAt));
      return rows.map((r) => r.id);
    });
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private errStack(err: unknown): string {
    return err instanceof Error && err.stack ? err.stack : "(no stack)";
  }
}
