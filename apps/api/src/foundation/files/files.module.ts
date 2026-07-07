import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { PermissionService } from "../../permission/permission.service";
import { StorageModule } from "../../storage/storage.module";
import { SettingsModule } from "../settings/settings.module";
import { FileAccessLogReadService } from "./file-access-log-read.service";
import { FileAccessLogController } from "./file-access-log.controller";
import { FileAccessLogService } from "./file-access-log.service";
import { FileLinkRepository } from "./file-link.repository";
import { FilePolicyService } from "./file-policy.service";
import { FileRepository } from "./file.repository";
import { FilesController } from "./files.controller";
import { FileService } from "./files.service";
import { TempFileCleanupJobHandler } from "./temp-file-cleanup.job-handler";
import { TempFileCleanupRepository } from "./temp-file-cleanup.repository";

/**
 * S1-FND-FILE-1 — FilesModule (self-contained). Wiring:
 *   - DatabaseModule  → withTenant/RLS (BẤT BIẾN #1).
 *   - PermissionModule → PermissionService (route gate qua PermissionGuard + nguồn của FilePolicy fallback).
 *   - EventsModule     → AuditService (@Global; import tường minh để self-contained) — audit-in-tx (#2/#3).
 *   - StorageModule    → STORAGE_ADAPTER (presign download TTL-ngắn; KHÔNG lộ storage_path — #2.3).
 *   - SettingsModule   → SettingService.resolveMany (allowlist MIME + max-size, precedence company>system>
 *     default; KHÔNG hard-code allowlist — S1-FND-SETTING-1).
 *
 * FilePolicyService cấp qua factory (constructor nhận FilePermissionChecker — PermissionService thoả mãn
 * cấu trúc). Đây là CHỐT deny-by-default cho view/download/link/unlink/delete.
 *
 * Wiring vào app: S1-FND-WIRE-1 gom module này vào FoundationModule (KHÔNG sửa app.module.ts ở WO này —
 * tránh va hot-file).
 *
 * S2-FND-JOBS-1 (jobs_tempfile · ADDITIVE): TempFileCleanupJobHandler (@SystemJobHandler) + TempFileCleanupRepository
 * — dọn file tạm hết hạn / upload Pending treo qua JobRunner. SchedulerModule (DiscoveryService) tự gom handler
 * qua metadata; module này KHÔNG import SchedulerModule (phụ thuộc MỘT HƯỚNG, KHÔNG cycle). Chỉ import file
 * token `scheduler/job-handler`. Handler tái dùng SettingService (TTL Pending) + FileAccessLogService + AuditService
 * + DatabaseService (withTenant) đã có sẵn trong module (KHÔNG thêm import).
 */
@Module({
  imports: [DatabaseModule, PermissionModule, EventsModule, StorageModule, SettingsModule],
  // S2-FND-BE-3 (L4) — FileAccessLogController: GET-only viewer (APPEND-ONLY, KHÔNG mutate route). ADDITIVE.
  controllers: [FilesController, FileAccessLogController],
  providers: [
    FileRepository,
    FileLinkRepository,
    FileAccessLogService,
    FileAccessLogReadService,
    FileService,
    // S2-FND-JOBS-1 (jobs_tempfile) — ADDITIVE. Handler tự đăng ký qua @SystemJobHandler metadata.
    TempFileCleanupRepository,
    TempFileCleanupJobHandler,
    {
      provide: FilePolicyService,
      useFactory: (permission: PermissionService): FilePolicyService =>
        new FilePolicyService(permission),
      inject: [PermissionService],
    },
  ],
  exports: [FileService, FilePolicyService, TempFileCleanupJobHandler],
})
export class FilesModule {}
