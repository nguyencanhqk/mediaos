import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { OrgRepository } from './org.repository';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';

@Module({
  imports: [DatabaseModule],
  providers: [OrgRepository, OrgService],
  controllers: [OrgController],
  exports: [OrgService],
})
export class OrgModule {}
