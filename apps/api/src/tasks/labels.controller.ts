import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { LabelsService } from "./labels.service";
import { CreateLabelDto, UpdateLabelDto } from "./tasks.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * PM-1 (apps/projects, mig 0420) — labels (nhãn màu theo project).
 *
 * Mọi route gated bởi PermissionGuard (@RequirePermission action:`label`, seed 0420 is_sensitive=false).
 * Global JwtAuthGuard + CompanyGuard chạy trước. Audit ở service trong cùng tx withTenant. SEC-1: service
 * guard project thuộc tenant trước khi CRUD (chặn chéo tenant qua path param).
 */
@Controller()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  /** GET /projects/:projectId/labels — danh sách nhãn của project. */
  @Get("projects/:projectId/labels")
  @RequirePermission("read", "label")
  listLabels(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.labels.listLabels(req.user.companyId, projectId);
  }

  /** POST /projects/:projectId/labels — tạo nhãn màu. */
  @Post("projects/:projectId/labels")
  @RequirePermission("create", "label")
  createLabel(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() dto: CreateLabelDto,
  ) {
    return this.labels.createLabel(req.user, projectId, dto);
  }

  /** PATCH /labels/:labelId — sửa nhãn (rename/recolor). */
  @Patch("labels/:labelId")
  @RequirePermission("update", "label")
  updateLabel(
    @Req() req: AuthenticatedRequest,
    @Param("labelId") labelId: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.labels.updateLabel(req.user, labelId, dto);
  }

  /** DELETE /labels/:labelId — soft-delete nhãn. */
  @Delete("labels/:labelId")
  @HttpCode(204)
  @RequirePermission("delete", "label")
  async deleteLabel(@Req() req: AuthenticatedRequest, @Param("labelId") labelId: string) {
    await this.labels.deleteLabel(req.user, labelId);
  }
}
