import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { PermissionModule } from '../permission/permission.module';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  imports: [DatabaseModule, PermissionModule, EventsModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
})
export class SettingsModule {}
