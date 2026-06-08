import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { PermissionModule } from '../permission/permission.module';
import { ChatModule } from '../chat/chat.module';
import { PlatformAccountsModule } from './platform-accounts.module';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { ChannelsController } from './channels.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ContentRepository } from './content.repository';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';

@Module({
  imports: [DatabaseModule, PermissionModule, ChatModule, PlatformAccountsModule],
  providers: [
    MediaRepository,
    MediaService,
    ProjectsRepository,
    ProjectsService,
    ContentRepository,
    ContentService,
  ],
  controllers: [ChannelsController, ProjectsController, ContentController],
  exports: [MediaService, ProjectsService, ContentService],
})
export class MediaModule {}
