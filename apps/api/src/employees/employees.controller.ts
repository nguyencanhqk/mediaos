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
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { EmployeesService } from "./employees.service";
import { CreateEmployeeProfileDto, UpdateEmployeeProfileDto } from "./employees.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("employees")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission("read", "employee")
  listEmployees(
    @Req() req: AuthenticatedRequest,
    @Query("orgUnitId") orgUnitId?: string,
    @Query("positionId") positionId?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
  ) {
    return this.employees.listEmployees(req.user, { orgUnitId, positionId, status, search });
  }

  @Post()
  @RequirePermission("create", "employee")
  createEmployee(@Req() req: AuthenticatedRequest, @Body() dto: CreateEmployeeProfileDto) {
    return this.employees.createEmployee(req.user, dto);
  }

  @Get(":id")
  @RequirePermission("read", "employee")
  getEmployee(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.employees.getEmployee(req.user, id);
  }

  @Patch(":id")
  @RequirePermission("update", "employee")
  updateEmployee(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateEmployeeProfileDto,
  ) {
    return this.employees.updateEmployee(req.user, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("delete", "employee")
  deleteEmployee(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.employees.deleteEmployee(req.user.companyId, id);
  }
}
