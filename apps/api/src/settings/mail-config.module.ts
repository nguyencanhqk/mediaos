import { Module } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { MailConfigController } from "./mail-config.controller";
import { MailConfigRepository } from "./mail-config.repository";
import { MailConfigService } from "./mail-config.service";
import { MailTransportService } from "./mail-transport.service";

/**
 * CS-8 Mail config (SMTP, secret). CryptoModule = SecretEncryptionService (envelope SMTP password);
 * EventsModule = AuditService (audit-in-tx); PermissionModule = PermissionGuard.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule, CryptoModule],
  controllers: [MailConfigController],
  providers: [MailConfigService, MailConfigRepository, MailTransportService],
})
export class MailConfigModule {}
