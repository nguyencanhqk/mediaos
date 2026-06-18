import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { RecycleBinController } from './recycle-bin.controller';
import { RecycleBinRepository } from './recycle-bin.repository';
import { RecycleBinService } from './recycle-bin.service';

@Module({
  imports: [
    DatabaseModule,
    // PermissionModule exports the permission stack + guards.
    // AuditService is global (EventsModule @Global) — no explicit import needed.
    PermissionModule,
  ],
  controllers: [RecycleBinController],
  providers: [RecycleBinService, RecycleBinRepository],
})
export class RecycleBinModule {}
