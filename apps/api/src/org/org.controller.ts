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
import { OrgService } from './org.service';
import { AddTeamMemberDto, CreateOrgUnitDto, CreateTeamDto } from './org.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller('org')
@UsePipes(ZodValidationPipe)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  // ── Departments (org_units) ──────────────────────────────────────────────

  @Get('departments')
  listDepartments(@Req() req: AuthenticatedRequest) {
    return this.org.listOrgUnits(req.user.companyId);
  }

  @Post('departments')
  createDepartment(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrgUnitDto) {
    return this.org.createOrgUnit(req.user.companyId, dto);
  }

  // ── Teams ─────────────────────────────────────────────────────────────────

  @Get('teams')
  listTeams(@Req() req: AuthenticatedRequest) {
    return this.org.listTeams(req.user.companyId);
  }

  @Post('teams')
  createTeam(@Req() req: AuthenticatedRequest, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(req.user.companyId, dto);
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

  // ── Employees ─────────────────────────────────────────────────────────────

  @Get('employees')
  listEmployees(@Req() req: AuthenticatedRequest) {
    return this.org.listEmployees(req.user.companyId);
  }
}
