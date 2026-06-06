import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { ChatModule } from '../chat/chat.module';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { ChannelsController } from './channels.controller';

@Module({
  imports: [DatabaseModule, PermissionModule, ChatModule],
  providers: [MediaRepository, MediaService],
  controllers: [MediaController, ChannelsController],
  exports: [MediaService],
})
export class MediaModule {}
