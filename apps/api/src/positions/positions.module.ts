import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { PositionsController } from './positions.controller';
import { PositionsRepository } from './positions.repository';
import { PositionsService } from './positions.service';

@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [PositionsController],
  providers: [PositionsService, PositionsRepository],
  exports: [PositionsService],
})
export class PositionsModule {}
