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
import { createZodDto } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { createDepartmentSchema, updateDepartmentSchema } from "@mediaos/contracts";
import { HrDepartmentService } from "./hr-department.service";

class CreateDepartmentDto extends createZodDto(createDepartmentSchema) {}
class UpdateDepartmentDto extends createZodDto(updateDepartmentSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-HR-BE-3 — HR department CRUD endpoints.
 * Resource type: 'department' (HR.DEPARTMENT.*) — aligns with permission seed (mig 0444/0445).
 * All mutations guarded by PermissionGuard + @RequirePermission.
 * Reads also require read:department (departments are org management data, not public).
 */
@Controller("hr/departments")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class HrDepartmentController {
  constructor(private readonly svc: HrDepartmentService) {}

  @Get()
  @RequirePermission("read", "department")
  listDepartments(@Req() req: AuthenticatedRequest, @Query("status") status?: string) {
    return this.svc.listDepartments(req.user.companyId, status);
  }

  @Get(":id")
  @RequirePermission("read", "department")
  getDepartment(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.getDepartment(req.user.companyId, id);
  }

  @Post()
  @RequirePermission("create", "department")
  createDepartment(@Req() req: AuthenticatedRequest, @Body() dto: CreateDepartmentDto) {
    return this.svc.createDepartment(req.user.companyId, req.user.id, dto);
  }

  @Patch(":id")
  @RequirePermission("update", "department")
  updateDepartment(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.svc.updateDepartment(req.user.companyId, req.user.id, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("delete", "department")
  deleteDepartment(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.deleteDepartment(req.user.companyId, req.user.id, id);
  }
}
