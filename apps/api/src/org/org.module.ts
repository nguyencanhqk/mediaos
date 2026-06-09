import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { OrgRepository } from './org.repository';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';

// PermissionModule: OrgController mutations use @UseGuards(PermissionGuard) (F2/ORG-002/003).
// PermissionModule is NOT @Global, so it must be imported to resolve PermissionGuard → PermissionService.
@Module({
  imports: [DatabaseModule, PermissionModule],
  providers: [OrgRepository, OrgService],
  controllers: [OrgController],
  exports: [OrgService],
})
export class OrgModule {}
