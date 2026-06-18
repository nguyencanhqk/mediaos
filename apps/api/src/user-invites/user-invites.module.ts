import { Module } from "@nestjs/common";
import { PasswordService } from "../auth/password.service";
import { CryptoModule } from "../crypto/crypto.module";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { SecurityPolicyModule } from "../security-policy/security-policy.module";
import { MailConfigRepository } from "../settings/mail-config.repository";
import { InviteMailService } from "./invite-mail.service";
import { UserInvitesController } from "./user-invites.controller";
import { UserInvitesRepository } from "./user-invites.repository";
import { UserInvitesService } from "./user-invites.service";

/**
 * CS-10 UserInvitesModule — mời/duyệt/kích hoạt user.
 *
 *  - CryptoModule → SecretEncryptionService (decrypt SMTP password để gửi email mời).
 *  - SecurityPolicyModule → SecurityPolicyService (email-domain check tại accept — CS-9).
 *  - PermissionModule → PermissionGuard. EventsModule @Global → AuditService (audit-in-tx).
 *  - PasswordService + MailConfigRepository: stateless, provide trực tiếp (không export ở module gốc).
 */
@Module({
  imports: [DatabaseModule, PermissionModule, CryptoModule, SecurityPolicyModule],
  controllers: [UserInvitesController],
  providers: [
    UserInvitesService,
    UserInvitesRepository,
    InviteMailService,
    MailConfigRepository,
    PasswordService,
  ],
})
export class UserInvitesModule {}
