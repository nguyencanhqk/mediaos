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
import { ContentService } from './content.service';
import type { ListContentFilter } from './content.repository';
import {
  AddContentChannelDto,
  CreateContentAssetDto,
  CreateContentAssetVersionDto,
  CreateContentItemDto,
  CreateContentTypeDto,
  UpdateContentChannelDto,
  UpdateContentItemDto,
  UpdateContentTypeDto,
} from './media.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * ContentController (G6-4) — content ERD-full + đa kênh publish + asset version chain + content types.
 * Mọi route gated bởi PermissionGuard (@RequirePermission). Dùng resource `content` (CRUD có ở 0005);
 * resource `content-type`/`content-channel`/`content-asset` để DÀNH 0027 (G6-2 seed) — mirror quyết
 * định §3.1 (project link ops dùng update:project). Audit ghi ở service trong cùng tx withTenant.
 */
@Controller()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ContentController {
  constructor(private readonly content: ContentService) {}

  // ── Content types (catalog) ──────────────────────────────────────────────
  // Đặt TRƯỚC routes /content/:id để prefix 'content-types' không bị nhầm — khác prefix nên an toàn.

  @Get('content-types')
  @RequirePermission('read', 'content')
  listContentTypes(@Req() req: AuthenticatedRequest) {
    return this.content.listContentTypes(req.user.companyId);
  }

  @Post('content-types')
  @RequirePermission('create', 'content')
  createContentType(@Req() req: AuthenticatedRequest, @Body() dto: CreateContentTypeDto) {
    return this.content.createContentType(req.user, dto);
  }

  @Patch('content-types/:id')
  @RequirePermission('update', 'content')
  updateContentType(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateContentTypeDto,
  ) {
    return this.content.updateContentType(req.user, id, dto);
  }

  @Delete('content-types/:id')
  @HttpCode(204)
  @RequirePermission('delete', 'content')
  deleteContentType(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.content.deleteContentType(req.user, id);
  }

  // ── Content items ────────────────────────────────────────────────────────

  @Get('content')
  @RequirePermission('read', 'content')
  listContent(
    @Req() req: AuthenticatedRequest,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('productionStatus') productionStatus?: string,
    @Query('contentTypeId') contentTypeId?: string,
    @Query('mainChannelId') mainChannelId?: string,
    @Query('q') q?: string,
  ) {
    const filters: ListContentFilter = {
      projectId,
      status,
      productionStatus,
      contentTypeId,
      mainChannelId,
      q,
    };
    return this.content.listContent(req.user.companyId, filters);
  }

  @Post('content')
  @RequirePermission('create', 'content')
  createContent(@Req() req: AuthenticatedRequest, @Body() dto: CreateContentItemDto) {
    return this.content.createContent(req.user, dto);
  }

  @Get('content/:id')
  @RequirePermission('read', 'content')
  getContent(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.content.getContent(req.user.companyId, id);
  }

  @Patch('content/:id')
  @RequirePermission('update', 'content')
  updateContent(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateContentItemDto,
  ) {
    return this.content.updateContent(req.user, id, dto);
  }

  @Delete('content/:id')
  @HttpCode(204)
  @RequirePermission('delete', 'content')
  deleteContent(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.content.deleteContent(req.user, id);
  }

  @Get('content/:id/suggest-workflow')
  @RequirePermission('read', 'content')
  suggestWorkflow(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.content.suggestWorkflow(req.user.companyId, id);
  }

  // ── Content channels (publish targets, CNT-002) ──────────────────────────

  @Get('content/:id/channels')
  @RequirePermission('read', 'content')
  listContentChannels(@Req() req: AuthenticatedRequest, @Param('id') contentId: string) {
    return this.content.listContentChannels(req.user.companyId, contentId);
  }

  @Post('content/:id/channels')
  @RequirePermission('update', 'content')
  addContentChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') contentId: string,
    @Body() dto: AddContentChannelDto,
  ) {
    return this.content.addContentChannel(req.user, contentId, dto);
  }

  @Patch('content/:id/channels/:contentChannelId')
  @RequirePermission('update', 'content')
  updateContentChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') contentId: string,
    @Param('contentChannelId') contentChannelId: string,
    @Body() dto: UpdateContentChannelDto,
  ) {
    return this.content.updateContentChannel(req.user, contentId, contentChannelId, dto);
  }

  @Delete('content/:id/channels/:contentChannelId')
  @HttpCode(204)
  @RequirePermission('update', 'content')
  removeContentChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') contentId: string,
    @Param('contentChannelId') contentChannelId: string,
  ) {
    return this.content.removeContentChannel(req.user, contentId, contentChannelId);
  }

  // ── Content assets (version chain, CNT-003) ──────────────────────────────

  @Get('content/:id/assets')
  @RequirePermission('read', 'content')
  listContentAssets(@Req() req: AuthenticatedRequest, @Param('id') contentId: string) {
    return this.content.listContentAssets(req.user.companyId, contentId);
  }

  @Post('content/:id/assets')
  @RequirePermission('update', 'content')
  createAsset(
    @Req() req: AuthenticatedRequest,
    @Param('id') contentId: string,
    @Body() dto: CreateContentAssetDto,
  ) {
    return this.content.createAsset(req.user, contentId, dto);
  }

  @Post('content/:id/assets/:assetId/versions')
  @RequirePermission('update', 'content')
  createAssetVersion(
    @Req() req: AuthenticatedRequest,
    @Param('id') contentId: string,
    @Param('assetId') assetId: string,
    @Body() dto: CreateContentAssetVersionDto,
  ) {
    return this.content.createAssetVersion(req.user, contentId, assetId, dto);
  }

  @Delete('content/:id/assets/:assetId')
  @HttpCode(204)
  @RequirePermission('update', 'content')
  deleteAsset(
    @Req() req: AuthenticatedRequest,
    @Param('id') contentId: string,
    @Param('assetId') assetId: string,
  ) {
    return this.content.deleteAsset(req.user, contentId, assetId);
  }
}
