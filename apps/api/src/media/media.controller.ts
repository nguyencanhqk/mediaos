import { Body, Controller, Get, Param, Post, Req, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request } from 'express';
import { MediaService } from './media.service';
import { CreateContentItemDto } from './media.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * MediaController (G4-2 legacy) — content items. Channels → ChannelsController (G6-1),
 * projects + project links → ProjectsController (G6-3). Content guard retrofit ở G6-4.
 */
@Controller()
@UsePipes(ZodValidationPipe)
export class MediaController {
  constructor(private readonly media: MediaService) {}

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
