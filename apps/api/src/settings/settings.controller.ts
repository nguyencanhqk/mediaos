import { Body, Controller, Get, Patch, Req, UseGuards, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request } from 'express';
import { PermissionGuard } from '../permission/guards/permission.guard';
import { RequirePermission } from '../permission/require-permission.decorator';
import { SettingsService } from './settings.service';
import { UpdateCompanySettingsDto } from './settings.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller('settings')
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('company')
  @RequirePermission('configure-company', 'company')
  getCompanySettings(@Req() req: AuthenticatedRequest) {
    return this.settings.getCompanySettings(req.user.companyId);
  }

  @Patch('company')
  @RequirePermission('configure-company', 'company')
  updateCompanySettings(@Req() req: AuthenticatedRequest, @Body() dto: UpdateCompanySettingsDto) {
    return this.settings.updateCompanySettings(req.user.companyId, dto);
  }
}
