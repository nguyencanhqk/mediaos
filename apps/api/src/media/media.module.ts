import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { ChatModule } from '../chat/chat.module';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { ChannelsController } from './channels.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';

@Module({
  imports: [DatabaseModule, PermissionModule, ChatModule],
  providers: [MediaRepository, MediaService, ProjectsRepository, ProjectsService],
  controllers: [MediaController, ChannelsController, ProjectsController],
  exports: [MediaService, ProjectsService],
})
export class MediaModule {}
