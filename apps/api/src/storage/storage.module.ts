import { Module } from "@nestjs/common";
import { ObjectStorageService } from "./object-storage.service";

/**
 * StorageModule — object storage (S3/MinIO) wrapper. Imported by feature modules that need to
 * presign uploads/downloads (B4: TasksModule for task attachments). Kept separate from app.module
 * crypto-style providers — it has no DB dependency and is purely an S3 SDK boundary.
 */
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class StorageModule {}
