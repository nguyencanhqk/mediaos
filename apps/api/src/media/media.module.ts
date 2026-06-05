import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';

@Module({
  imports: [DatabaseModule],
  providers: [MediaRepository, MediaService],
  controllers: [MediaController],
  exports: [MediaService],
})
export class MediaModule {}
