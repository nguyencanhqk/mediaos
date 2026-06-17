import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { CryptoModule } from "../crypto/crypto.module";
import { PermissionModule } from "../permission/permission.module";
import { WebhookDeliveryService } from "./webhook-delivery.service";
import { WebhookRepository } from "./webhooks.repository";
import { WebhookSigner } from "./webhook-signer";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

/**
 * WebhooksModule (AC-6 🔒, TENANT self-service) — endpoint CRUD + subscribe + delivery log.
 *
 * CryptoModule → SecretEncryptionService (HMAC secret envelope-KMS, purpose='webhook_secret').
 * AuditService đến từ EventsModule (@Global). PermissionModule cho PermissionGuard.
 * WebhookDeliveryService export để consumer (bước kế) tái dùng validate+record.
 */
@Module({
  imports: [DatabaseModule, CryptoModule, PermissionModule],
  controllers: [WebhooksController],
  providers: [WebhookRepository, WebhookSigner, WebhooksService, WebhookDeliveryService],
  exports: [WebhookDeliveryService, WebhookSigner],
})
export class WebhooksModule {}
