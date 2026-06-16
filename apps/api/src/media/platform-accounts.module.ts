import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { AuthModule } from '../auth/auth.module';
import { CryptoModule } from '../crypto/crypto.module';
import { BreakGlassModule } from '../break-glass/break-glass.module';
import { PlatformAccountsRepository } from './platform-accounts.repository';
import { PlatformAccountsService } from './platform-accounts.service';
import { PlatformAccountsController } from './platform-accounts.controller';
import { ReauthGuard } from './reauth.guard';

/**
 * PlatformAccountsModule (🔒 G6-2e) — crown-jewel reveal/edit flow for platform_accounts.
 *
 * Wires the secret-encryption stack (CryptoModule → SecretEncryptionService), the permission engine +
 * re-auth cache (PermissionModule → PermissionService, ValkeyService, PermissionGuard), step-up
 * verification (AuthModule → PasswordService) and tenant DB access (DatabaseModule). AuditService is
 * global (EventsModule). ReauthGuard is a provider so DI can inject ValkeyService into it.
 *
 * 2e-B adds the controller + ReauthGuard. To avoid colliding with a parallel session editing
 * app.module, this module is registered transitively via MediaModule.imports (NOT added to AppModule).
 *
 * ROUND 2 imports BreakGlassModule (exports BreakGlassRepository) so revealSecretViaBreakGlass can read the
 * active grant (gate b) without copying crypto into the break-glass module. One-directional: BreakGlassModule
 * does NOT import this module (its controller injects only BreakGlassGrantService) → no DI cycle.
 */
@Module({
  imports: [DatabaseModule, PermissionModule, AuthModule, CryptoModule, BreakGlassModule],
  controllers: [PlatformAccountsController],
  providers: [PlatformAccountsRepository, PlatformAccountsService, ReauthGuard],
  exports: [PlatformAccountsService],
})
export class PlatformAccountsModule {}
