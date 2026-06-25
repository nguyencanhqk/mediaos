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
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  createJobLevelSchema,
  updateJobLevelSchema,
  createContractTypeSchema,
  updateContractTypeSchema,
} from "@mediaos/contracts";
import { HrMasterDataService } from "./hr-master-data.service";

class CreateJobLevelDto extends createZodDto(createJobLevelSchema) {}
class UpdateJobLevelDto extends createZodDto(updateJobLevelSchema) {}
class CreateContractTypeDto extends createZodDto(createContractTypeSchema) {}
class UpdateContractTypeDto extends createZodDto(updateContractTypeSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-HR-BE-3 — HR master data CRUD: job_levels + contract_types.
 * Permission: manage:master-data (HR.MASTER_DATA.MANAGE — seed mig 0445).
 * All endpoints (read + write) require manage:master-data per SPEC-03 §13.12b/c.
 */
@Controller("hr/master-data")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class HrMasterDataController {
  constructor(private readonly svc: HrMasterDataService) {}

  // ── Job Levels ────────────────────────────────────────────────────────────────

  @Get("job-levels")
  @RequirePermission("manage", "master-data")
  listJobLevels(@Req() req: AuthenticatedRequest, @Query("status") status?: string) {
    return this.svc.listJobLevels(req.user.companyId, status);
  }

  @Get("job-levels/:id")
  @RequirePermission("manage", "master-data")
  getJobLevel(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.getJobLevel(req.user.companyId, id);
  }

  @Post("job-levels")
  @RequirePermission("manage", "master-data")
  createJobLevel(@Req() req: AuthenticatedRequest, @Body() dto: CreateJobLevelDto) {
    return this.svc.createJobLevel(req.user.companyId, req.user.id, dto);
  }

  @Patch("job-levels/:id")
  @RequirePermission("manage", "master-data")
  updateJobLevel(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateJobLevelDto,
  ) {
    return this.svc.updateJobLevel(req.user.companyId, req.user.id, id, dto);
  }

  @Delete("job-levels/:id")
  @HttpCode(204)
  @RequirePermission("manage", "master-data")
  deleteJobLevel(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.deleteJobLevel(req.user.companyId, req.user.id, id);
  }

  // ── Contract Types ────────────────────────────────────────────────────────────

  @Get("contract-types")
  @RequirePermission("manage", "master-data")
  listContractTypes(@Req() req: AuthenticatedRequest, @Query("status") status?: string) {
    return this.svc.listContractTypes(req.user.companyId, status);
  }

  @Get("contract-types/:id")
  @RequirePermission("manage", "master-data")
  getContractType(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.getContractType(req.user.companyId, id);
  }

  @Post("contract-types")
  @RequirePermission("manage", "master-data")
  createContractType(@Req() req: AuthenticatedRequest, @Body() dto: CreateContractTypeDto) {
    return this.svc.createContractType(req.user.companyId, req.user.id, dto);
  }

  @Patch("contract-types/:id")
  @RequirePermission("manage", "master-data")
  updateContractType(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateContractTypeDto,
  ) {
    return this.svc.updateContractType(req.user.companyId, req.user.id, id, dto);
  }

  @Delete("contract-types/:id")
  @HttpCode(204)
  @RequirePermission("manage", "master-data")
  deleteContractType(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.deleteContractType(req.user.companyId, req.user.id, id);
  }
}
