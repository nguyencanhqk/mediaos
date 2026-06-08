import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { AuthModule } from '../auth/auth.module';
import { CryptoModule } from '../crypto/crypto.module';
import { PlatformAccountsRepository } from './platform-accounts.repository';
import { PlatformAccountsService } from './platform-accounts.service';

/**
 * PlatformAccountsModule (🔒 G6-2e) — crown-jewel reveal/edit flow for platform_accounts.
 *
 * Wires the secret-encryption stack (CryptoModule → SecretEncryptionService), the permission engine +
 * re-auth cache (PermissionModule → PermissionService, ValkeyService), step-up verification
 * (AuthModule → PasswordService) and tenant DB access (DatabaseModule). AuditService is global (EventsModule).
 *
 * 2e-A registers only the service/repository (the RED int-spec drives the service directly). The
 * controller + ReauthGuard land in 2e-B, at which point this module is added to AppModule.
 */
@Module({
  imports: [DatabaseModule, PermissionModule, AuthModule, CryptoModule],
  providers: [PlatformAccountsRepository, PlatformAccountsService],
  exports: [PlatformAccountsService],
})
export class PlatformAccountsModule {}
