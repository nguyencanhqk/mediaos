import type { TenantTx } from "../../db/db.service";
import type { MarkItemResult, SeedItemOperation } from "./seed-tracking.types";

/**
 * S3-FND-SEEDRUN-1 — hợp đồng cho RUNTIME per-company master-data seed (DB-08 §8.12/8.13).
 *
 * VÌ SAO RUNTIME (không migration): clean DB có 0 company ⇒ migration KHÔNG seed được master-data theo
 * company (vd default shift/rule ATT, leave types LEAVE). Convention mig 0445/0008 CẤM seed company-scoped
 * ở migrate-time. Cơ chế: mỗi module ATT/LEAVE/HR hiện thực `ModuleMasterDataSeeder` rồi ĐĂNG KÝ qua DI vào
 * `MasterDataSeederRegistry`; `MasterDataSeedRunner` (boot-time) chạy MỖI seeder cho MỖI company.
 *
 * INVERSION OF DEPENDENCY: foundation/runner KHÔNG import ATT/LEAVE. Module nghiệp vụ import SeedModule
 * (lấy registry) + tự `register()` seeder của mình (mirror PermissionCacheInvalidator ↔ EventBus.register).
 *
 * BẤT BIẾN giữ nguyên: seeder CHỈ làm INSERT trong tenant tx do runner cấp (RLS+FORCE ép company_id ở DB,
 * #1). Seeder KHÔNG tự mở batch/finishBatch (runner sở hữu vòng đời). Payload track KHÔNG chứa secret (#3 —
 * SeedTrackingService.markItem throw nếu vi phạm). KHÔNG hard-delete (#2 — seed_items/seed_batches
 * append-history; seeder seed master-data nên dùng INSERT … ON CONFLICT DO NOTHING / upsert idempotent).
 */

/** DI token đa-provider (mirror EventBus): module nghiệp vụ register seeder của mình vào registry. */
export const MASTER_DATA_SEEDERS = Symbol("MASTER_DATA_SEEDERS");

/**
 * Input cho `track()` — 1 item master-data đã seed. KHÔNG có companyId/batchId (runner tự bơm cho batch hiện
 * tại ⇒ seeder KHÔNG chạm batch lifecycle). `payload` chỉ master/config data, KHÔNG secret/PII (#3).
 */
export interface SeedItemTrackInput {
  /** Bảng đích (vd 'attendance_rules', 'leave_types'). */
  targetTable: string;
  /** Business key idempotent của row (vd code rule / leave-type code). */
  targetKey: string;
  /** Mặc định 'Upsert'. */
  operation?: SeedItemOperation;
  /** Master/config data — KHÔNG secret/hash/PII (BẤT BIẾN #3). */
  payload?: Record<string, unknown> | null;
  /** id row đích sau khi seed (nếu biết) — để truy vết. */
  targetId?: string | null;
}

/**
 * Helper mỏng bọc `SeedTrackingService.markItem` cho BATCH HIỆN TẠI. Idempotent theo checksum (lần 2 cùng
 * payload ⇒ Skipped, KHÔNG ghi đè). Trả `MarkItemResult` để seeder biết Skip vs Success nếu cần.
 */
export type SeedItemTracker = (item: SeedItemTrackInput) => Promise<MarkItemResult>;

/**
 * Ngữ cảnh trao cho `seed()`:
 *  - `companyId` — company đang seed (đã validate UUID ở withTenant).
 *  - `tx` — transaction tenant-scoped (app.current_company_id ĐÃ set) cho mọi INSERT master-data của seeder.
 *  - `track` — ghi seed_items cho từng row (vào batch do runner mở).
 */
export interface MasterDataSeedContext {
  readonly companyId: string;
  readonly tx: TenantTx;
  readonly track: SeedItemTracker;
}

/**
 * Hợp đồng 1 module seeder hiện thực (vd AttMasterDataSeeder). seedKey/seedVersion định danh batch idempotent
 * (uq company_id+seed_key+seed_version ở DB). `seed()` CHỈ làm INSERT trong `ctx.tx` + gọi `ctx.track()` mỗi
 * row — KHÔNG mở/đóng batch, KHÔNG enumerate company.
 */
export interface ModuleMasterDataSeeder {
  /** Khoá batch DUY NHẤT toàn hệ (vd 'att.master-data'). */
  readonly seedKey: string;
  /** Phiên bản seed — bump khi đổi tập master-data để chạy lại batch mới (vd 'v1'). */
  readonly seedVersion: string;
  /** Thực thi seed cho 1 company trong tenant tx do runner cấp. Throw ⇒ runner mark batch Failed + tiếp tục. */
  seed(ctx: MasterDataSeedContext): Promise<void>;
}
