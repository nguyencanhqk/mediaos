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
 * OrgController — phòng ban (org_units) + team.
 *
 * Permission (F2, ORG-002/003): MỌI mutation (create/update/delete/leader/head/members) phải qua
 * PermissionGuard + @RequirePermission. READ (list/tree/members) GIỮ mở cho mọi user tenant — cơ cấu
 * tổ chức không nhạy cảm; JwtAuthGuard + CompanyGuard toàn cục (app.module) vẫn ép đăng nhập + tenant.
 * resource_type 'org_unit'/'team' khớp catalog seed (migration 0030) + audit object_type (0014).
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
  @RequirePermission('create', 'org_unit')
  createOrgUnit(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrgUnitDto) {
    return this.org.createOrgUnit(req.user.companyId, dto);
  }

  @Patch('units/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('update', 'org_unit')
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
  @RequirePermission('delete', 'org_unit')
  deleteOrgUnit(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.org.deleteOrgUnit(req.user.companyId, id);
  }

  // Legacy alias for backward compat (G4-1) — read stays open.
  @Get('departments')
  listDepartmentsLegacy(@Req() req: AuthenticatedRequest) {
    return this.org.listOrgUnits(req.user.companyId);
  }

  // Legacy mutation alias — MUST guard too (else a bypass of POST /units).
  @Post('departments')
  @UseGuards(PermissionGuard)
  @RequirePermission('create', 'org_unit')
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
  @RequirePermission('create', 'team')
  createTeam(@Req() req: AuthenticatedRequest, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(req.user.companyId, dto);
  }

  @Patch('teams/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('update', 'team')
  updateTeam(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.org.updateTeam(req.user.companyId, id, dto);
  }

  @Patch('teams/:id/leader')
  @UseGuards(PermissionGuard)
  @RequirePermission('update', 'team')
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
  @RequirePermission('delete', 'team')
  deleteTeam(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.org.deleteTeam(req.user.companyId, id);
  }

  // Read stays open.
  @Get('teams/:id/members')
  listTeamMembers(@Req() req: AuthenticatedRequest, @Param('id') teamId: string) {
    return this.org.listTeamMembers(req.user.companyId, teamId);
  }

  @Post('teams/:id/members')
  @UseGuards(PermissionGuard)
  @RequirePermission('update', 'team')
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
  @RequirePermission('update', 'team')
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

  // ── Roles catalog ─────────────────────────────────────────────────────────────
  // READ mở cho user tenant (như units/teams): danh mục vai trò không nhạy cảm,
  // dùng cho dropdown "vai trò mặc định" của chức vụ (F4/F11). RLS lộ role tenant +
  // system (company_id NULL). JwtAuthGuard + CompanyGuard toàn cục vẫn ép đăng nhập + tenant.
  @Get('roles')
  listRoles(@Req() req: AuthenticatedRequest) {
    return this.org.listRoles(req.user.companyId);
  }
}
