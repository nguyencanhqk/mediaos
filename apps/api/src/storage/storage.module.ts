import { Module } from "@nestjs/common";
import { ObjectStorageService } from "./object-storage.service";
import { S3StorageAdapter } from "./s3-storage.adapter";
import { STORAGE_ADAPTER } from "./storage-adapter.port";

/**
 * StorageModule — object storage (S3/MinIO) wrapper. Imported by feature modules that need to
 * presign uploads/downloads (B4: TasksModule for task attachments). Kept separate from app.module
 * crypto-style providers — it has no DB dependency and is purely an S3 SDK boundary.
 *
 * ADDITIVE (CLAUDE.md §9.3 hot-file append):
 *   - ObjectStorageService kept as-is (existing consumers unchanged).
 *   - STORAGE_ADAPTER token added; FileService (and future modules) inject via the PORT interface.
 */
@Module({
  providers: [
    ObjectStorageService,
    // FILE-STORAGE-1: StorageAdapter PORT — S3 implementation via composition over ObjectStorageService.
    { provide: STORAGE_ADAPTER, useClass: S3StorageAdapter },
  ],
  exports: [
    ObjectStorageService,
    // Export the token so importing modules can inject StorageAdapter via STORAGE_ADAPTER.
    STORAGE_ADAPTER,
  ],
})
export class StorageModule {}
