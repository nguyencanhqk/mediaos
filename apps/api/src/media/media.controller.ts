import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request } from 'express';
import { MediaService } from './media.service';
import {
  AddProjectChannelDto,
  CreateChannelDto,
  CreateContentItemDto,
  CreateProjectDto,
} from './media.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller()
@UsePipes(ZodValidationPipe)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  // ── Channels ─────────────────────────────────────────────────────────────

  @Get('channels')
  listChannels(@Req() req: AuthenticatedRequest) {
    return this.media.listChannels(req.user.companyId);
  }

  @Post('channels')
  createChannel(@Req() req: AuthenticatedRequest, @Body() dto: CreateChannelDto) {
    return this.media.createChannel(req.user.companyId, dto);
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  @Get('projects')
  listProjects(@Req() req: AuthenticatedRequest) {
    return this.media.listProjects(req.user.companyId);
  }

  @Get('projects/:id')
  getProject(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return this.media.getProject(req.user.companyId, projectId);
  }

  @Post('projects')
  createProject(@Req() req: AuthenticatedRequest, @Body() dto: CreateProjectDto) {
    return this.media.createProject(req.user.companyId, dto, req.user.id);
  }

  @Post('projects/:id/channels')
  addProjectChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() dto: AddProjectChannelDto,
  ) {
    return this.media.addProjectChannel(req.user.companyId, projectId, dto);
  }

  @Delete('projects/:id/channels/:channelId')
  @HttpCode(204)
  removeProjectChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.media.removeProjectChannel(req.user.companyId, projectId, channelId);
  }

  // ── Content ───────────────────────────────────────────────────────────────

  @Get('projects/:id/content')
  listContent(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return this.media.listContent(req.user.companyId, projectId);
  }

  @Post('projects/:id/content')
  createContent(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() dto: CreateContentItemDto,
  ) {
    return this.media.createContent(req.user.companyId, projectId, dto);
  }
}
