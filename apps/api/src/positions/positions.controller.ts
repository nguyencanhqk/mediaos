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
import { PositionsService } from './positions.service';
import { CreatePositionDto, UpdatePositionDto } from './positions.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller('org/positions')
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @RequirePermission('read', 'position')
  listPositions(@Req() req: AuthenticatedRequest, @Query('orgUnitId') orgUnitId?: string) {
    return this.positions.listPositions(req.user.companyId, orgUnitId);
  }

  @Get(':id')
  @RequirePermission('read', 'position')
  getPosition(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.positions.getPosition(req.user.companyId, id);
  }

  @Post()
  @RequirePermission('create', 'position')
  createPosition(@Req() req: AuthenticatedRequest, @Body() dto: CreatePositionDto) {
    return this.positions.createPosition(req.user.companyId, req.user.id, dto);
  }

  @Patch(':id')
  @RequirePermission('update', 'position')
  updatePosition(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePositionDto,
  ) {
    return this.positions.updatePosition(req.user.companyId, req.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('delete', 'position')
  deletePosition(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.positions.deletePosition(req.user.companyId, id);
  }
}
