import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import {
  changeEmployeeStatusSchema,
  createHrEmployeeSchema,
  linkUserSchema,
  unlinkUserSchema,
  updateHrEmployeeSchema,
  type ChangeEmployeeStatusRequest,
  type CreateHrEmployeeRequest,
  type LinkUserRequest,
  type UnlinkUserRequest,
  type UpdateHrEmployeeRequest,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { HrWriteService } from "./hr-write.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-HR-BE-2 — HR write core (API-03 §11.2/§11.5/§11.6/§11.7/§11.8). Sits alongside the read-only
 * HrReadController under `@Controller("hr")`. Every route is gated by PermissionGuard with the SEEDED
 * engine pair (mig 0444): the guard rejects a missing pair with 403 BEFORE the handler → a denied
 * caller writes NOTHING (no audit row). link/unlink reuse `update:employee` (no `link-user` pair exists,
 * matching API-03 HR-API-007/008 → HR.EMPLOYEE.UPDATE).
 */
@Controller("hr")
@UseGuards(PermissionGuard)
export class HrWriteController {
  constructor(private readonly hr: HrWriteService) {}

  @Post("employees")
  @RequirePermission("create", "employee")
  createEmployee(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createHrEmployeeSchema)) dto: CreateHrEmployeeRequest,
  ) {
    return this.hr.createEmployee(req.user, dto);
  }

  @Patch("employees/:id")
  @RequirePermission("update", "employee")
  updateEmployee(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateHrEmployeeSchema)) dto: UpdateHrEmployeeRequest,
  ) {
    return this.hr.updateEmployee(req.user, id, dto);
  }

  @Post("employees/:id/change-status")
  @RequirePermission("change-status", "employee")
  changeStatus(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeEmployeeStatusSchema)) dto: ChangeEmployeeStatusRequest,
  ) {
    return this.hr.changeStatus(req.user, id, dto);
  }

  @Post("employees/:id/link-user")
  @RequirePermission("update", "employee")
  linkUser(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(linkUserSchema)) dto: LinkUserRequest,
  ) {
    return this.hr.linkUser(req.user, id, dto);
  }

  @Delete("employees/:id/link-user")
  @RequirePermission("update", "employee")
  unlinkUser(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(unlinkUserSchema)) dto: UnlinkUserRequest,
  ) {
    return this.hr.unlinkUser(req.user, id, dto);
  }
}
