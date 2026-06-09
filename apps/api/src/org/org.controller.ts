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
import { OrgService } from './org.service';
import {
  AddTeamMemberDto,
  AssignTeamLeaderDto,
  CreateOrgUnitDto,
  CreateTeamDto,
  UpdateOrgUnitDto,
  UpdateTeamDto,
} from './org.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Permission policy (F2, ORG-002/003):
 *   - MUTATIONS (create/update/delete org_unit + team, status/head/leader, member add/remove) are
 *     fail-closed behind PermissionGuard: org_units require `('manage','org_unit')`, teams require
 *     `('manage','team')` — bare-verb action per the seed catalog convention (0005/0019/0027), NOT a
 *     compound code. Both permissions are seeded + granted to company-admin + hr-manager in migration 0030.
 *   - READS stay on the global JWT + Company pipeline only: org structure is non-sensitive and already
 *     tenant-isolated by RLS, so every authenticated member of the tenant may view it.
 *
 * ⚠️ Any NEW state-changing route MUST add `@UseGuards(PermissionGuard)` + `@RequirePermission(...)` —
 *    there is no class-level guard to fail-close an undecorated mutation.
 */
@Controller('org')
@UsePipes(ZodValidationPipe)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  // ── Departments (org_units) ──────────────────────────────────────────────────

  @Get('units')
  listOrgUnits(@Req() req: AuthenticatedRequest, @Query('status') status?: string) {
    return this.org.listOrgUnits(req.user.companyId, status);
  }

  @Get('units/tree')
  getOrgTree(@Req() req: AuthenticatedRequest) {
    return this.org.getOrgTree(req.user.companyId);
  }

  @Post('units')
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'org_unit')
  createOrgUnit(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrgUnitDto) {
    return this.org.createOrgUnit(req.user.companyId, dto);
  }

  // Covers both status toggle and head (head_user_id) reassignment — both flow through UpdateOrgUnitDto.
  @Patch('units/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'org_unit')
  updateOrgUnit(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateOrgUnitDto,
  ) {
    return this.org.updateOrgUnit(req.user.companyId, id, dto);
  }

  @Delete('units/:id')
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'org_unit')
  deleteOrgUnit(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.org.deleteOrgUnit(req.user.companyId, id);
  }

  // Legacy alias for backward compat (G4-1)
  @Get('departments')
  listDepartmentsLegacy(@Req() req: AuthenticatedRequest) {
    return this.org.listOrgUnits(req.user.companyId);
  }

  @Post('departments')
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'org_unit')
  createDepartmentLegacy(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrgUnitDto) {
    return this.org.createOrgUnit(req.user.companyId, dto);
  }

  // ── Teams ────────────────────────────────────────────────────────────────────

  @Get('teams')
  listTeams(@Req() req: AuthenticatedRequest, @Query('status') status?: string) {
    return this.org.listTeams(req.user.companyId, status);
  }

  @Post('teams')
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'team')
  createTeam(@Req() req: AuthenticatedRequest, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(req.user.companyId, dto);
  }

  @Patch('teams/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'team')
  updateTeam(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.org.updateTeam(req.user.companyId, id, dto);
  }

  @Patch('teams/:id/leader')
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'team')
  assignTeamLeader(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AssignTeamLeaderDto,
  ) {
    return this.org.assignTeamLeader(req.user.companyId, id, dto);
  }

  @Delete('teams/:id')
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'team')
  deleteTeam(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.org.deleteTeam(req.user.companyId, id);
  }

  @Get('teams/:id/members')
  listTeamMembers(@Req() req: AuthenticatedRequest, @Param('id') teamId: string) {
    return this.org.listTeamMembers(req.user.companyId, teamId);
  }

  @Post('teams/:id/members')
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'team')
  addTeamMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.org.addTeamMember(req.user.companyId, teamId, dto);
  }

  @Delete('teams/:id/members/:userId')
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission('manage', 'team')
  removeTeamMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') teamId: string,
    @Param('userId') userId: string,
  ) {
    return this.org.removeTeamMember(req.user.companyId, teamId, userId);
  }

  // ── Employees (legacy G4-1) ─────────────────────────────────────────────────

  @Get('employees')
  listEmployees(@Req() req: AuthenticatedRequest) {
    return this.org.listEmployees(req.user.companyId);
  }
}
