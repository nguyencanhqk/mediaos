import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { PermissionModule } from '../permission/permission.module';
import { SaasModule } from '../saas/saas.module';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';
// AC-4 UI config (branding / navigation / i18n overrides — tenant self-service)
import { UiConfigController } from './ui-config.controller';
import { UiConfigRepository } from './ui-config.repository';
import { UiConfigService } from './ui-config.service';

@Module({
  // AC-4: + EventsModule (AuditService cho audit-in-tx) + SaasModule (FeatureFlagService cho menu-gate).
  imports: [DatabaseModule, PermissionModule, EventsModule, SaasModule],
  controllers: [SettingsController, UiConfigController],
  providers: [SettingsService, SettingsRepository, UiConfigService, UiConfigRepository],
})
export class SettingsModule {}
