import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { OrgRepository } from './org.repository';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';

// PermissionModule cung cấp PermissionService cho PermissionGuard (F2 — guard các mutation org/team).
@Module({
  imports: [DatabaseModule, PermissionModule],
  providers: [OrgRepository, OrgService],
  controllers: [OrgController],
  exports: [OrgService],
})
export class OrgModule {}
