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
  UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request } from 'express';
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
  createOrgUnit(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrgUnitDto) {
    return this.org.createOrgUnit(req.user.companyId, dto);
  }

  @Patch('units/:id')
  updateOrgUnit(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateOrgUnitDto,
  ) {
    return this.org.updateOrgUnit(req.user.companyId, id, dto);
  }

  @Delete('units/:id')
  @HttpCode(204)
  deleteOrgUnit(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.org.deleteOrgUnit(req.user.companyId, id);
  }

  // Legacy alias for backward compat (G4-1)
  @Get('departments')
  listDepartmentsLegacy(@Req() req: AuthenticatedRequest) {
    return this.org.listOrgUnits(req.user.companyId);
  }

  @Post('departments')
  createDepartmentLegacy(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrgUnitDto) {
    return this.org.createOrgUnit(req.user.companyId, dto);
  }

  // ── Teams ────────────────────────────────────────────────────────────────────

  @Get('teams')
  listTeams(@Req() req: AuthenticatedRequest, @Query('status') status?: string) {
    return this.org.listTeams(req.user.companyId, status);
  }

  @Post('teams')
  createTeam(@Req() req: AuthenticatedRequest, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(req.user.companyId, dto);
  }

  @Patch('teams/:id')
  updateTeam(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.org.updateTeam(req.user.companyId, id, dto);
  }

  @Patch('teams/:id/leader')
  assignTeamLeader(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AssignTeamLeaderDto,
  ) {
    return this.org.assignTeamLeader(req.user.companyId, id, dto);
  }

  @Delete('teams/:id')
  @HttpCode(204)
  deleteTeam(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.org.deleteTeam(req.user.companyId, id);
  }

  @Get('teams/:id/members')
  listTeamMembers(@Req() req: AuthenticatedRequest, @Param('id') teamId: string) {
    return this.org.listTeamMembers(req.user.companyId, teamId);
  }

  @Post('teams/:id/members')
  addTeamMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.org.addTeamMember(req.user.companyId, teamId, dto);
  }

  @Delete('teams/:id/members/:userId')
  @HttpCode(204)
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
