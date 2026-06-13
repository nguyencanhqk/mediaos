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
import { SalaryProfileService } from "./salary-profile.service";
import { CreateSalaryProfileDto, UpdateSalaryProfileDto } from "./salary-profile.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Salary profile CRUD — CROWN JEWEL. Lương nhạy cảm (ADR-0010, BẤT BIẾN #3):
 *  - MỖI route khai @RequirePermission isSensitive:true (PermissionGuard fail-closed nếu thiếu).
 *  - view = view-salary-profile (đọc/list).  manage = manage-salary-profile (tạo/sửa/xoá-mềm).
 *  - sensitive ⇒ KHÔNG kế thừa qua wildcard *:* (permission engine G3-2). Mask + audit ở service.
 */
@Controller("salary-profiles")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class SalaryProfileController {
  constructor(private readonly salaryProfiles: SalaryProfileService) {}

  @Get()
  @RequirePermission("view-salary-profile", "salary_profile", { isSensitive: true })
  list(
    @Req() req: AuthenticatedRequest,
    @Query("userId") userId?: string,
    @Query("status") status?: string,
  ) {
    return this.salaryProfiles.list(req.user, {
      userId,
      status: status as "active" | "inactive" | undefined,
    });
  }

  @Post()
  @RequirePermission("manage-salary-profile", "salary_profile", { isSensitive: true })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateSalaryProfileDto) {
    return this.salaryProfiles.create(req.user, dto);
  }

  @Get(":id")
  @RequirePermission("view-salary-profile", "salary_profile", { isSensitive: true })
  getOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.salaryProfiles.getOne(req.user, id);
  }

  @Patch(":id")
  @RequirePermission("manage-salary-profile", "salary_profile", { isSensitive: true })
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateSalaryProfileDto,
  ) {
    return this.salaryProfiles.update(req.user, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("manage-salary-profile", "salary_profile", { isSensitive: true })
  remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.salaryProfiles.remove(req.user, id);
  }
}
