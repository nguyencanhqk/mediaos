import { Module } from "@nestjs/common";
import { LmsHttpClient } from "./lms-http-client.service";
import { LmsSyncProducer } from "./lms-sync-producer.service";
import { LmsUserSyncBridge } from "./lms-user-sync.bridge";
import { LmsUserSyncJobHandler } from "./lms-user-sync.job-handler";

/**
 * S5-LMS-BE-1 — auto-sync tài khoản MediaOS→LMS. TÁCH KHỎI IntegrationsLmsModule (SSO cần PermissionModule)
 * ⇒ EmployeesModule/UsersModule import module NÀY để lấy LmsSyncProducer mà KHÔNG kéo PermissionModule.
 * Mọi dep khác (OutboxService/DatabaseService/AuditService/EventBus) đều @Global ⇒ KHÔNG import gì thêm,
 * KHÔNG import cycle. Bridge (OnModuleInit) + JobHandler (@SystemJobHandler, DiscoveryService gom) tự kích hoạt.
 */
@Module({
  providers: [LmsHttpClient, LmsSyncProducer, LmsUserSyncBridge, LmsUserSyncJobHandler],
  exports: [LmsSyncProducer],
})
export class LmsSyncModule {}
