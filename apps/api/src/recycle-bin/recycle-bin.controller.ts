import { Controller, Get, HttpCode, Param, Post, Req, UseGuards, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request } from 'express';
import { PermissionGuard } from '../permission/guards/permission.guard';
import { RequirePermission } from '../permission/require-permission.decorator';
import { RecycleBinService } from './recycle-bin.service';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller('recycle-bin')
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class RecycleBinController {
  constructor(private readonly recycleBin: RecycleBinService) {}

  /** GET /recycle-bin/employees — list soft-deleted employees (requires read:employee). */
  @Get('employees')
  @RequirePermission('read', 'employee')
  listDeletedEmployees(@Req() req: AuthenticatedRequest) {
    return this.recycleBin.listDeletedEmployees(req.user);
  }

  /** POST /recycle-bin/employees/:id/restore — restore a soft-deleted employee (requires restore:employee, sensitive). */
  @Post('employees/:id/restore')
  @HttpCode(200)
  @RequirePermission('restore', 'employee', { isSensitive: true })
  restoreEmployee(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recycleBin.restoreEmployee(req.user, id);
  }
}
