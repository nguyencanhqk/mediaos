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
import { ProjectsService } from './projects.service';
import type { ListProjectsFilter } from './projects.repository';
import {
  AddProjectChannelDto,
  AddProjectMemberDto,
  AddProjectTeamDto,
  CreateProjectDto,
  UpdateProjectChannelDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
} from './media.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * ProjectsController (G6-3) — dự án ERD-full + kênh/team/member.
 * Mọi route gated bởi PermissionGuard (@RequirePermission). Link ops (channel/team/member) dùng
 * `update:project` — KHÔNG tách resource type riêng ở G6-3 (mirror quyết định channel-member §3.1).
 * Audit ghi ở service trong cùng tx withTenant.
 */
@Controller()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // ── Projects ─────────────────────────────────────────────────────────────

  @Get('projects')
  @RequirePermission('read', 'project')
  listProjects(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('projectType') projectType?: string,
    @Query('priority') priority?: string,
    @Query('managerId') managerId?: string,
    @Query('q') q?: string,
  ) {
    const filters: ListProjectsFilter = { status, projectType, priority, managerId, q };
    return this.projects.listProjects(req.user.companyId, filters);
  }

  @Post('projects')
  @RequirePermission('create', 'project')
  createProject(@Req() req: AuthenticatedRequest, @Body() dto: CreateProjectDto) {
    return this.projects.createProject(req.user, dto);
  }

  @Get('projects/:id')
  @RequirePermission('read', 'project')
  getProject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.projects.getProject(req.user.companyId, id);
  }

  @Patch('projects/:id')
  @RequirePermission('update', 'project')
  updateProject(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.updateProject(req.user, id, dto);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  @RequirePermission('delete', 'project')
  deleteProject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.projects.deleteProject(req.user, id);
  }

  // ── Project channels ───────────────────────────────────────────────────────

  @Post('projects/:id/channels')
  @RequirePermission('update', 'project')
  addProjectChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() dto: AddProjectChannelDto,
  ) {
    return this.projects.addProjectChannel(req.user, projectId, dto);
  }

  @Patch('projects/:id/channels/:channelId')
  @RequirePermission('update', 'project')
  updateProjectChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateProjectChannelDto,
  ) {
    return this.projects.updateProjectChannel(req.user, projectId, channelId, dto);
  }

  @Delete('projects/:id/channels/:channelId')
  @HttpCode(204)
  @RequirePermission('update', 'project')
  removeProjectChannel(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.projects.removeProjectChannel(req.user, projectId, channelId);
  }

  // ── Project teams ──────────────────────────────────────────────────────────

  @Get('projects/:id/teams')
  @RequirePermission('read', 'project')
  listProjectTeams(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return this.projects.listProjectTeams(req.user.companyId, projectId);
  }

  @Post('projects/:id/teams')
  @RequirePermission('update', 'project')
  addProjectTeam(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() dto: AddProjectTeamDto,
  ) {
    return this.projects.addProjectTeam(req.user, projectId, dto);
  }

  @Delete('projects/:id/teams/:teamId')
  @HttpCode(204)
  @RequirePermission('update', 'project')
  removeProjectTeam(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.projects.removeProjectTeam(req.user, projectId, teamId);
  }

  // ── Project members ──────────────────────────────────────────────────────

  @Get('projects/:id/members')
  @RequirePermission('read', 'project')
  listProjectMembers(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return this.projects.listProjectMembers(req.user.companyId, projectId);
  }

  @Post('projects/:id/members')
  @RequirePermission('update', 'project')
  addProjectMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projects.addProjectMember(req.user, projectId, dto);
  }

  @Patch('projects/:id/members/:memberId')
  @RequirePermission('update', 'project')
  updateProjectMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.projects.updateProjectMember(req.user, projectId, memberId, dto);
  }

  @Delete('projects/:id/members/:memberId')
  @HttpCode(204)
  @RequirePermission('update', 'project')
  removeProjectMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.projects.removeProjectMember(req.user, projectId, memberId);
  }
}
