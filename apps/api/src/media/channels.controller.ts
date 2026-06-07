import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request } from 'express';
import { PermissionGuard } from '../permission/guards/permission.guard';
import { RequirePermission } from '../permission/require-permission.decorator';
import { MediaService } from './media.service';
import type { ListChannelsFilter } from './media.repository';
import {
  AddChannelMemberDto,
  CreateChannelDto,
  UpdateChannelDto,
  UpdateChannelHealthDto,
  UpdateChannelMemberDto,
} from './media.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * ChannelsController (G6-1) — kênh đa nền tảng + members + catalog platforms.
 * Mọi route gated bởi PermissionGuard (@RequirePermission). Member ops dùng `update:channel`
 * (channel-manager đã có) — KHÔNG tách `channel-member` resource type ở G6-1 (defer nếu cần).
 * Audit ghi ở service trong cùng tx withTenant.
 */
@Controller()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ChannelsController {
  constructor(private readonly media: MediaService) {}

  // ── Platforms (catalog) ─────────────────────────────────────────────────

  @Get('platforms')
  @RequirePermission('read', 'channel')
  listPlatforms(@Req() req: AuthenticatedRequest) {
    return this.media.listPlatforms(req.user.companyId);
  }

  // ── Channels ──────────────────────────────────────────────────────────────

  @Get('channels')
  @RequirePermission('read', 'channel')
  listChannels(
    @Req() req: AuthenticatedRequest,
    @Query('platform') platform?: string,
    @Query('status') status?: string,
    @Query('managerId') managerId?: string,
    @Query('niche') niche?: string,
    @Query('q') q?: string,
    @Query('risk') risk?: string,
  ) {
    const filters: ListChannelsFilter = {
      platform,
      status,
      managerId,
      niche,
      q,
      risk: risk === 'true' ? true : undefined,
    };
    return this.media.listChannels(req.user.companyId, filters);
  }

  @Post('channels')
  @RequirePermission('create', 'channel')
  createChannel(@Req() req: AuthenticatedRequest, @Body() dto: CreateChannelDto) {
    return this.media.createChannel(req.user, dto);
  }

  @Get('channels/:id')
  @RequirePermission('read', 'channel')
  getChannel(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.media.getChannel(req.user.companyId, id);
  }

  @Patch('channels/:id')
  @RequirePermission('update', 'channel')
  updateChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.media.updateChannel(req.user, id, dto);
  }

  @Patch('channels/:id/health')
  @RequirePermission('update', 'channel')
  updateChannelHealth(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateChannelHealthDto,
  ) {
    return this.media.updateChannelHealth(req.user, id, dto);
  }

  @Delete('channels/:id')
  @HttpCode(204)
  @RequirePermission('delete', 'channel')
  deleteChannel(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.media.deleteChannel(req.user, id);
  }

  // ── Channel members ──────────────────────────────────────────────────────

  @Get('channels/:id/members')
  @RequirePermission('read', 'channel')
  listChannelMembers(@Req() req: AuthenticatedRequest, @Param('id') channelId: string) {
    return this.media.listChannelMembers(req.user.companyId, channelId);
  }

  @Post('channels/:id/members')
  @RequirePermission('update', 'channel')
  addChannelMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') channelId: string,
    @Body() dto: AddChannelMemberDto,
  ) {
    return this.media.addChannelMember(req.user, channelId, dto);
  }

  @Patch('channels/:id/members/:memberId')
  @RequirePermission('update', 'channel')
  updateChannelMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') channelId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateChannelMemberDto,
  ) {
    return this.media.updateChannelMember(req.user, channelId, memberId, dto);
  }

  @Delete('channels/:id/members/:memberId')
  @HttpCode(204)
  @RequirePermission('update', 'channel')
  removeChannelMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') channelId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.media.removeChannelMember(req.user, channelId, memberId);
  }
}
